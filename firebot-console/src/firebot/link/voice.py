"""Voice input for the brain: microphone (or WAV) -> Vosk -> operator commands.

Runs on the PC beside the network server; nothing speech-related ever reaches the Pi. Final
transcripts are submitted like typed commands (same interpreter, validator, executor, logging,
channel "voice"). The STOP backstop watches Vosk's partial results and calls
`BrainServer.emergency_stop` the moment a stop word is heard, mid-sentence (channel "backstop").
It complements a physical e-stop; it does not replace one.
"""
from __future__ import annotations

import threading
from collections.abc import Callable, Iterable

from firebot.command.parser import Interpreter
from firebot.speech.listener import Heard, Listener
from firebot.speech.recognizer import Recognizer

from .server import BrainServer


def make_listener(server: BrainServer, recognizer: Recognizer,
                  say: Callable[[str], None] = print) -> Listener:
    def on_command(h: Heard) -> None:
        say(f"heard: {h.text!r}")
        if not server.submit_command(h.text, "voice"):
            say("  (no robot connected)")

    def on_stop(partial: str) -> None:
        say(f"! stop heard ({partial!r})")
        server.emergency_stop(partial)

    # rules-only interpreter: the brain re-interprets the text and owns validation/execution
    return Listener(recognizer, Interpreter(), on_command, on_stop)


def start_voice(server: BrainServer, recognizer: Recognizer, chunks: Iterable[bytes],
                say: Callable[[str], None] = print) -> threading.Thread:
    """Process `chunks` on a daemon thread. Errors are reported; typed control keeps working."""
    listener = make_listener(server, recognizer, say)

    def run() -> None:
        try:
            listener.process(chunks)
        except Exception as e:  # noqa: BLE001
            say(f"voice input stopped: {e}")

    t = threading.Thread(target=run, name="voice", daemon=True)
    t.start()
    return t
