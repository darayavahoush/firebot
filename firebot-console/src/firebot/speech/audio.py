"""Audio sources yielding raw 16 kHz mono int16 PCM chunks (bytes)."""
from __future__ import annotations

import wave
from collections.abc import Iterator

from .recognizer import SAMPLE_RATE

BLOCK = 4000  # samples per chunk = 0.25 s


def wav_chunks(path: str, block: int = BLOCK) -> Iterator[bytes]:
    """Stream a 16 kHz mono 16-bit WAV file (for tests, demos and offline replays)."""
    with wave.open(path, "rb") as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (SAMPLE_RATE, 1, 2):
            raise ValueError("expected 16 kHz mono 16-bit WAV")
        while data := w.readframes(block):
            yield data


def mic_chunks(block: int = BLOCK, device: int | str | None = None) -> Iterator[bytes]:
    """Live microphone stream. Needs the `speech` extra (sounddevice + PortAudio)."""
    try:
        import sounddevice as sd
    except (ImportError, OSError) as e:
        raise RuntimeError("Microphone support needs: pip install -e '.[speech]'") from e
    with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=block, dtype="int16", channels=1,
                           device=device) as stream:
        while True:
            data, _overflow = stream.read(block)
            yield bytes(data)
