"""Offline transcription of a *whole recorded clip* (the console's REC button), reusing the
same Vosk recogniser and Silero VAD the streaming `firebot-listen` path uses.

Streaming and clip paths differ in one way that matters: a clip ends abruptly, and Vosk only
emits a final result once it hears trailing silence. So `transcribe_pcm` pads the clip with
a short run of silence so the recogniser always endpoints, instead of losing the last words.

Everything model-shaped is injected (`recognizer`, `gate`), so tests need neither the Vosk
model nor torch. Audio is 16 kHz mono 16-bit little-endian PCM throughout.
"""
from __future__ import annotations

from collections.abc import Callable

from .recognizer import SAMPLE_RATE, Recognizer
from .text import spoken_to_text

VAD_CHUNK_BYTES = 512 * 2        # Silero wants exactly 512 samples per call at 16 kHz
FEED_CHUNK_BYTES = 4000          # matches the streaming path's typical chunk size
TAIL_SILENCE_SECONDS = 0.8       # enough for Vosk to declare end-of-utterance


def float_to_pcm16(audio) -> bytes:
    """float32 mono in [-1, 1] -> 16-bit little-endian PCM bytes (clipped, not wrapped)."""
    import numpy as np

    a = np.clip(np.asarray(audio, dtype="float32"), -1.0, 1.0)
    return (a * 32767.0).astype("<i2").tobytes()


def trim_to_speech(pcm: bytes, gate: Callable) -> bytes:
    """Drop non-speech chunks using a `SileroGate`-style callable (chunks -> kept chunks).

    Returns the original clip unchanged if the gate keeps nothing, so a mis-tuned threshold
    can never turn a real command into silence -- the recogniser still gets a chance at it.
    """
    chunks = [pcm[i:i + VAD_CHUNK_BYTES] for i in range(0, len(pcm), VAD_CHUNK_BYTES)]
    chunks = [c for c in chunks if len(c) == VAD_CHUNK_BYTES]  # Silero can't score a short tail
    kept = b"".join(gate(chunks))
    return kept or pcm


def transcribe_pcm(pcm: bytes, recognizer: Recognizer, gate: Callable | None = None) -> str:
    """Run a full clip through `recognizer`; returns cleaned text ('' if nothing recognised)."""
    if gate is not None:
        pcm = trim_to_speech(pcm, gate)
    pcm += b"\x00\x00" * int(SAMPLE_RATE * TAIL_SILENCE_SECONDS)
    recognizer.reset()
    finals: list[str] = []
    last_partial = ""
    for i in range(0, len(pcm), FEED_CHUNK_BYTES):
        final, partial = recognizer.feed(pcm[i:i + FEED_CHUNK_BYTES])
        if final:
            finals.append(final)
        elif partial:
            last_partial = partial
    text = " ".join(finals) if finals else last_partial
    return spoken_to_text(text)
