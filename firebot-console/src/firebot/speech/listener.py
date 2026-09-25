"""Audio -> recogniser -> Interpreter. The only place speech touches the command layer.

Two paths, deliberately independent:
  * final transcripts go through the normal `Interpreter` (rules -> validate -> executor);
  * a STOP backstop watches Vosk's *partial* results and fires `on_stop` as soon as a stop word
    is heard, without waiting for the sentence to end or for the interpreter. It fires at most
    once per utterance. It complements, and never replaces, a physical e-stop.
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


class Listener:
    def __init__(self, recognizer: Recognizer, interpreter: Interpreter,
                 on_command: Callable[[Heard], None], on_stop: Callable[[str], None]) -> None:
        self.rec, self.interp = recognizer, interpreter
        self.on_command, self.on_stop = on_command, on_stop
        self._stopped = False  # backstop already fired for the current utterance

    def process(self, chunks: Iterable[bytes]) -> int:
        """Consume audio until the source ends. Returns the number of commands handled."""
        n = 0
        for chunk in chunks:
            final, partial = self.rec.feed(chunk)
            if partial and not self._stopped and mentions_stop(spoken_to_text(partial)):
                self._stopped = True
                self.on_stop(partial)
            if final:
                self._stopped = False
                text = spoken_to_text(final)
                if not text:
                    continue
                intent, valid, reason = self.interp.interpret(text)
                self.on_command(Heard(text, intent, valid, reason))
                n += 1
        return n
