"""Interactive recorder for real voice-command clips, using the classifier's real classes.

Saves `data/real_intent/<CLASS>/<speaker>_<NNN>.wav` (16 kHz mono), which
`python -m firebot.voice_intent.synth_data --real-dir data/real_intent` merges in. Each prompt
is a phrase from vocab.py, in a per-speaker shuffled order, so the model hears varied wording.
Resumable: existing clips are counted and recording continues after them.

    pip install sounddevice soundfile numpy

    python record_voice_intent_data.py --speaker ananya
    python record_voice_intent_data.py --speaker ananya --only EXTINGUISH,STATUS
    python record_voice_intent_data.py --speaker ananya --missing-only

Per prompt:  Enter=record   s=skip class   q=quit.  After recording: Enter=keep, p=play, r=redo.
Use a different --speaker name per person: the trainer holds out whole speakers.
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

from firebot.voice_intent import vocab
from firebot.voice_intent.real_data import count_clips, missing_classes, prompts_for

SAMPLE_RATE = 16_000
CLIP_SECONDS = 3.0  # long enough for "go to the middle of the room"


def record_clip(seconds: float, sample_rate: int) -> np.ndarray:
    audio = sd.rec(int(seconds * sample_rate), samplerate=sample_rate, channels=1, dtype="float32")
    sd.wait()
    return audio.squeeze()


def record_for_label(label: str, speaker: str, out_root: Path, target: int,
                     clip_seconds: float) -> None:
    label_dir = out_root / label
    label_dir.mkdir(parents=True, exist_ok=True)
    have = count_clips(out_root, label, speaker)
    if have >= target:
        print(f"\n=== {label}: {speaker} already has {have}/{target}, skipping ===")
        return
    prompts = prompts_for(label, speaker)
    print(f"\n=== {label} -- speaker: {speaker} -- {have}/{target} recorded ===")
    i = have + 1
    while i <= target:
        phrase = prompts[(i - 1) % len(prompts)]
        say = phrase if phrase.startswith("(") else f'say: "{phrase}"'
        cmd = input(f"[{i}/{target}] {say} -- Enter=record, s=skip class, q=quit: ").strip().lower()
        if cmd == "q":
            print("Stopping -- everything recorded so far is saved.")
            sys.exit(0)
        if cmd == "s":
            return
        print("Recording...")
        audio = record_clip(clip_seconds, SAMPLE_RATE)
        while True:
            choice = input("Keep? [Enter=keep, p=playback, r=redo]: ").strip().lower()
            if choice == "p":
                sd.play(audio, SAMPLE_RATE)
                sd.wait()
            elif choice == "r":
                print("Recording...")
                audio = record_clip(clip_seconds, SAMPLE_RATE)
            else:
                break
        path = label_dir / f"{speaker}_{i:03d}.wav"
        sf.write(path, audio, SAMPLE_RATE, subtype="PCM_16")
        print(f"Saved {path}")
        i += 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", required=True, help="name tag, e.g. ananya (lowercase, no underscores)")
    ap.add_argument("--out-dir", type=Path, default=Path("data/real_intent"))
    ap.add_argument("--only", type=str, default=None, help="comma-separated CLASS names to record")
    ap.add_argument("--missing-only", action="store_true",
                    help="only classes with zero real clips (from anyone) in --out-dir")
    ap.add_argument("--per-class", type=int, default=8, help="clips per class for this speaker")
    ap.add_argument("--clip-seconds", type=float, default=CLIP_SECONDS)
    args = ap.parse_args()

    if "_" in args.speaker:
        sys.exit("--speaker must not contain '_' (the filename is <speaker>_<NNN>.wav)")
    if args.only:
        classes = [c.strip().upper() for c in args.only.split(",") if c.strip()]
        bad = [c for c in classes if c not in vocab.LABEL_TO_IDX]
        if bad:
            sys.exit(f"unknown class(es): {bad}. Valid: {vocab.CLASSES}")
    elif args.missing_only:
        classes = missing_classes(args.out_dir)
    else:
        classes = list(vocab.CLASSES)
    if not classes:
        sys.exit("Nothing to record.")

    print(f"Speaker: {args.speaker}\nClasses: {classes}\nClips/class: {args.per_class}")
    print(f"Saving under: {args.out_dir.resolve()}")
    input("Press Enter when ready (check your mic)...")
    for label in classes:
        record_for_label(label, args.speaker, args.out_dir, args.per_class, args.clip_seconds)
    print(f"\nDone. Merge with:\n  python -m firebot.voice_intent.synth_data "
          f"--out data/voice_intent --real-dir {args.out_dir} --skip-synth")


if __name__ == "__main__":
    main()
