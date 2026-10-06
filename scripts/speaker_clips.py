"""Shared clip loading for the speaker-ID scripts (not run directly)."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from firebot.speech.speaker_id import trim_silence

SR = 16_000


def load_pcm(path: Path, trim: bool = True) -> bytes:
    import soundfile as sf
    audio, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != SR:
        n = int(round(len(audio) * SR / sr))
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype("float32")
    if trim:
        audio = trim_silence(audio)
    return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


def speaker_clips(root: Path) -> dict[str, list[Path]]:
    """data/calibration/<speaker>/<CLASS>/NNN.wav -> {speaker: [wav, ...]} (UNKNOWN clips are
    kept: they are still the person's voice)."""
    out: dict[str, list[Path]] = {}
    if not root.is_dir():
        return out
    for spk in sorted(p for p in root.iterdir() if p.is_dir()):
        wavs = sorted(spk.glob("**/*.wav"))
        if wavs:
            out[spk.name] = wavs
    return out
