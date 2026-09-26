"""
Voice-command recognition via real speech-to-text (Whisper and/or Vosk),
then fuzzy-matching the transcribed text against your known command list --
instead of building our own embedding classifier from scratch.

Why transcription instead of the earlier embedding/prototype approach:
- Whisper's encoder hidden states were never trained to separate words from
  each other; its DECODER was trained for exactly this (accurate transcription
  across many accents). 15 clips/person wasn't enough to teach a from-scratch
  classifier "stop" from "backward" -- but Whisper/Vosk already know how,
  because that's literally their job.
- No training/calibration step: just a command list.

NEW IN THIS VERSION:
  --model-size base|small|medium  -- try a bigger (more accurate, slower)
      Whisper model. Already existed as tiny/base/small; medium added.
  --use-vad   -- trims each clip down to just its voiced region before
      transcribing, and skips transcription entirely (reporting "no speech
      detected") when a clip has no detected voice at all. This targets a
      specific failure mode seen in earlier runs: near-silent/noisy clips
      causing Whisper to hallucinate a long unrelated paragraph instead of
      returning nothing -- trimming to the actual voiced audio (or skipping
      decode when there's none) avoids feeding it a mostly-blank or
      noise-heavy waveform.
      Uses WebRTC VAD (webrtcvad) if it's installed -- more accurate, but
      it's a C extension and needs a compiler (Xcode Command Line Tools on
      macOS) to build. If webrtcvad isn't importable, automatically falls
      back to a pure-Python/numpy energy-based VAD (no compiler needed):
      it computes short-frame RMS energy, thresholds against a noise floor
      estimated from the quietest frames in the clip, and trims to the
      voiced span the same way. Less sophisticated than WebRTC's trained
      model (it can't distinguish "quiet speech" from "loud non-speech
      noise" as well), but it catches the same silence/rambling-paragraph
      failure mode this flag exists for.
  --engine whisper|vosk  -- Vosk is a separate, fully local/offline ASR
      engine (different training data and approach than Whisper), useful
      as a second opinion / lighter-weight alternative. Requires
      `pip install vosk` AND manually downloading a Vosk model directory
      (e.g. "vosk-model-small-en-us-0.15") from https://alphacephei.com/vosk/models
      -- that download isn't automated here since it's a few hundred MB.

SUBCOMMANDS:
  recognize  -- transcribe a clip (file or live mic) and fuzzy-match it
                against your command list.
  evaluate   -- batch-test against every clip already recorded in
                data/commands/ (per speaker, per command), reporting
                accuracy and exactly which clips were misheard as what.

USAGE:
    pip install openai-whisper torch sounddevice
    # optional, for the more accurate VAD: pip install webrtcvad
    #   (needs a C compiler -- xcode-select --install on macOS)
    # optional: pip install vosk   (+ download a model directory)

    python voice_intent_transcribe.py evaluate --model-size base --use-vad
    python voice_intent_transcribe.py evaluate --engine vosk --vosk-model-path ./vosk-model-small-en-us-0.15 --use-vad
    python voice_intent_transcribe.py recognize --live --model-size base --use-vad
"""

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

import numpy as np
import sounddevice as sd
import torch
import whisper

SAMPLE_RATE = 16_000
CLIP_SECONDS = 2.0
UNKNOWN_LABEL = "unknown"
DEFAULT_MATCH_THRESHOLD = 0.5  # fuzzy-match ratio below this -> report "unknown"
VOICEPRINT_DIR = Path("data/voiceprints")
SPEAKER_ID_THRESHOLD = 0.5  # cosine similarity below this -> "unrecognized speaker"

# EDIT to match your real command vocabulary (or pass --commands).
DEFAULT_COMMANDS = [
    "stop",
    "go_home",
    "go_left",
    "go_right",
    "forward",
    "backward",
]

_whisper_cache = {}
_vosk_cache = {}
_speaker_id_cache = {}
_warned_no_webrtcvad = False


def load_speaker_id_model():
    """Loads SpeechBrain's pretrained ECAPA-TDNN speaker-embedding model
    (trained on VoxCeleb). This is a general-purpose "voiceprint" model --
    it was never trained on your speakers specifically, but it's very good
    at telling voices apart in general, which is exactly what's needed here:
    given a clip, produce a fixed-size vector such that clips from the same
    person land close together (by cosine similarity) and clips from
    different people land far apart, regardless of what they're saying.
    Downloads the pretrained weights on first use (~80MB), then caches."""
    if "model" not in _speaker_id_cache:
        from speechbrain.inference.speaker import EncoderClassifier  # optional dependency
        print("Loading speaker-ID model (speechbrain ECAPA-TDNN)...")
        _speaker_id_cache["model"] = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="pretrained_models/spkrec-ecapa-voxceleb",
        )
    return _speaker_id_cache["model"]


def compute_speaker_embedding(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Returns a 192-dim voiceprint vector for a clip. Longer, cleaner clips
    (a few seconds of natural speech) give a more reliable embedding than a
    single short command word -- this is why enrollment uses a longer
    recording than the command clips do."""
    model = load_speaker_id_model()
    tensor = torch.from_numpy(audio).float().unsqueeze(0)  # (1, num_samples)
    with torch.no_grad():
        embedding = model.encode_batch(tensor)
    return embedding.squeeze().cpu().numpy()


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


def save_voiceprint(speaker: str, embedding: np.ndarray, voiceprint_dir: Path = VOICEPRINT_DIR):
    voiceprint_dir.mkdir(parents=True, exist_ok=True)
    np.save(voiceprint_dir / f"{speaker}.npy", embedding)


def load_all_voiceprints(voiceprint_dir: Path = VOICEPRINT_DIR) -> dict:
    """Returns {speaker_name: embedding} for every enrolled speaker. Empty
    dict if no one has been enrolled yet (identify_speaker then always
    reports "unrecognized")."""
    if not voiceprint_dir.exists():
        return {}
    return {p.stem: np.load(p) for p in voiceprint_dir.glob("*.npy")}


def identify_speaker(embedding: np.ndarray, voiceprints: dict, threshold: float = SPEAKER_ID_THRESHOLD):
    """Returns (speaker_name_or_None, best_score). None means either no one
    is enrolled yet, or the closest enrolled voice still isn't a confident
    enough match (below `threshold`) -- i.e. an unrecognized/new speaker,
    which is reported rather than guessed at."""
    if not voiceprints:
        return None, 0.0
    scored = [(name, cosine_similarity(embedding, ref)) for name, ref in voiceprints.items()]
    scored.sort(key=lambda x: -x[1])
    best_name, best_score = scored[0]
    if best_score < threshold:
        return None, best_score
    return best_name, best_score


def load_whisper_cached(model_size: str, device: str):
    key = (model_size, device)
    if key not in _whisper_cache:
        print(f"Loading whisper-{model_size}...")
        _whisper_cache[key] = whisper.load_model(model_size, device=device)
    return _whisper_cache[key]


def load_vosk_cached(model_path: str):
    if model_path not in _vosk_cache:
        from vosk import Model  # imported lazily -- optional dependency
        print(f"Loading Vosk model from {model_path}...")
        _vosk_cache[model_path] = Model(model_path)
    return _vosk_cache[model_path]


def normalize_text(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def float_to_pcm16_bytes(audio: np.ndarray) -> bytes:
    audio_int16 = np.clip(audio * 32768.0, -32768, 32767).astype(np.int16)
    return audio_int16.tobytes()


def _apply_vad_webrtc(audio: np.ndarray, sample_rate: int, aggressiveness: int, frame_ms: int, pad_seconds: float):
    """Trims audio to its voiced region using WebRTC VAD (requires the
    optional `webrtcvad` C extension). Returns the trimmed array, or None
    if no speech was detected at all anywhere in the clip."""
    import webrtcvad  # imported lazily -- optional dependency
    vad = webrtcvad.Vad(aggressiveness)
    frame_len = int(sample_rate * frame_ms / 1000)
    pcm = float_to_pcm16_bytes(audio)
    bytes_per_sample = 2
    frame_bytes = frame_len * bytes_per_sample

    voiced_sample_indices = []
    for start in range(0, len(pcm) - frame_bytes + 1, frame_bytes):
        frame = pcm[start:start + frame_bytes]
        if vad.is_speech(frame, sample_rate):
            voiced_sample_indices.append(start // bytes_per_sample)

    if not voiced_sample_indices:
        return None

    pad = int(pad_seconds * sample_rate)
    start_sample = max(0, voiced_sample_indices[0] - pad)
    end_sample = min(len(audio), voiced_sample_indices[-1] + frame_len + pad)
    return audio[start_sample:end_sample]


def _apply_vad_energy(audio: np.ndarray, sample_rate: int, frame_ms: int, pad_seconds: float,
                       aggressiveness: int):
    """Pure numpy fallback VAD: no compiler/C-extension required.

    Splits the clip into short frames, computes each frame's RMS energy,
    and estimates a noise floor from the quietest ~20% of frames (assumes
    most clips have at least some leading/trailing silence or room noise
    to calibrate against). A frame counts as "voiced" if its energy is
    more than `threshold_db` above that floor. `aggressiveness` (0-3, same
    range as the WebRTC flag) scales that margin: higher = requires a
    bigger jump above the noise floor = trims more.
    """
    frame_len = int(sample_rate * frame_ms / 1000)
    if frame_len <= 0 or len(audio) < frame_len:
        return None

    n_frames = len(audio) // frame_len
    frames = audio[:n_frames * frame_len].reshape(n_frames, frame_len)
    # RMS energy per frame, in dB (add epsilon to avoid log(0) on true silence).
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    energy_db = 20 * np.log10(rms + 1e-8)

    # Noise floor: median of the quietest 20% of frames (robust to a few
    # unusually-quiet voiced frames, unlike taking the single minimum).
    sorted_db = np.sort(energy_db)
    floor_n = max(1, int(len(sorted_db) * 0.2))
    noise_floor = np.median(sorted_db[:floor_n])

    # Margin above the floor a frame needs to clear to count as speech.
    # Same 0-3 scale as WebRTC's aggressiveness: higher = stricter.
    margin_db = {0: 6.0, 1: 9.0, 2: 12.0, 3: 16.0}.get(aggressiveness, 12.0)
    threshold_db = noise_floor + margin_db

    voiced_frame_indices = np.where(energy_db > threshold_db)[0]
    if len(voiced_frame_indices) == 0:
        return None

    pad = int(pad_seconds * sample_rate)
    start_sample = max(0, voiced_frame_indices[0] * frame_len - pad)
    end_sample = min(len(audio), (voiced_frame_indices[-1] + 1) * frame_len + pad)
    return audio[start_sample:end_sample]


def apply_vad(audio: np.ndarray, sample_rate: int = SAMPLE_RATE,
              aggressiveness: int = 2, frame_ms: int = 30, pad_seconds: float = 0.1):
    """Trims audio to its voiced region. Returns the trimmed array, or None
    if no speech was detected at all anywhere in the clip.

    Tries WebRTC VAD first (more accurate, model-based); if the optional
    `webrtcvad` package isn't installed, transparently falls back to a
    pure-Python energy-based VAD so --use-vad still works with no compiler
    required. Prints a one-time notice when it falls back, so it's clear
    which method produced a given evaluate run.
    """
    global _warned_no_webrtcvad
    try:
        return _apply_vad_webrtc(audio, sample_rate, aggressiveness, frame_ms, pad_seconds)
    except ImportError:
        if not _warned_no_webrtcvad:
            print("[apply_vad] webrtcvad not installed -- using pure-Python energy-based VAD fallback "
                  "(pip install webrtcvad for the more accurate model-based version)")
            _warned_no_webrtcvad = True
        return _apply_vad_energy(audio, sample_rate, frame_ms, pad_seconds, aggressiveness)


def transcribe_whisper(audio_or_path, whisper_model, language: str = "en") -> str:
    result = whisper_model.transcribe(audio_or_path, language=language, fp16=False)
    return normalize_text(result["text"])


def transcribe_vosk(audio: np.ndarray, model_path: str, sample_rate: int = SAMPLE_RATE) -> str:
    from vosk import KaldiRecognizer  # imported lazily -- optional dependency
    model = load_vosk_cached(model_path)
    rec = KaldiRecognizer(model, sample_rate)
    rec.AcceptWaveform(float_to_pcm16_bytes(audio))
    result = json.loads(rec.FinalResult())
    return normalize_text(result.get("text", ""))


def transcribe_any(audio_or_path, args, whisper_model=None) -> str:
    """Loads the clip to a float32 array if given a path, optionally runs VAD
    trimming, then dispatches to whichever engine was selected."""
    if isinstance(audio_or_path, (str, Path)):
        audio = whisper.load_audio(str(audio_or_path))
    else:
        audio = audio_or_path

    if args.use_vad:
        trimmed = apply_vad(audio, SAMPLE_RATE, aggressiveness=args.vad_aggressiveness)
        if trimmed is None:
            return ""  # no speech detected anywhere in the clip
        audio = trimmed

    if args.engine == "vosk":
        return transcribe_vosk(audio, args.vosk_model_path, SAMPLE_RATE)
    return transcribe_whisper(audio, whisper_model)


SPEAKER_PROFILE_DIR = Path("data/speaker_profiles")


def load_speaker_profile(speaker: str, profile_dir: Path = SPEAKER_PROFILE_DIR) -> dict:
    """Loads a speaker's learned command variants, e.g.
    {"backward": ["backward", "back word", "im back with"], ...}
    Returns {} if the speaker has no profile yet (first-time user)."""
    path = profile_dir / f"{speaker}.json"
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


def save_speaker_profile(speaker: str, profile: dict, profile_dir: Path = SPEAKER_PROFILE_DIR):
    profile_dir.mkdir(parents=True, exist_ok=True)
    path = profile_dir / f"{speaker}.json"
    with open(path, "w") as f:
        json.dump(profile, f, indent=2, sort_keys=True)


def best_match(transcribed: str, commands: list, speaker_profile: dict = None) -> tuple:
    """Returns (command, score in [0,1]). Exact/substring matches score high;
    otherwise falls back to a fuzzy string-similarity ratio, which tolerates
    small mis-transcriptions ("stahp" vs "stop") without needing exact text.

    If speaker_profile is given (from load_speaker_profile), it's checked
    FIRST: an exact match against one of this speaker's own previously-
    learned variants for a command scores 0.95 -- lower than a fresh exact
    match against the canonical phrase (1.0), but higher than the generic
    substring shortcut (0.9), since it's a personalized match rather than
    a lucky string coincidence. This is what lets the system recognize,
    say, a speaker who consistently says "back word" for "backward" even
    though that phrase would only score ~0.3 generically."""
    scored = []
    for cmd in commands:
        phrase = cmd.replace("_", " ")

        if speaker_profile and transcribed in speaker_profile.get(cmd, []):
            scored.append((cmd, 0.95))
            continue

        if transcribed == phrase:
            scored.append((cmd, 1.0))
            continue
        # Guard against trivial substring matches: an empty (or very short)
        # transcription is technically "in" every phrase in Python
        # (`"" in "backward"` is True), which would hand out a fake high
        # score whenever nothing was actually heard. Only take the
        # substring shortcut once both sides are long enough to mean
        # something real.
        if (len(transcribed) >= 3 and len(phrase) >= 3
                and (phrase in transcribed or transcribed in phrase)):
            scored.append((cmd, 0.9))
            continue
        ratio = difflib.SequenceMatcher(None, transcribed, phrase).ratio()
        scored.append((cmd, ratio))
    scored.sort(key=lambda x: -x[1])
    return scored[0]


def record_clip(seconds: float, sample_rate: int) -> np.ndarray:
    audio = sd.rec(int(seconds * sample_rate), samplerate=sample_rate, channels=1, dtype="float32")
    sd.wait()
    return audio.squeeze()


def play_tone(freq_hz: float, duration: float = 0.15, sample_rate: int = SAMPLE_RATE, volume: float = 0.3):
    """Plays a short sine-wave beep so the user gets an audible cue for state
    changes (listening started/stopped) without needing to watch the screen.
    Uses only numpy + sounddevice, both already required dependencies -- no
    extra install needed. Fades the first/last ~10ms in/out to avoid a
    clicking pop at the tone's edges."""
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    tone = volume * np.sin(2 * np.pi * freq_hz * t)
    fade_len = max(1, int(sample_rate * 0.01))
    fade = np.linspace(0, 1, fade_len)
    tone[:fade_len] *= fade
    tone[-fade_len:] *= fade[::-1]
    sd.play(tone.astype(np.float32), samplerate=sample_rate)
    sd.wait()


def save_wav(audio: np.ndarray, path: Path, sample_rate: int = SAMPLE_RATE):
    """Writes a float32 [-1,1] mono array out as a 16-bit PCM .wav file,
    using only the stdlib `wave` module (no extra dependency)."""
    import wave
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(float_to_pcm16_bytes(audio))


def cmd_record(args):
    """Interactively records one labeled clip at a time and saves it to
    data/commands/<label>/<speaker>_<index>.wav -- the same layout `evaluate`
    reads from. Prints exactly what phrase to say before each recording.
    Re-running with the same --speaker/--label/--index overwrites that file,
    which is exactly what you want when replacing a bad clip."""
    label_dir = Path(args.data_dir) / args.label
    fname = f"{args.speaker}_{args.index:03d}.wav"
    out_path = label_dir / fname

    phrase = args.say if args.say else args.label.replace("_", " ")
    exists_note = " (this will OVERWRITE the existing file)" if out_path.exists() else ""

    print(f"\nSpeaker:  {args.speaker}")
    print(f"Label:    {args.label}")
    print(f"Saving to: {out_path}{exists_note}")
    print(f"\n>>> Say: \"{phrase}\" <<<\n")
    input(f"Press Enter to record a {args.clip_seconds}s clip...")
    print("Recording...")
    audio = record_clip(args.clip_seconds, SAMPLE_RATE)
    print("Done.")
    save_wav(audio, out_path, SAMPLE_RATE)
    print(f"Saved {out_path}")


def cmd_enroll_voice(args):
    """Records one longer, natural-speech clip and stores it as this
    speaker's voiceprint -- separate from `record`/`enroll`'s per-command
    clips, which are short and single-word (fine for command matching, too
    short/repetitive to be a reliable voiceprint). Re-running overwrites
    the existing voiceprint for that speaker name."""
    print(f"\nSpeaker: {args.speaker}")
    print(f"This will record {args.seconds}s of your natural speaking voice "
          f"(not a command -- just talk normally, e.g. count numbers or describe your day).")
    input("Press Enter to start recording...")
    print("Recording...")
    audio = record_clip(args.seconds, SAMPLE_RATE)
    print("Done. Computing voiceprint...")
    embedding = compute_speaker_embedding(audio, SAMPLE_RATE)
    save_voiceprint(args.speaker, embedding)
    print(f"Saved voiceprint for '{args.speaker}' to {VOICEPRINT_DIR / (args.speaker + '.npy')}")

    # Sanity-check against any other enrolled speakers, so a bad recording
    # (too short, too quiet) gets flagged now rather than silently causing
    # misidentification later during `listen`.
    others = {k: v for k, v in load_all_voiceprints().items() if k != args.speaker}
    if others:
        print("\nSimilarity to other enrolled speakers (should be well below 1.0 -- "
              "if it's close to another speaker's score here, consider re-recording longer/clearer):")
        for name, ref in others.items():
            print(f"  vs {name}: {cosine_similarity(embedding, ref):.2f}")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    whisper_model = load_whisper_cached(args.model_size, device) if args.engine == "whisper" else None
    commands = (
        [c.strip() for c in args.commands.split(",") if c.strip()]
        if args.commands else DEFAULT_COMMANDS
    )

    if args.audio:
        text = transcribe_any(str(args.audio), args, whisper_model)
    elif args.live:
        input(f"Press Enter to record a {args.clip_seconds}s clip...")
        print("Recording...")
        audio = record_clip(args.clip_seconds, SAMPLE_RATE)
        print("Done.")
        text = transcribe_any(audio, args, whisper_model)
    else:
        print("Pass --audio <path> or --live")
        sys.exit(1)

    print(f"Heard: \"{text}\"" if text else "Heard: (no speech detected)")
    cmd, score = best_match(text, commands)
    if score < args.threshold:
        print(f"-> UNKNOWN (closest was '{cmd}' @ {score:.2f}, below threshold {args.threshold:.2f})")
    else:
        print(f"-> {cmd}  (match score {score:.2f})")


def cmd_listen(args):
    """Continuous listening loop meant for actual deployed use (as opposed to
    `recognize --live`, which is a single one-shot attempt for quick manual
    testing). Every cycle gives the user a clear, unambiguous cue for each
    state change and never silently accepts a bad guess -- silence and
    low-confidence results both trigger an automatic retry instead of being
    reported as a command.

    If any speakers have been enrolled via `enroll-voice`, each cycle also
    runs speaker identification on the SAME clip used for the command (no
    extra recording step) -- so the system says "Speaker: ananya" (or
    "unrecognized speaker") on its own, and automatically loads that
    speaker's personalized command profile (from `enroll`) for matching,
    instead of requiring a --speaker flag to be passed in ahead of time.
    An explicit --speaker argument, if given, skips auto-ID and forces that
    speaker's profile -- useful for testing one profile deliberately.

    State machine, repeated every cycle until Ctrl+C:
      READY    -> rising beep, print "Listening..."
      RECORD   -> capture args.clip_seconds of audio
      STOPPED  -> falling beep, so the user knows they can stop talking
      ID       -> (if any voiceprints enrolled) identify who's speaking
      RESULT   -> transcribe + match, one of three outcomes:
          - silence/empty transcription  -> "Didn't hear anything" -> retry
          - matched but below threshold  -> "Didn't understand (heard: X)" -> retry
          - matched with real confidence -> print + (optionally) call
            args.on_command(cmd) so this can be wired into the actual robot
            control loop -- prints by default when run standalone.
    A max-retries-in-a-row counter prints an extra hint (check mic level /
    move closer / speak right after the beep) if several cycles in a row
    come back empty, since that usually means a setup problem, not just bad
    luck on a couple of words.
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    whisper_model = load_whisper_cached(args.model_size, device) if args.engine == "whisper" else None
    commands = (
        [c.strip() for c in args.commands.split(",") if c.strip()]
        if args.commands else DEFAULT_COMMANDS
    )

    voiceprints = load_all_voiceprints()
    if args.speaker:
        print(f"Speaker fixed to '{args.speaker}' (auto-ID skipped).")
    elif voiceprints:
        print(f"Speaker auto-ID enabled ({len(voiceprints)} enrolled: {sorted(voiceprints)})")
    else:
        print("No enrolled voiceprints found -- run `enroll-voice` first for speaker auto-ID. "
              "Continuing without personalization for now.")

    print(f"Listening for: {commands}")
    print("Speak right after the beep. Ctrl+C to stop.\n")

    consecutive_empty = 0
    try:
        while True:
            print("[READY] Listening...")
            play_tone(880, duration=0.12)  # high beep = "go ahead, speak now"
            audio = record_clip(args.clip_seconds, SAMPLE_RATE)
            play_tone(440, duration=0.12)  # low beep = "stopped listening"

            speaker = args.speaker
            if not speaker and voiceprints:
                embedding = compute_speaker_embedding(audio, SAMPLE_RATE)
                identified, id_score = identify_speaker(embedding, voiceprints)
                if identified:
                    speaker = identified
                    print(f"  Speaker: {speaker}  (confidence {id_score:.2f})")
                else:
                    print(f"  Speaker: unrecognized  (closest was {id_score:.2f}, "
                          f"below threshold {SPEAKER_ID_THRESHOLD:.2f})")

            speaker_profile = load_speaker_profile(speaker) if speaker else None
            text = transcribe_any(audio, args, whisper_model)

            if not text:
                consecutive_empty += 1
                print("  Didn't hear anything -- try again.")
                if consecutive_empty >= 3:
                    print("  (Several empty clips in a row -- check the mic isn't muted, "
                          "move closer, or start speaking right after the beep rather than before it.)")
                print()
                continue
            consecutive_empty = 0

            cmd, score = best_match(text, commands, speaker_profile)
            if score < args.threshold:
                print(f"  Didn't understand that (heard: \"{text}\") -- try again.\n")
                continue

            print(f"  Heard: \"{text}\"  ->  {cmd}  (confidence {score:.2f})")
            if args.on_command:
                args.on_command(cmd)
            print()
    except KeyboardInterrupt:
        print("\nStopped listening.")


def cmd_evaluate(args):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    whisper_model = load_whisper_cached(args.model_size, device) if args.engine == "whisper" else None
    data_dir = Path(args.data_dir)

    commands = (
        [c.strip() for c in args.commands.split(",") if c.strip()]
        if args.commands else
        sorted(p.name for p in data_dir.iterdir() if p.is_dir() and p.name != UNKNOWN_LABEL)
    )
    print(f"Engine: {args.engine}"
          + (f" ({args.model_size})" if args.engine == "whisper" else "")
          + f"  |  VAD: {'on' if args.use_vad else 'off'}")
    print(f"Evaluating against commands: {commands}\n")

    per_speaker_stats = {}
    misses = []

    for true_label in commands:
        label_dir = data_dir / true_label
        if not label_dir.exists():
            continue
        for clip_path in sorted(label_dir.glob("*.wav")):
            speaker = re.sub(r"_\d+$", "", clip_path.stem)
            text = transcribe_any(str(clip_path), args, whisper_model)
            predicted, score = best_match(text, commands)
            correct = (predicted == true_label) and (score >= args.threshold)

            stats = per_speaker_stats.setdefault(speaker, {"correct": 0, "total": 0})
            stats["total"] += 1
            if correct:
                stats["correct"] += 1
            else:
                misses.append((true_label, speaker, clip_path.name, text, predicted, score))

    unknown_dir = data_dir / UNKNOWN_LABEL
    false_accepts = 0
    unknown_total = 0
    if unknown_dir.exists():
        for clip_path in sorted(unknown_dir.glob("*.wav")):
            unknown_total += 1
            text = transcribe_any(str(clip_path), args, whisper_model)
            predicted, score = best_match(text, commands)
            if score >= args.threshold:
                false_accepts += 1
                misses.append((UNKNOWN_LABEL, re.sub(r"_\d+$", "", clip_path.stem),
                                clip_path.name, text, predicted, score))

    print("=== Per-speaker accuracy on real commands ===")
    total_correct = total_all = 0
    for speaker, stats in sorted(per_speaker_stats.items()):
        acc = stats["correct"] / stats["total"] if stats["total"] else 0.0
        print(f"  {speaker:<12} {stats['correct']}/{stats['total']}  ({acc:.1%})")
        total_correct += stats["correct"]
        total_all += stats["total"]
    overall_acc = total_correct / total_all if total_all else 0.0
    print(f"  {'OVERALL':<12} {total_correct}/{total_all}  ({overall_acc:.1%})")

    if unknown_total:
        print(f"\n=== 'unknown' clips false-accepted as a real command: "
              f"{false_accepts}/{unknown_total} ({false_accepts/unknown_total:.1%}) ===")

    if misses:
        print(f"\n=== Misses ({len(misses)}) ===")
        for true_label, speaker, fname, heard, predicted, score in misses:
            heard_display = heard if heard else "(no speech detected)"
            print(f"  [{speaker}] {fname}: true='{true_label}'  heard=\"{heard_display}\"  "
                  f"predicted='{predicted}' ({score:.2f})")


def add_common_args(p):
    p.add_argument("--engine", choices=["whisper", "vosk"], default="whisper")
    p.add_argument("--model-size", default="tiny", choices=["tiny", "base", "small", "medium"],
                   help="Whisper model size (ignored if --engine vosk). Bigger = more accurate, slower.")
    p.add_argument("--vosk-model-path", type=str, default=None,
                   help="path to a downloaded Vosk model directory (required if --engine vosk)")
    p.add_argument("--use-vad", action="store_true",
                   help="trim each clip to its voiced region before transcribing "
                        "(WebRTC VAD if installed, else a pure-Python energy-based fallback)")
    p.add_argument("--vad-aggressiveness", type=int, default=2, choices=[0, 1, 2, 3],
                   help="0=least aggressive (keeps more audio) .. 3=most aggressive (trims more)")
    p.add_argument("--threshold", type=float, default=DEFAULT_MATCH_THRESHOLD)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="subcommand", required=True)

    p_rec = sub.add_parser("recognize")
    p_rec.add_argument("--audio", type=Path, default=None)
    p_rec.add_argument("--live", action="store_true")
    p_rec.add_argument("--commands", type=str, default=None)
    p_rec.add_argument("--clip-seconds", type=float, default=CLIP_SECONDS)
    add_common_args(p_rec)
    p_rec.set_defaults(func=cmd_recognize)

    p_eval = sub.add_parser("evaluate")
    p_eval.add_argument("--data-dir", type=Path, default=Path("data/commands"))
    p_eval.add_argument("--commands", type=str, default=None)
    add_common_args(p_eval)
    p_eval.set_defaults(func=cmd_evaluate)

    p_record = sub.add_parser("record")
    p_record.add_argument("--data-dir", type=Path, default=Path("data/commands"))
    p_record.add_argument("--speaker", type=str, required=True,
                           help="e.g. ananya, avinandan")
    p_record.add_argument("--label", type=str, required=True,
                           help="the folder/true-label this clip belongs under, "
                                "e.g. stop, go_left, unknown")
    p_record.add_argument("--index", type=int, required=True,
                           help="clip number, e.g. 1 for ananya_001.wav")
    p_record.add_argument("--say", type=str, default=None,
                           help="exact phrase to prompt the speaker to say; "
                                "defaults to --label with underscores as spaces")
    p_record.add_argument("--clip-seconds", type=float, default=CLIP_SECONDS)
    p_record.set_defaults(func=cmd_record)

    p_listen = sub.add_parser("listen")
    p_listen.add_argument("--commands", type=str, default=None)
    p_listen.add_argument("--clip-seconds", type=float, default=CLIP_SECONDS)
    p_listen.add_argument("--speaker", type=str, default=None,
                           help="force this speaker's profile instead of auto-identifying "
                                "from voice (skips speaker ID entirely)")
    add_common_args(p_listen)
    p_listen.set_defaults(func=cmd_listen, on_command=None)

    p_enroll_voice = sub.add_parser("enroll-voice")
    p_enroll_voice.add_argument("--speaker", type=str, required=True)
    p_enroll_voice.add_argument("--seconds", type=float, default=8.0,
                                 help="length of the natural-speech clip used to build the voiceprint")
    p_enroll_voice.set_defaults(func=cmd_enroll_voice)

    args = parser.parse_args()
    if getattr(args, "engine", None) == "vosk" and not args.vosk_model_path:
        parser.error("--vosk-model-path is required when --engine vosk")
    args.func(args)


if __name__ == "__main__":
    main()
