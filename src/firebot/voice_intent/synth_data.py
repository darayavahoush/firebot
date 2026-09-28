"""Build a training set for the voice-intent classifier.

Two sources feed the same manifest:

1. Synthetic: every template phrase in `vocab.py`, spoken by every installed
   offline TTS voice (via `pyttsx3` -- no model download, no network), each
   optionally re-synthesized at a couple of rates/pitches for variety, then
   passed through light audio augmentation (gain, gaussian noise, a small
   time-stretch/pitch-shift) so the classifier doesn't overfit to one flat
   TTS timbre.
2. Real: point `--real-dir` at a folder of your own recordings laid out as
   `<label>/<anything>.wav` (label must be one of `vocab.CLASSES`) and they're
   copied in and merged into the same manifest, so real + synthetic data train
   together with no special-casing downstream.

Output layout:
    <out>/
      manifest.csv         # columns: path,label,source
      audio/<label>/*.wav  # 16kHz mono wav files

Usage:
    python -m firebot.voice_intent.synth_data --out data/voice_intent \
        [--real-dir path/to/your/recordings] \
        [--variants-per-voice 2] [--augment 2]

Needs: pyttsx3, numpy, soundfile, librosa (see requirements.txt). pyttsx3
shells out to whatever TTS engine your OS already has (NSSpeechSynthesizer on
macOS, SAPI5 on Windows, espeak/espeak-ng on Linux) -- install espeak-ng first
on Linux if `pyttsx3.init()` errors with "no voices found".
"""
from __future__ import annotations

import argparse
import csv
import itertools
import re
import sys
from pathlib import Path

import numpy as np

from . import vocab

SAMPLE_RATE = 16_000

# macOS "novelty" voices: they sing, hum, ring, bleat or are heavily distorted
# rather than speak. They don't resemble a person talking near the robot, so
# training on them mostly adds noise. Opt out of them with --no-novelty-voices.
NOVELTY_VOICE_NAMES = frozenset({
    "albert", "badnews", "bahh", "bells", "boing", "bubbles", "cellos",
    "deranged", "goodnews", "hysterical", "organ", "trinoids", "whisper", "zarvox",
})

# Unique per synthesis attempt, independent of the output clip's own index --
# see `_synthesize`'s docstring for why this matters.
_tmp_counter = itertools.count()

_LOCALE_SEGMENT = re.compile(r"[a-z]{2}-[a-z]{2}")


def _voice_lang_matches(voice, lang_filter: str) -> bool:
    """True if `voice` counts as matching `lang_filter` (e.g. "en").

    Matches against the voice's actual locale, not a substring of the raw id.
    A plain `lang_filter in voice.id.lower()` check (the previous behaviour)
    lets unrelated voices through by coincidence of spelling -- the voice
    *family* name "eloquence" contains "en", and so does the voice *name*
    "Ellen", so a filter of "en" was matching German/French/Japanese/Chinese
    Eloquence voices and a Dutch "Ellen" voice, none of which are English.

    Preference order: pyttsx3's own `voice.languages` when the backend fills
    it in, then a locale-shaped segment of the id (macOS ids look like
    `com.apple.<family>.<locale>.<name>`, e.g. `com.apple.eloquence.de-DE.Sandy`).
    Only if neither is available do we fall back to the old substring check,
    since some backends (e.g. espeak ids like "english-us") don't expose a
    clean locale token at all.
    """
    lang_filter = lang_filter.lower()
    for lang in getattr(voice, "languages", None) or []:
        if isinstance(lang, bytes):
            lang = lang.decode("utf-8", "ignore")
        if lang.lower().replace("_", "-").startswith(lang_filter):
            return True

    segments = re.split(r"[._]", voice.id.lower())
    locale_segments = [s for s in segments if _LOCALE_SEGMENT.fullmatch(s)]
    if locale_segments:
        return any(s.startswith(lang_filter) for s in locale_segments)

    return lang_filter in voice.id.lower()


def _voice_name(voice_id: str) -> str:
    """Last dotted segment of a voice id, lowercased:
    'com.apple.speech.synthesis.voice.Albert' -> 'albert'."""
    return voice_id.rsplit(".", 1)[-1].lower()


def _exclude_voices(voices: list, names: set[str] | frozenset[str]) -> list:
    """Drop voices whose name (see `_voice_name`) is in `names` (lowercase)."""
    return [v for v in voices if _voice_name(v.id) not in names]


def _new_engine():
    import pyttsx3

    return pyttsx3.init()


def _get_tts_voices(voice_filter: str | None):
    engine = _new_engine()
    voices = engine.getProperty("voices")
    if not voices:
        raise RuntimeError(
            "No TTS voices found. On Linux, install espeak-ng "
            "(e.g. `apt install espeak-ng`) and retry."
        )
    if voice_filter:
        voices = [v for v in voices if _voice_lang_matches(v, voice_filter)]
        if not voices:
            raise RuntimeError(f"No voices matched --voice-filter {voice_filter!r}. "
                                f"Run without --voice-filter to see all installed voice ids.")
    return voices


def _probe_voices(voices: list, out_dir: Path, test_phrases: list[str] | None = None) -> list:
    """Drop voices that fail on any of a few representative synths, before the
    full phrase sweep.

    Some installed voices fail to render via pyttsx3's save-to-file path on
    some systems -- in testing, this was every locale of macOS's Eloquence
    family, not just the ones a bad filter let through. Without this check,
    every one of those voices fails identically on every single phrase in
    every class, which is slow and produces a wall of duplicate warnings.

    A single generic test phrase isn't enough, though: on this project's own
    test machine, macOS's old "Albert" (legacy Speech Synthesis Manager)
    voice rendered a short throwaway phrase fine but then failed on *every*
    real vocabulary phrase in the main loop -- so the probe now checks a
    handful of phrases sampled from the real phrase table (short and long)
    instead of one toy sentence, to actually catch that.
    """
    if test_phrases is None:
        table = vocab.build_phrase_table()
        # A handful of real phrases, picked for a spread of lengths rather
        # than every class (that's what the main loop is for) -- enough to
        # catch a voice that only breaks on longer/more complex text.
        pool = [p for phrases in table.values() for p in phrases]
        pool.sort(key=len)
        test_phrases = [pool[0], pool[len(pool) // 2], pool[-1]] if pool else ["testing one two three"]

    scratch = out_dir / ".voice_probe.wav"
    good: list = []
    bad: list[tuple[str, str]] = []
    for voice in voices:
        failure = None
        for phrase in test_phrases:
            try:
                _synthesize(voice.id, 175, phrase, scratch)
            except Exception as exc:  # noqa: BLE001
                failure = f"{exc} (phrase={phrase!r})"
                break
        if failure is not None:
            bad.append((voice.id, failure))
        else:
            good.append(voice)
    scratch.unlink(missing_ok=True)
    if bad:
        print(f"  skipping {len(bad)} voice(s) that failed a quick audio check:",
              file=sys.stderr)
        for voice_id, reason in bad:
            print(f"    {voice_id}: {reason}", file=sys.stderr)
    return good


def _synthesize(voice_id: str, rate: int, text: str, out_wav: Path,
                 engine_factory=_new_engine, max_attempts: int = 3,
                 retry_delay: float = 0.2) -> None:
    """Render one utterance to `out_wav` at SAMPLE_RATE mono via pyttsx3.

    Retries a few times, with a short pause, specifically on a zero-sample
    result: pyttsx3's macOS driver has documented cases of `runAndWait()`
    returning before the OS has actually finished flushing the saved file,
    which reads back as empty audio even though nothing was really wrong with
    the synthesis itself. A brand-new engine per call is separate insurance
    against a *different*, now-ruled-out theory (one engine instance
    degrading after heavy reuse) -- testing showed a fresh-engine-per-call
    version fail identically to the shared-engine version, so that wasn't the
    (or wasn't the only) cause. It's kept anyway for resource hygiene: this
    script has already once run a process out of file descriptors, and
    `gc.collect()` below releases each outgoing engine's native handles
    immediately rather than letting them pile up.
    """
    import gc
    import time

    for attempt in range(1, max_attempts + 1):
        engine = engine_factory()
        try:
            engine.setProperty("voice", voice_id)
            engine.setProperty("rate", rate)
            # The temp filename is a global counter, not derived from
            # `out_wav`: `out_wav` reuses the same clip index for every
            # failed attempt (the caller only advances it on success), so
            # deriving the temp name from it made every failed attempt
            # collide on one shared temp file, which made retries and
            # concurrent-looking failures hard to tell apart in the logs.
            tmp = out_wav.parent / f".tmp_{next(_tmp_counter):08d}.raw.wav"
            try:
                engine.save_to_file(text, str(tmp))
                engine.runAndWait()
                _resample_to_target(tmp, out_wav)
                return
            except EmptyAudioError:
                if attempt == max_attempts:
                    raise
                time.sleep(retry_delay)
            finally:
                tmp.unlink(missing_ok=True)
        finally:
            try:
                engine.stop()
            except Exception as exc:  # noqa: BLE001
                print(f"  [warn] failed to stop TTS engine cleanly: {exc}", file=sys.stderr)
            del engine
            gc.collect()


class EmptyAudioError(RuntimeError):
    """Raised when a TTS engine silently produced a zero-length clip (some
    voice/rate combinations do this intermittently instead of erroring)."""


def _resample_to_target(src: Path, dst: Path) -> None:
    import librosa
    import soundfile as sf

    audio, sr = librosa.load(str(src), sr=SAMPLE_RATE, mono=True)
    if audio.size == 0:
        raise EmptyAudioError(f"{src} decoded to zero samples")
    sf.write(str(dst), audio, SAMPLE_RATE, subtype="PCM_16")


def _augment(audio: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """One randomized augmentation: small gain, gaussian noise, tiny
    time-stretch, applied independently so clips stay recognizable speech,
    not a stress test -- this is meant to cover ordinary mic/room variation,
    not adversarial noise."""
    import librosa

    out = audio.copy()
    if rng.random() < 0.8:
        out = out * rng.uniform(0.6, 1.3)
    if rng.random() < 0.7:
        noise_level = rng.uniform(0.002, 0.012)
        out = out + rng.normal(0, noise_level, size=out.shape).astype(np.float32)
    if rng.random() < 0.5:
        rate = rng.uniform(0.92, 1.08)
        out = librosa.effects.time_stretch(out.astype(np.float32), rate=rate)
    if rng.random() < 0.4:
        n_steps = rng.uniform(-1.5, 1.5)
        out = librosa.effects.pitch_shift(out.astype(np.float32), sr=SAMPLE_RATE, n_steps=n_steps)
    peak = np.abs(out).max()
    if peak > 0.99:
        out = out / peak * 0.99
    return out.astype(np.float32)


def generate_synthetic(out_dir: Path, variants_per_voice: int, augment: int,
                        limit_per_class: int | None, voice_filter: str | None = "en",
                        seed: int = 0,
                        exclude_voices: set[str] | frozenset[str] = frozenset()
                        ) -> list[tuple[Path, str, str, str, str]]:
    import soundfile as sf

    voices = _get_tts_voices(voice_filter)
    if exclude_voices:
        before = len(voices)
        voices = _exclude_voices(voices, exclude_voices)
        print(f"  excluded {before - len(voices)} voice(s) by name")
    voices = _probe_voices(voices, out_dir)
    if not voices:
        raise RuntimeError(
            "Every installed voice failed a quick audio check -- none can "
            "actually render text on this machine. See the [warn] lines "
            "above for why each one failed."
        )
    print(f"  using {len(voices)} voice(s): {[v.id for v in voices]}")
    rng = np.random.default_rng(seed)
    table = vocab.build_phrase_table()
    rows: list[tuple[Path, str, str, str, str]] = []
    audio_root = out_dir / "audio"

    for label, phrases in table.items():
        if limit_per_class is not None:
            phrases = phrases[:limit_per_class]
        label_dir = audio_root / label
        label_dir.mkdir(parents=True, exist_ok=True)
        clip_idx = 0
        for phrase in phrases:
            for voice in voices:
                for v in range(variants_per_voice):
                    rate = int(rng.integers(150, 200))
                    base_path = label_dir / f"{clip_idx:05d}_tts.wav"
                    try:
                        _synthesize(voice.id, rate, phrase, base_path)
                    except Exception as exc:  # noqa: BLE001
                        print(f"  [warn] TTS failed for voice={voice.id!r} "
                              f"phrase={phrase!r}: {exc}", file=sys.stderr)
                        base_path.unlink(missing_ok=True)
                        continue
                    rows.append((base_path, label, "synth_tts", voice.id, phrase))
                    clip_idx += 1

                    audio, _ = sf.read(str(base_path), dtype="float32")
                    for a in range(augment):
                        aug_path = label_dir / f"{clip_idx:05d}_aug.wav"
                        aug_audio = _augment(audio, rng)
                        if aug_audio.size == 0:
                            print(f"  [warn] augmentation of {base_path} produced empty "
                                  f"audio, skipping this augmented copy", file=sys.stderr)
                            continue
                        sf.write(str(aug_path), aug_audio, SAMPLE_RATE, subtype="PCM_16")
                        rows.append((aug_path, label, "synth_aug", voice.id, phrase))
                        clip_idx += 1
        print(f"  {label:16s} -> {clip_idx} clips")
    return rows


_REAL_SPEAKER = re.compile(r"^(?P<name>.+?)_\d+$")


def _real_speaker(stem: str) -> str:
    """'ananya_007' -> 'ananya'; anything not shaped like <name>_<take> -> 'real'."""
    m = _REAL_SPEAKER.match(stem)
    return m.group("name").lower() if m else "real"


def merge_real(real_dir: Path, out_dir: Path) -> list[tuple[Path, str, str, str, str]]:
    rows: list[tuple[Path, str, str, str, str]] = []
    audio_root = out_dir / "audio"
    for label_dir in sorted(real_dir.iterdir()):
        if not label_dir.is_dir():
            continue
        label = label_dir.name
        if label not in vocab.LABEL_TO_IDX:
            print(f"  [warn] skipping {label_dir} -- {label!r} is not a known "
                  f"class (see vocab.CLASSES)", file=sys.stderr)
            continue
        dest_dir = audio_root / label
        dest_dir.mkdir(parents=True, exist_ok=True)
        for i, wav in enumerate(sorted(label_dir.glob("*.wav"))):
            dest = dest_dir / f"real_{i:05d}_{wav.stem}.wav"
            _resample_to_target(wav, dest)
            rows.append((dest, label, "real", _real_speaker(wav.stem), ""))
    return rows


def write_manifest(rows: list[tuple[Path, str, str, str, str]], out_dir: Path) -> None:
    manifest = out_dir / "manifest.csv"
    with manifest.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "label", "source", "speaker", "phrase"])
        for path, label, source, speaker, phrase in rows:
            w.writerow([str(path.relative_to(out_dir)), label, source, speaker, phrase])
    print(f"\nWrote {len(rows)} rows to {manifest}")
    by_label: dict[str, int] = {}
    for _, label, *_rest in rows:
        by_label[label] = by_label.get(label, 0) + 1
    for label in vocab.CLASSES:
        n = by_label.get(label, 0)
        flag = "  <-- 0 examples!" if n == 0 else ""
        print(f"  {label:16s} {n:5d}{flag}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True, help="output directory")
    ap.add_argument("--real-dir", type=Path, default=None,
                     help="optional folder of <label>/*.wav real recordings to merge in")
    ap.add_argument("--variants-per-voice", type=int, default=1,
                     help="how many times to re-synthesize each phrase per installed voice")
    ap.add_argument("--augment", type=int, default=2,
                     help="augmented copies to generate per synthesized clip")
    ap.add_argument("--limit-per-class", type=int, default=None,
                     help="cap template phrases per class, for a quick smoke-test run")
    ap.add_argument("--voice-filter", type=str, default="en",
                     help="locale prefix to filter installed TTS voices by (default 'en' for "
                          "English variants only; pass '' to use every installed voice/language). "
                          "Matched against each voice's actual language tag/locale, not a raw "
                          "substring of its id")
    ap.add_argument("--exclude-voices", type=str, default="",
                     help="comma-separated voice NAMES to skip (e.g. 'Fred,Ralph'); the name is "
                          "the last dotted part of the voice id")
    ap.add_argument("--no-novelty-voices", action="store_true",
                     help="skip macOS novelty voices (Albert, Bells, Zarvox, Organ, ... -- they "
                          "sing/hum/distort rather than speak)")
    ap.add_argument("--skip-synth", action="store_true",
                     help="only merge --real-dir, skip TTS generation (e.g. re-running after adding recordings)")
    args = ap.parse_args()

    exclude = {n.strip().lower() for n in args.exclude_voices.split(",") if n.strip()}
    if args.no_novelty_voices:
        exclude |= NOVELTY_VOICE_NAMES

    args.out.mkdir(parents=True, exist_ok=True)
    rows: list[tuple[Path, str, str, str, str]] = []

    if not args.skip_synth:
        print("Generating synthetic (TTS) data...")
        rows += generate_synthetic(args.out, args.variants_per_voice, args.augment,
                                    args.limit_per_class, args.voice_filter or None,
                                    exclude_voices=exclude)

    if args.real_dir is not None:
        print(f"Merging real recordings from {args.real_dir}...")
        rows += merge_real(args.real_dir, args.out)

    if not rows:
        print("Nothing generated -- pass --real-dir or drop --skip-synth.", file=sys.stderr)
        sys.exit(1)

    write_manifest(rows, args.out)


if __name__ == "__main__":
    main()
