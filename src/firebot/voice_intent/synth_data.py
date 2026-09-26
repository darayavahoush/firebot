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
import sys
from pathlib import Path

import numpy as np

from . import vocab

SAMPLE_RATE = 16_000


def _get_tts_voices(voice_filter: str | None):
    import pyttsx3

    engine = pyttsx3.init()
    voices = engine.getProperty("voices")
    if not voices:
        raise RuntimeError(
            "No TTS voices found. On Linux, install espeak-ng "
            "(e.g. `apt install espeak-ng`) and retry."
        )
    if voice_filter:
        voices = [v for v in voices if voice_filter.lower() in v.id.lower()]
        if not voices:
            raise RuntimeError(f"No voices matched --voice-filter {voice_filter!r}. "
                                f"Run without --voice-filter to see all installed voice ids.")
    return engine, voices


def _synthesize(engine, voice_id: str, rate: int, text: str, out_wav: Path) -> None:
    """Render one utterance to `out_wav` at SAMPLE_RATE mono via pyttsx3."""
    engine.setProperty("voice", voice_id)
    engine.setProperty("rate", rate)
    # pyttsx3 writes whatever the OS engine produces (rate/format varies by
    # platform); resample/convert with soundfile+librosa after saving.
    tmp = out_wav.with_suffix(".raw.wav")
    try:
        engine.save_to_file(text, str(tmp))
        engine.runAndWait()
        _resample_to_target(tmp, out_wav)
    finally:
        tmp.unlink(missing_ok=True)


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
                        seed: int = 0) -> list[tuple[Path, str, str]]:
    import soundfile as sf

    engine, voices = _get_tts_voices(voice_filter)
    print(f"  using {len(voices)} voice(s): {[v.id for v in voices]}")
    rng = np.random.default_rng(seed)
    table = vocab.build_phrase_table()
    rows: list[tuple[Path, str, str]] = []
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
                        _synthesize(engine, voice.id, rate, phrase, base_path)
                    except Exception as exc:  # noqa: BLE001
                        print(f"  [warn] TTS failed for voice={voice.id!r} "
                              f"phrase={phrase!r}: {exc}", file=sys.stderr)
                        base_path.unlink(missing_ok=True)
                        continue
                    rows.append((base_path, label, "synth_tts"))
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
                        rows.append((aug_path, label, "synth_aug"))
                        clip_idx += 1
        print(f"  {label:16s} -> {clip_idx} clips")
    return rows


def merge_real(real_dir: Path, out_dir: Path) -> list[tuple[Path, str, str]]:
    rows: list[tuple[Path, str, str]] = []
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
            rows.append((dest, label, "real"))
    return rows


def write_manifest(rows: list[tuple[Path, str, str]], out_dir: Path) -> None:
    manifest = out_dir / "manifest.csv"
    with manifest.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "label", "source"])
        for path, label, source in rows:
            w.writerow([str(path.relative_to(out_dir)), label, source])
    print(f"\nWrote {len(rows)} rows to {manifest}")
    by_label: dict[str, int] = {}
    for _, label, _ in rows:
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
                     help="substring to filter installed TTS voice ids by (default 'en' for "
                          "English variants only; pass '' to use every installed voice/language)")
    ap.add_argument("--skip-synth", action="store_true",
                     help="only merge --real-dir, skip TTS generation (e.g. re-running after adding recordings)")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    rows: list[tuple[Path, str, str]] = []

    if not args.skip_synth:
        print("Generating synthetic (TTS) data...")
        rows += generate_synthetic(args.out, args.variants_per_voice, args.augment,
                                    args.limit_per_class, args.voice_filter or None)

    if args.real_dir is not None:
        print(f"Merging real recordings from {args.real_dir}...")
        rows += merge_real(args.real_dir, args.out)

    if not rows:
        print("Nothing generated -- pass --real-dir or drop --skip-synth.", file=sys.stderr)
        sys.exit(1)

    write_manifest(rows, args.out)


if __name__ == "__main__":
    main()
