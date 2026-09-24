import wave

import numpy as np
import pytest

from firebot.command import Interpreter
from firebot.db.store import Store
from firebot.speech import EXAMPLES, VOCAB, Listener, grammar_json, spoken_to_text
from firebot.speech.audio import wav_chunks
from firebot.speech.run import listen


class FakeRecognizer:
    """Scripted stand-in for Vosk: one (final, partial) pair per audio chunk."""

    def __init__(self, script):
        self.script = list(script)

    def feed(self, pcm):
        return self.script.pop(0) if self.script else (None, "")

    def reset(self):
        pass


def chunks(n):
    return [b"\x00\x00" * 4000] * n


@pytest.mark.parametrize("spoken,text", [
    ("go to five three", "go to 5 3"),
    ("go to x eight point five y six", "go to x 8.5 y 6"),
    ("go to [unk] the east side", "go to the east side"),
    ("go to twelve point five", "go to 12.5"),
    ("STOP", "stop"), ("[unk]", ""),
])
def test_spoken_to_text(spoken, text):
    assert spoken_to_text(spoken) == text


def test_grammar_covers_every_example_and_parses_it():
    vocab = set(VOCAB)
    interp = Interpreter()
    for phrase, expected in EXAMPLES.items():
        assert set(phrase.split()) <= vocab, phrase          # Vosk could actually say it
        intent, ok, _ = interp.interpret(spoken_to_text(phrase))
        assert ok and intent.name == expected, phrase        # and the rules understand it
    assert "[unk]" in grammar_json() and "stop" in VOCAB


def test_listener_routes_final_transcripts_to_the_interpreter():
    heard = []
    rec = FakeRecognizer([(None, "go to"), (None, "go to the east"), ("go to the east side", ""),
                          ("go to five three", "")])
    n = Listener(rec, Interpreter(), heard.append, lambda p: heard.append("STOP!")).process(
        chunks(4))
    assert n == 2 and [h.intent.name for h in heard] == ["GOTO", "GOTO"]
    assert heard[1].intent.params == {"x": 5.0, "y": 3.0}


def test_stop_backstop_fires_on_partial_before_sentence_ends_and_only_once():
    events = []
    rec = FakeRecognizer([(None, "go to"), (None, "stop"), (None, "stop stop"),
                          ("stop", ""), (None, "status"), ("status", "")])
    Listener(rec, Interpreter(), lambda h: events.append(("cmd", h.intent.name)),
             lambda p: events.append(("BACKSTOP", p))).process(chunks(6))
    assert events == [("BACKSTOP", "stop"), ("cmd", "STOP"), ("cmd", "STATUS")]


def test_backstop_rearms_for_next_utterance():
    events = []
    rec = FakeRecognizer([(None, "halt"), ("halt", ""), (None, "stop"), ("stop", "")])
    Listener(rec, Interpreter(), lambda h: None, lambda p: events.append(p)).process(chunks(4))
    assert events == ["halt", "stop"]


def test_unknown_speech_is_reported_not_executed():
    heard = []
    Listener(FakeRecognizer([("tell me a joke", "")]), Interpreter(), heard.append,
             lambda p: None).process(chunks(1))
    assert heard[0].intent.name == "UNKNOWN"  # the executor answers "didn't understand"


def test_listen_runs_commands_stops_and_logs(tmp_path):
    db = tmp_path / "ops.db"
    rec = FakeRecognizer([("go to the center", ""), (None, "stop"), ("stop", ""),
                          ("blah blah", ""), ("status", "")])
    out = listen(chunks(5), rec, seed=0, steps=60, ops_path=str(db), say=lambda _: None)
    assert any("Heading to" in line for line in out) and any("STOP heard" in line for line in out)
    with Store(db) as s:
        rows = s.conn.execute("SELECT transcript, validated FROM voice_commands ORDER BY id"
                              ).fetchall()
        assert [r["transcript"] for r in rows] == [
            "go to the center", "[backstop] stop", "stop", "blah blah", "status"]
        assert [r["validated"] for r in rows] == [1, 1, 1, 0, 1]


def test_wav_chunks_streams_and_validates_format(tmp_path):
    good, bad = tmp_path / "g.wav", tmp_path / "b.wav"
    for path, rate in ((good, 16000), (bad, 44100)):
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1), w.setsampwidth(2), w.setframerate(rate)
            w.writeframes((np.zeros(10_000, dtype="<i2")).tobytes())
    got = list(wav_chunks(str(good), block=4000))
    assert [len(c) for c in got] == [8000, 8000, 4000]
    with pytest.raises(ValueError):
        list(wav_chunks(str(bad)))


def test_vosk_missing_gives_helpful_error(monkeypatch):
    import sys

    from firebot.speech import VoskRecognizer
    monkeypatch.setitem(sys.modules, "vosk", None)
    with pytest.raises(RuntimeError, match="speech"):
        VoskRecognizer("/nonexistent")
