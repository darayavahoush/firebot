"""
Interactive recorder for building a voice-command training set.

Walks you (and anyone else, one at a time) through recording clips for each
command word, plus an "unknown" negative class, and saves them into the
exact folder layout train_voice_intent.py expects:

    data/commands/
        stop/alice_001.wav
        stop/bob_001.wav
        go_home/alice_001.wav
        ...
        unknown/alice_001.wav

Run it once per person (that's the --speaker flag) so both voices end up
in the same command folders -- a classifier trained on only one voice
will not generalize to the other person, or to anyone else.

USAGE:
    pip install sounddevice soundfile numpy

    python record_voice_intent_data.py --speaker alice
    python record_voice_intent_data.py --speaker bob

    (edit DEFAULT_COMMANDS below to match your actual command vocabulary
    first, or pass --commands stop,go_home,go_left,go_right)

CONTROLS during a recording prompt:
    <Enter>  record a clip of the configured length
    p        play back the last clip you recorded
    r        redo (discard last clip, record again)
    <Enter> again (after playback) accepts and moves to the next clip
    s        skip this command entirely for this speaker
    q        quit (progress so far is already saved to disk)
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

# EDIT THIS to match the actual commands your voice_intent/vocab.py expects.
DEFAULT_COMMANDS = [
    "stop",
    "go_home",
    "go_left",
    "go_right",
    "forward",
    "backward",
]

SAMPLE_RATE = 16_000
CLIP_SECONDS = 2.0
UNKNOWN_LABEL = "unknown"
# Read out loud during "unknown" clips -- anything EXCEPT your real commands,
# so the classifier learns what "not a command" sounds like. Mix in a couple
# of silent/background-noise clips too (just don't say anything).
UNKNOWN_PROMPTS = [
    "(say something random, e.g. 'what's for lunch')",
    "(say a sentence that is NOT a command)",
    "(stay quiet -- just capture background noise)",
    "(cough, shuffle papers, or make ambient noise)",
    "(say a command word but trail off / mumble it unclearly)",
]


def record_clip(seconds: float, sample_rate: int) -> np.ndarray:
    audio = sd.rec(int(seconds * sample_rate), samplerate=sample_rate, channels=1, dtype="float32")
    sd.wait()
    return audio.squeeze()


def next_clip_index(label_dir: Path, speaker: str) -> int:
    existing = list(label_dir.glob(f"{speaker}_*.wav"))
    return len(existing) + 1


def record_for_label(label: str, speaker: str, out_root: Path, per_command: int,
                      clip_seconds: float) -> None:
    label_dir = out_root / label
    label_dir.mkdir(parents=True, exist_ok=True)
    start_idx = next_clip_index(label_dir, speaker)

    print(f"\n=== '{label}' -- speaker: {speaker} -- target: {per_command} clips ===")
    i = start_idx
    end = start_idx + per_command - 1
    while i <= end:
        if label == UNKNOWN_LABEL:
            hint = UNKNOWN_PROMPTS[(i - 1) % len(UNKNOWN_PROMPTS)]
            say = hint
        else:
            say = f"say: \"{label.replace('_', ' ')}\""

        cmd = input(
            f"[{i}/{end}] {say} -- Enter=record, s=skip label, q=quit: "
        ).strip().lower()
        if cmd == "q":
            print("Stopping early -- everything recorded so far is saved.")
            sys.exit(0)
        if cmd == "s":
            print(f"Skipping remaining '{label}' clips for {speaker}.")
            return

        print("Recording...")
        audio = record_clip(clip_seconds, SAMPLE_RATE)
        print("Done.")

        while True:
            choice = input("Keep this clip? [Enter=keep, p=playback, r=redo]: ").strip().lower()
            if choice == "p":
                sd.play(audio, SAMPLE_RATE)
                sd.wait()
                continue
            if choice == "r":
                print("Re-recording...")
                audio = record_clip(clip_seconds, SAMPLE_RATE)
                print("Done.")
                continue
            break

        clip_path = label_dir / f"{speaker}_{i:03d}.wav"
        sf.write(clip_path, audio, SAMPLE_RATE)
        print(f"Saved {clip_path}")
        i += 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--speaker", required=True, help="name tag for this person, e.g. alice")
    parser.add_argument("--out-dir", type=Path, default=Path("data/commands"))
    parser.add_argument(
        "--commands", type=str, default=None,
        help="comma-separated command list, overrides DEFAULT_COMMANDS in this file",
    )
    parser.add_argument("--per-command", type=int, default=15,
                         help="clips to record per command for this speaker")
    parser.add_argument("--per-unknown", type=int, default=15,
                         help="'unknown'/negative clips to record for this speaker")
    parser.add_argument("--clip-seconds", type=float, default=CLIP_SECONDS)
    args = parser.parse_args()

    commands = (
        [c.strip() for c in args.commands.split(",") if c.strip()]
        if args.commands else DEFAULT_COMMANDS
    )

    print(f"Speaker: {args.speaker}")
    print(f"Commands: {commands}")
    print(f"Clips per command: {args.per_command}, unknown clips: {args.per_unknown}")
    print(f"Saving under: {args.out_dir.resolve()}")
    input("Press Enter when ready to start (make sure your mic is selected)...")

    for label in commands:
        record_for_label(label, args.speaker, args.out_dir, args.per_command, args.clip_seconds)

    record_for_label(UNKNOWN_LABEL, args.speaker, args.out_dir, args.per_unknown, args.clip_seconds)

    print(f"\nDone recording for speaker '{args.speaker}'.")
    print(f"Data so far lives in: {args.out_dir.resolve()}")
    print("Have the other person run this script with their own --speaker name,")
    print("then train with:\n")
    print(f"  python train_voice_intent.py --data-dir {args.out_dir} "
          f"--model-size tiny --out checkpoints/intent_head.pt")


if __name__ == "__main__":
    main()
