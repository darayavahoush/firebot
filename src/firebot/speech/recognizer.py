"""Streaming recognisers. `Recognizer` is the interface; `VoskRecognizer` is the real one.

Vosk does its own end-of-utterance detection, so no separate VAD is needed. Audio is 16 kHz
mono 16-bit PCM. `feed()` returns (final_text_or_None, partial_text): partials arrive while the
operator is still talking, which is what lets the STOP backstop react before the sentence ends.
"""
from __future__ import annotations

import json
from typing import Protocol

from .grammar import grammar_json

SAMPLE_RATE = 16_000


class Recognizer(Protocol):
    def feed(self, pcm: bytes) -> tuple[str | None, str]: ...
    def reset(self) -> None: ...


class VoskRecognizer:
    def __init__(self, model_path: str, rate: int = SAMPLE_RATE, restrict: bool = True) -> None:
        try:
            import vosk
        except ImportError as e:  # pragma: no cover - exercised via monkeypatch in tests
            raise RuntimeError("Vosk is not installed: pip install -e '.[speech]'") from e
        vosk.SetLogLevel(-1)
        self._vosk, self._model, self._rate = vosk, vosk.Model(model_path), rate
        self._restrict = restrict
        self.reset()

    def reset(self) -> None:
        args = (self._model, self._rate) + ((grammar_json(),) if self._restrict else ())
        self._rec = self._vosk.KaldiRecognizer(*args)

    def feed(self, pcm: bytes) -> tuple[str | None, str]:
        if self._rec.AcceptWaveform(pcm):
            text = json.loads(self._rec.Result()).get("text", "").strip()
            return (text or None), ""
        return None, json.loads(self._rec.PartialResult()).get("partial", "")
