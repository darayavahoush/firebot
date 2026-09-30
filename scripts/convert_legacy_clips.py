"""Copy the old recorder's clips (data/commands/<stop|go_home|unknown>/) into the new
class layout (data/real_intent/<STOP|RETURN_HOME|UNKNOWN>/), then report what's still missing.

    python scripts/convert_legacy_clips.py                      # data/commands -> data/real_intent
    python scripts/convert_legacy_clips.py --src X --dst Y
"""
import argparse
from pathlib import Path

from firebot.voice_intent import vocab
from firebot.voice_intent.real_data import LEGACY_LABEL_MAP, convert_legacy, count_clips_any


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=Path("data/commands"))
    ap.add_argument("--dst", type=Path, default=Path("data/real_intent"))
    args = ap.parse_args()

    copied = convert_legacy(args.src, args.dst)
    for old, new in LEGACY_LABEL_MAP.items():
        print(f"  {old:10s} -> {new:12s} copied {copied.get(new, 0)}")
    skipped = sorted(p.name for p in args.src.iterdir()
                     if p.is_dir() and p.name not in LEGACY_LABEL_MAP) if args.src.is_dir() else []
    if skipped:
        print(f"\nNot converted (relative moves, no matching class): {', '.join(skipped)}")
    print("\nReal clips per class now:")
    for c in vocab.CLASSES:
        n = count_clips_any(args.dst, c)
        print(f"  {c:16s} {n:4d}{'   <-- record these' if n == 0 else ''}")


if __name__ == "__main__":
    main()
