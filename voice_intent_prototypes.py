"""
Accent-aware voice-command recognizer: gTTS baseline + PER-SPEAKER personal
calibration, matched with a frozen Whisper encoder, classified by nearest
prototype (cosine similarity).

IMPORTANT: prototypes are kept separate PER SPEAKER, not averaged together.
Different people's accents can diverge enough that a blended centroid
matches neither voice well -- so each command gets one prototype row per
speaker who recorded it, plus one row from the gTTS baseline. Recognition
picks whichever single row (any speaker, any command) is closest, so each
person is effectively matched against their own voice.

SUBCOMMANDS:
  calibrate  -- record yourself saying each command a few times; each clip
                is compared (cosine similarity) against the gTTS baseline
                for that command and the score is printed live -- this IS
                the "accent evaluation" step. Clips are saved to disk in
                the same data/commands/<label>/<speaker>_NNN.wav layout the
                earlier recorder script uses.
  build      -- combine the gTTS baseline + every recorded clip on disk,
                grouped PER SPEAKER (never averaged across speakers), into
                one prototype row per (command, speaker), and save a
                checkpoint.
  recognize  -- embed a new clip (file or live mic), find the single
                closest prototype row across everyone, and report its
                command + which speaker's voice (or the gTTS baseline)
                it matched, plus confidence.

USAGE:
    pip install openai-whisper torch numpy sounddevice soundfile

    # first: python generate_gtts_baseline.py

    python voice_intent_prototypes.py calibrate --speaker ananya
    python voice_intent_prototypes.py calibrate --speaker avinandan
    python voice_intent_prototypes.py build

    python voice_intent_prototypes.py recognize --live
    python voice_intent_prototypes.py recognize --audio data/commands/stop/ananya_001.wav
"""

import argparse
import re
import sys
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf
import torch
import whisper
from whisper.audio import HOP_LENGTH

SAMPLE_RATE = 16_000
CLIP_SECONDS = 2.0
UNKNOWN_LABEL = "unknown"
GTTS_TAG = "gtts_baseline"
DEFAULT_UNKNOWN_THRESHOLD = 0.55  # below this best-match similarity -> report "unknown"

_whisper_cache = {}


def load_whisper_cached(model_size: str, device: str):
    key = (model_size, device)
    if key not in _whisper_cache:
        print(f"Loading whisper-{model_size} encoder (frozen)...")
        model = whisper.load_model(model_size, device=device)
        model.eval()
        for p in model.parameters():
            p.requires_grad = False
        _whisper_cache[key] = model
    return _whisper_cache[key]


def embed_array(audio: np.ndarray, whisper_model, device: str) -> np.ndarray:
    # Whisper's encoder in this version REQUIRES the exact padded 30s shape
    # (it asserts against fixed positional embeddings, no variable length).
    # So we still pad to 30s -- but only mean-pool over the OUTPUT frames
    # that correspond to real audio, not the full 1500. Without this, ~2s
    # of speech padded into a 30s window means ~93% of the pooled vector is
    # "silence," which is why every command scored ~0.98-0.99 against
    # everything else regardless of content.
    audio_f32 = audio.astype(np.float32)
    real_len_samples = len(audio_f32)
    padded = whisper.pad_or_trim(audio_f32)  # forces exact N_SAMPLES (30s)
    mel = whisper.log_mel_spectrogram(padded).to(device)
    with torch.no_grad():
        enc_out = whisper_model.encoder(mel.unsqueeze(0))  # (1, 1500, D), fixed length
    # pad_or_trim pads with zeros at the END, and the encoder halves the mel
    # frame count once (its stride-2 conv), so real content occupies roughly
    # the first (real_len_samples / (HOP_LENGTH * 2)) output frames.
    real_frames = max(1, min(enc_out.shape[1], real_len_samples // (HOP_LENGTH * 2)))
    pooled = enc_out[:, :real_frames, :].mean(dim=1).squeeze(0).cpu().numpy()
    return pooled / (np.linalg.norm(pooled) + 1e-8)


def embed_path(path: Path, whisper_model, device: str) -> np.ndarray:
    audio = whisper.load_audio(str(path))
    return embed_array(audio, whisper_model, device)


def record_clip(seconds: float, sample_rate: int) -> np.ndarray:
    audio = sd.rec(int(seconds * sample_rate), samplerate=sample_rate, channels=1, dtype="float32")
    sd.wait()
    return audio.squeeze()


def parse_speaker_from_stem(stem: str) -> str:
    """'ananya_015' -> 'ananya'. Falls back to the whole stem if it doesn't
    match the '<speaker>_<NNN>' pattern the recorder scripts write."""
    m = re.match(r"^(.*)_(\d+)$", stem)
    return m.group(1) if m else stem


def cmd_calibrate(args):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    whisper_model = load_whisper_cached(args.model_size, device)

    baseline_dir = Path(args.baseline_dir)
    if not baseline_dir.exists():
        print(f"No baseline dir at {baseline_dir}. Run generate_gtts_baseline.py first.")
        sys.exit(1)

    commands = (
        [c.strip() for c in args.commands.split(",") if c.strip()]
        if args.commands else
        sorted(p.stem for p in baseline_dir.glob("*.mp3"))
    )
    if not commands:
        print("No commands found (no baseline .mp3 files, and none passed via --commands).")
        sys.exit(1)

    out_root = Path(args.out_dir)
    print(f"Speaker: {args.speaker}  |  Commands: {commands}")
    input("Press Enter when ready (make sure your mic is selected)...")

    for label in commands:
        baseline_path = baseline_dir / f"{label}.mp3"
        if not baseline_path.exists():
            print(f"[skip] no gTTS baseline for '{label}' at {baseline_path}")
            continue
        baseline_vec = embed_path(baseline_path, whisper_model, device)

        label_dir = out_root / label
        label_dir.mkdir(parents=True, exist_ok=True)
        existing = list(label_dir.glob(f"{args.speaker}_*.wav"))
        start_idx = len(existing) + 1
        end_idx = start_idx + args.per_command - 1

        print(f"\n=== '{label}' -- speaker: {args.speaker} -- target: {args.per_command} clips ===")
        i = start_idx
        while i <= end_idx:
            cmd = input(
                f"[{i}/{end_idx}] say: \"{label.replace('_', ' ')}\" "
                f"-- Enter=record, s=skip label, q=quit: "
            ).strip().lower()
            if cmd == "q":
                print("Stopping early -- everything recorded so far is saved.")
                return
            if cmd == "s":
                print(f"Skipping remaining '{label}' clips.")
                break

            print("Recording...")
            audio = record_clip(args.clip_seconds, SAMPLE_RATE)
            print("Done.")

            while True:
                choice = input("Keep this clip? [Enter=keep, p=playback, r=redo]: ").strip().lower()
                if choice == "p":
                    sd.play(audio, SAMPLE_RATE)
                    sd.wait()
                    continue
                if choice == "r":
                    print("Re-recording...")
                    audio = record_clip(args.clip_seconds, SAMPLE_RATE)
                    print("Done.")
                    continue
                break

            clip_vec = embed_array(audio, whisper_model, device)
            similarity = float(np.dot(clip_vec, baseline_vec))
            print(f"  accent match vs. gTTS baseline: {similarity:.3f} "
                  f"(1.0 = identical to baseline, lower = more accent divergence)")

            clip_path = label_dir / f"{args.speaker}_{i:03d}.wav"
            sf.write(clip_path, audio, SAMPLE_RATE)
            print(f"  saved {clip_path}")
            i += 1

    print(f"\nDone calibrating for '{args.speaker}'. Run 'build' once everyone's done.")


def cmd_build(args):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    whisper_model = load_whisper_cached(args.model_size, device)

    baseline_dir = Path(args.baseline_dir)
    data_dir = Path(args.data_dir)

    baseline_vecs = {}
    if baseline_dir.exists():
        for p in sorted(baseline_dir.glob("*.mp3")):
            baseline_vecs[p.stem] = embed_path(p, whisper_model, device)
    print(f"Loaded {len(baseline_vecs)} gTTS baseline vectors: {sorted(baseline_vecs)}")

    # label -> speaker -> list of vectors. NEVER merged across speakers.
    personal_vecs = {}
    all_speakers = set()
    if data_dir.exists():
        for label_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
            if label_dir.name == UNKNOWN_LABEL:
                continue  # informs the rejection threshold only, not a prototype
            clips = sorted(label_dir.glob("*.wav"))
            if not clips:
                continue
            by_speaker = {}
            for clip_path in clips:
                speaker = parse_speaker_from_stem(clip_path.stem)
                by_speaker.setdefault(speaker, []).append(
                    embed_path(clip_path, whisper_model, device)
                )
            personal_vecs[label_dir.name] = by_speaker
            all_speakers.update(by_speaker)
            counts = {s: len(v) for s, v in by_speaker.items()}
            print(f"  {label_dir.name}: {counts}")

    labels = sorted(set(baseline_vecs) | set(personal_vecs))
    if not labels:
        print("Nothing to build from -- no baseline clips and no personal clips found.")
        sys.exit(1)

    row_vectors, row_labels, row_speakers = [], [], []

    for label in labels:
        # One row per speaker, blended with baseline if available -- but
        # NEVER blended with each other. Different accents stay separate.
        for speaker, vecs in personal_vecs.get(label, {}).items():
            speaker_mean = np.mean(vecs, axis=0)
            speaker_mean = speaker_mean / (np.linalg.norm(speaker_mean) + 1e-8)
            if label in baseline_vecs and args.baseline_weight > 0:
                combined = (args.baseline_weight * baseline_vecs[label]
                            + (1 - args.baseline_weight) * speaker_mean)
            else:
                combined = speaker_mean
            combined = combined / (np.linalg.norm(combined) + 1e-8)
            row_vectors.append(combined)
            row_labels.append(label)
            row_speakers.append(speaker)

        # Always also keep the raw gTTS baseline as its own row, unblended --
        # useful for a new speaker who hasn't calibrated yet.
        if label in baseline_vecs:
            row_vectors.append(baseline_vecs[label])
            row_labels.append(label)
            row_speakers.append(GTTS_TAG)

    proto_matrix = torch.tensor(np.stack(row_vectors), dtype=torch.float32)

    # Set the "unknown" rejection threshold as the MIDPOINT between two
    # measured distributions, not an arbitrary offset (an offset risks
    # landing above 1.0, which is the hard ceiling for cosine similarity on
    # normalized vectors -- a threshold above 1.0 can never be crossed and
    # would silently reject everything as unknown).
    #   - "genuine" = how well each personal clip matches ITS OWN best
    #     prototype among everything built (should score high)
    #   - "unknown" = how well actual non-command clips match the closest
    #     prototype (should score lower)
    proto_np = proto_matrix.numpy()
    genuine_sims = []
    for label, speaker_vecs in personal_vecs.items():
        for speaker, vecs in speaker_vecs.items():
            for v in vecs:
                genuine_sims.append(float(np.max(proto_np @ v)))

    unknown_dir = data_dir / UNKNOWN_LABEL
    suggested_threshold = args.unknown_threshold
    if unknown_dir.exists() and genuine_sims:
        unk_clips = sorted(unknown_dir.glob("*.wav"))
        if unk_clips:
            unk_vecs = [embed_path(c, whisper_model, device) for c in unk_clips]
            unknown_sims = [float(np.max(proto_np @ v)) for v in unk_vecs]
            genuine_mean = float(np.mean(genuine_sims))
            unknown_mean = float(np.mean(unknown_sims))
            suggested = (genuine_mean + unknown_mean) / 2
            suggested = min(suggested, 0.999)  # 1.0 is the hard ceiling; never suggest above it
            print(f"genuine command clips: avg best-match similarity = {genuine_mean:.3f}")
            print(f"'unknown' clips: avg best-match similarity = {unknown_mean:.3f}")
            print(f"-> suggested threshold (midpoint): {suggested:.3f}")
            if unknown_mean >= genuine_mean:
                print("WARNING: unknown clips are scoring as high as (or higher than) genuine "
                      "commands -- the classifier isn't separating them well. More/cleaner "
                      "'unknown' data, or more command clips, would help more than tuning "
                      "this threshold.")
            suggested_threshold = suggested

    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "encoder": f"whisper-{args.model_size}",
        "labels": row_labels,       # one entry per row, can repeat across speakers
        "speakers": row_speakers,   # parallel list: which speaker (or gtts_baseline) each row is
        "prototypes": proto_matrix,  # (n_rows, dim), L2-normalized rows
        "unknown_threshold": suggested_threshold,
    }, args.out)
    print(f"\nSaved {len(row_labels)} prototype rows "
          f"({len(labels)} commands x speakers incl. gTTS baseline) to {args.out} "
          f"(unknown_threshold={suggested_threshold:.3f})")


def cmd_recognize(args):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    ckpt = torch.load(args.checkpoint, map_location=device, weights_only=False)
    model_size = ckpt["encoder"].split("-", 1)[1]
    whisper_model = load_whisper_cached(model_size, device)

    labels = ckpt["labels"]
    speakers = ckpt["speakers"]
    prototypes = ckpt["prototypes"].numpy()
    threshold = ckpt["unknown_threshold"]

    if args.audio:
        vec = embed_path(Path(args.audio), whisper_model, device)
    elif args.live:
        input(f"Press Enter to record a {args.clip_seconds}s clip...")
        print("Recording...")
        audio = record_clip(args.clip_seconds, SAMPLE_RATE)
        print("Done.")
        vec = embed_array(audio, whisper_model, device)
    else:
        print("Pass --audio <path> or --live")
        sys.exit(1)

    sims = prototypes @ vec  # cosine similarity, rows already L2-normalized
    order = np.argsort(-sims)
    print("\nTop matches:")
    for idx in order[:min(5, len(labels))]:
        print(f"  {labels[idx]:<15} (matched {speakers[idx]:<14}) similarity={sims[idx]:.3f}")

    best_idx = order[0]
    if sims[best_idx] < threshold:
        print(f"\n-> UNKNOWN (best match {labels[best_idx]} via {speakers[best_idx]} "
              f"@ {sims[best_idx]:.3f} is below threshold {threshold:.3f})")
    else:
        print(f"\n-> {labels[best_idx]}  (matched {speakers[best_idx]}'s voice, "
              f"confidence {sims[best_idx]:.3f})")


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="subcommand", required=True)

    p_cal = sub.add_parser("calibrate")
    p_cal.add_argument("--speaker", required=True)
    p_cal.add_argument("--commands", type=str, default=None)
    p_cal.add_argument("--baseline-dir", type=Path, default=Path("data/baseline_gtts"))
    p_cal.add_argument("--out-dir", type=Path, default=Path("data/commands"))
    p_cal.add_argument("--per-command", type=int, default=10)
    p_cal.add_argument("--clip-seconds", type=float, default=CLIP_SECONDS)
    p_cal.add_argument("--model-size", default="tiny", choices=["tiny", "base"])
    p_cal.set_defaults(func=cmd_calibrate)

    p_build = sub.add_parser("build")
    p_build.add_argument("--baseline-dir", type=Path, default=Path("data/baseline_gtts"))
    p_build.add_argument("--data-dir", type=Path, default=Path("data/commands"))
    p_build.add_argument("--out", type=Path, default=Path("checkpoints/intent_prototypes.pt"))
    p_build.add_argument("--model-size", default="tiny", choices=["tiny", "base"])
    p_build.add_argument("--baseline-weight", type=float, default=0.3,
                          help="how much each speaker's own prototype leans toward the gTTS "
                               "baseline (0 = pure personal voice, 1 = pure canonical pronunciation)")
    p_build.add_argument("--unknown-threshold", type=float, default=DEFAULT_UNKNOWN_THRESHOLD,
                          help="fallback if no 'unknown' clips exist to auto-suggest one")
    p_build.set_defaults(func=cmd_build)

    p_rec = sub.add_parser("recognize")
    p_rec.add_argument("--checkpoint", type=Path, default=Path("checkpoints/intent_prototypes.pt"))
    p_rec.add_argument("--audio", type=Path, default=None)
    p_rec.add_argument("--live", action="store_true")
    p_rec.add_argument("--clip-seconds", type=float, default=CLIP_SECONDS)
    p_rec.set_defaults(func=cmd_recognize)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
