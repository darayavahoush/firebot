"""Audio -> recogniser -> Interpreter. The only place speech touches the command layer.

Two paths, deliberately independent:
  * final transcripts go through the normal `Interpreter` (rules -> validate -> executor);
  * a STOP backstop watches Vosk's *partial* results and fires `on_stop` as soon as a stop word
    is heard, without waiting for the sentence to end or for the interpreter. It fires at most
    once per utterance. It complements, and never replaces, a physical e-stop.

Optional speaker identification (`speaker_id`): buffers the raw PCM chunks belonging to the
current utterance (since the last final transcript) and, when a final transcript lands, asks
`SpeakerIdentifier.identify()` who said it. This is purely additive -- `speaker`/`speaker_score`
on `Heard` are `None`/`0.0` when `speaker_id` isn't given, and nothing about how commands are
matched or validated changes either way. It exists for the operator-accountability log, not for
personalizing command matching (see `speech/speaker_id.py`'s docstring for why).
"""
from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass

from firebot.command.intents import Intent
from firebot.command.parser import Interpreter, mentions_stop

from .recognizer import Recognizer
from .text import spoken_to_text


@dataclass
class Heard:
    text: str            # cleaned transcript (digits, no [unk])
    intent: Intent
    valid: bool
    reason: str
    speaker: str | None = None       # None: no speaker_id given, or speaker unrecognized
    speaker_score: float = 0.0       # cosine similarity to the identified speaker, or the
                                     # closest unrecognized candidate's score


class Listener:
    def __init__(self, recognizer: Recognizer, interpreter: Interpreter,
                 on_command: Callable[[Heard], None], on_stop: Callable[[str], None],
                 speaker_id: object | None = None) -> None:
        self.rec, self.interp = recognizer, interpreter
        self.on_command, self.on_stop = on_command, on_stop
        self.speaker_id = speaker_id  # a speech.speaker_id.SpeakerIdentifier, or None
        self._stopped = False    # backstop already fired for the current utterance
        self._audio_buf: list[bytes] = []  # chunks since the last final transcript

    def process(self, chunks: Iterable[bytes]) -> int:
        """Consume audio until the source ends. Returns the number of commands handled."""
        n = 0
        for chunk in chunks:
            self._audio_buf.append(chunk)
            final, partial = self.rec.feed(chunk)
            if partial and not self._stopped and mentions_stop(spoken_to_text(partial)):
                self._stopped = True
                self.on_stop(partial)
            if final:
                self._stopped = False
                text = spoken_to_text(final)
                audio, self._audio_buf = b"".join(self._audio_buf), []
                if not text:
                    continue
                speaker, score = self._identify(audio)
                intent, valid, reason = self.interp.interpret(text)
                self.on_command(Heard(text, intent, valid, reason, speaker, score))
                n += 1
        return n

    def _identify(self, audio: bytes) -> tuple[str | None, float]:
        if self.speaker_id is None or not audio:
            return None, 0.0
        try:
            return self.speaker_id.identify(audio)
        except Exception:  # noqa: BLE001 -- speaker ID is an accountability add-on, never a
            return None, 0.0  # reason to drop or misroute an otherwise-valid command
