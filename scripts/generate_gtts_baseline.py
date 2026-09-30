"""
Generate baseline "canonical pronunciation" clips for each command using
gTTS (Google Text-to-Speech). These act as the accent-neutral reference
that calibrate/build/recognize (voice_intent_prototypes.py) compare
against and blend in.

USAGE:
    pip install gTTS

    python generate_gtts_baseline.py
    python generate_gtts_baseline.py --commands stop,go_home,go_left,go_right

Requires internet access (gTTS calls Google's TTS service) and ffmpeg on
PATH (same requirement Whisper already has for decoding audio).

Saves one baseline clip per command to:
    data/baseline_gtts/<command>.mp3
"""

import argparse
from pathlib import Path

from gtts import gTTS

# EDIT to match your real command vocabulary (or pass --commands).
DEFAULT_COMMANDS = [
    "stop",
    "go_home",
    "go_left",
    "go_right",
    "forward",
    "backward",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commands", type=str, default=None,
                         help="comma-separated, overrides DEFAULT_COMMANDS")
    parser.add_argument("--out-dir", type=Path, default=Path("data/baseline_gtts"))
    parser.add_argument("--lang", default="en")
    parser.add_argument("--tld", default="com",
                         help="accent variant for gTTS, e.g. 'com' (US-ish), 'co.uk', 'com.au'")
    args = parser.parse_args()

    commands = (
        [c.strip() for c in args.commands.split(",") if c.strip()]
        if args.commands else DEFAULT_COMMANDS
    )
    args.out_dir.mkdir(parents=True, exist_ok=True)

    for label in commands:
        phrase = label.replace("_", " ")
        out_path = args.out_dir / f"{label}.mp3"
        print(f"Generating baseline for '{phrase}' -> {out_path}")
        tts = gTTS(text=phrase, lang=args.lang, tld=args.tld)
        tts.save(str(out_path))

    print(f"\nDone: {len(commands)} baseline clips saved to {args.out_dir}")
    print("Next: python voice_intent_prototypes.py calibrate --speaker <name>")


if __name__ == "__main__":
    main()
