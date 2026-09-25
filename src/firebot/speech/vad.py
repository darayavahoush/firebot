"""Optional Silero VAD gate in front of a recognizer.

Vosk already does its own end-of-utterance detection (see recognizer.py), so this is a pure
noise/CPU-saving filter, not a replacement for that: it holds back non-speech chunks so Vosk
never has to run inference on them at all. It changes what reaches the recognizer, never how
the recognizer decides an utterance is finished.

Opt-in via `--vad` (needs the `vad` extra: `pip install -e '.[vad]'`, which pulls in torch and
silero-vad). Everything else in `firebot-listen` / `firebot-brain` works without it.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator

from .recognizer import SAMPLE_RATE

SpeechProb = Callable[[bytes], float]


def _load_silero() -> SpeechProb:
    """Load the real Silero VAD model and wrap it as a `pcm bytes -> probability` callable."""
    try:
        import numpy as np
        import torch
    except ImportError as e:
        raise RuntimeError("Silero VAD needs: pip install -e '.[vad]'") from e
    try:
        model, _utils = torch.hub.load("snakers4/silero-vad", "silero_vad", trust_repo=True)
    except Exception as e:
        raise RuntimeError(f"could not load the Silero VAD model: {e}") from e

    def speech_prob(pcm: bytes) -> float:
        audio = np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768.0
        with torch.no_grad():
            return float(model(torch.from_numpy(audio), SAMPLE_RATE).item())

    return speech_prob


class SileroGate:
    """Filters a raw-PCM chunk stream down to chunks that contain (or just followed) speech.

    `threshold`: minimum speech probability (0..1) to open the gate.
    `hangover_chunks`: how many chunks to keep passing through after probability drops back
    below threshold, so a word's tail end doesn't get clipped mid-utterance.
    `speech_prob`: injectable `pcm bytes -> float` scorer; defaults to loading the real Silero
    model lazily on first use. Tests inject a stub here instead of needing torch installed,
    the same way `VoskRecognizer`'s tests stub out `vosk`.
    """

    def __init__(self, threshold: float = 0.5, hangover_chunks: int = 3,
                speech_prob: SpeechProb | None = None) -> None:
        self.threshold = threshold
        self.hangover_chunks = hangover_chunks
        self._speech_prob = speech_prob
        self._hangover = 0

    def _scorer(self) -> SpeechProb:
        if self._speech_prob is None:
            self._speech_prob = _load_silero()
        return self._speech_prob

    def reset(self) -> None:
        """Clear hangover state between utterances/sessions. Does not reload the model."""
        self._hangover = 0

    def __call__(self, chunks: Iterable[bytes]) -> Iterator[bytes]:
        # Load/validate the scorer eagerly (here, not inside the generator below) so a missing
        # `vad` extra or a hub-load failure raises immediately, at call time -- not on the
        # first chunk pulled from the returned iterator, by which point the caller may already
        # look committed to voice input.
        scorer = self._scorer()

        def gen() -> Iterator[bytes]:
            for chunk in chunks:
                if scorer(chunk) >= self.threshold:
                    self._hangover = self.hangover_chunks
                    yield chunk
                elif self._hangover > 0:
                    self._hangover -= 1
                    yield chunk
                # else: silent chunk outside any hangover tail -- dropped, Vosk never sees it
        return gen()
