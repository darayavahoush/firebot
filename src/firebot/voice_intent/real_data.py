"""Helpers for real (human) recordings: legacy-clip conversion and recording prompts.

Torch-free and audio-library-free on purpose (stdlib only) so it can be unit-tested and
shared by `record_voice_intent_data.py` and `convert_legacy_clips.py`.

Real clips live in `<root>/<CLASS>/<speaker>_<NNN>.wav`, which is exactly what
`synth_data --real-dir` merges (speaker parsed from the filename stem).
"""
from __future__ import annotations

import random
import shutil
from pathlib import Path

from firebot.voice_intent import vocab

# Old recorder folder -> new class. Only commands whose meaning survived the vocab change.
# go_left / go_right / forward / backward are *relative* moves; the new classes are absolute
# places (GOTO_WEST is "the left side of the map", not "turn left"), so mapping them would
# teach the model wrong audio->label pairs. They are deliberately left out.
LEGACY_LABEL_MAP: dict[str, str] = {
    "stop": "STOP",
    "go_home": "RETURN_HOME",   # vocab lists "go home" under RETURN_HOME, not GOTO_HOME
    "unknown": "UNKNOWN",
}

# Non-speech / edge-case prompts mixed into UNKNOWN so it also sees silence and noise.
UNKNOWN_HINTS = [
    "(stay quiet -- just capture background noise)",
    "(cough, shuffle papers, or make ambient noise)",
    "(say a command word but trail off / mumble it)",
    "(say any sentence that is NOT a command)",
]


def convert_legacy(src_root: Path, dst_root: Path) -> dict[str, int]:
    """Copy legacy `<old_label>/*.wav` clips into `<dst>/<CLASS>/`, keeping filenames.
    Existing destination files are never overwritten. Returns {CLASS: copied}."""
    copied: dict[str, int] = {}
    for old, new in LEGACY_LABEL_MAP.items():
        old_dir = src_root / old
        if not old_dir.is_dir():
            continue
        out_dir = dst_root / new
        out_dir.mkdir(parents=True, exist_ok=True)
        for wav in sorted(old_dir.glob("*.wav")):
            dest = out_dir / wav.name
            if dest.exists():
                continue
            shutil.copy2(wav, dest)
            copied[new] = copied.get(new, 0) + 1
    return copied


def count_clips(root: Path, label: str, speaker: str) -> int:
    d = root / label
    return len(list(d.glob(f"{speaker}_*.wav"))) if d.is_dir() else 0


def prompts_for(label: str, speaker: str) -> list[str]:
    """Phrases to read for `label`, in an order that differs per speaker (so two people don't
    record identical sentences) but is stable across sessions (so resuming continues the
    same sequence). Cycles when a caller asks for more clips than there are phrases."""
    phrases = list(vocab.build_phrase_table()[label])
    if label == "UNKNOWN":
        phrases += UNKNOWN_HINTS
    random.Random(f"{label}:{speaker}").shuffle(phrases)
    return phrases


def missing_classes(root: Path, min_clips: int = 1) -> list[str]:
    """Classes with fewer than `min_clips` real clips under `root`."""
    return [c for c in vocab.CLASSES if count_clips_any(root, c) < min_clips]


def count_clips_any(root: Path, label: str) -> int:
    d = root / label
    return len(list(d.glob("*.wav"))) if d.is_dir() else 0
