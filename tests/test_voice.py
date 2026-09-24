"""Voice -> brain: transcripts become operator commands; the STOP backstop halts the robot."""
from __future__ import annotations

import asyncio
import threading
import time

import numpy as np

from firebot.link import protocol as P
from firebot.link.agent import PiAgent
from firebot.link.brain import Brain
from firebot.link.server import BrainServer
from firebot.link.simhw import SimHardware
from firebot.link.sink import BufferedSink, MemoryBackend
from firebot.link.voice import make_listener, start_voice

CHUNK = b"\x00\x00" * 4000


class FakeRecognizer:
    """One scripted (final, partial) pair per audio chunk, like Vosk."""

    def __init__(self, script):
        self.script = list(script)

    def feed(self, pcm):
        return self.script.pop(0) if self.script else (None, "")

    def reset(self):
        pass


class Rig:
    """Server + agent + sim robot in one loop; `at_frame` hooks run inside the robot's read()."""

    def __init__(self, hooks, seed=4, max_steps=140):
        self.be = MemoryBackend()
        self.sink = BufferedSink(self.be)
        self.applied: list[P.Command] = []
        rig = self

        class HW(SimHardware):
            n = 0

            def apply(self, cmd):
                rig.applied.append(cmd)
                super().apply(cmd)

            def read(self):
                self.n += 1
                if self.n in hooks:
                    hooks[self.n](rig)
                return super().read()

        self.hw = HW(seed=seed, max_steps=max_steps)
        self.said: list[str] = []

    def run(self):
        async def go():
            self.srv = BrainServer(lambda: Brain(sink=self.sink, seed=4), token="t")
            await self.srv.start()
            ag = PiAgent(self.hw, "127.0.0.1", self.srv.bound_port, "t", lockstep=True,
                         watchdog=1.0)
            await asyncio.wait_for(ag.run(), 60)
            await self.srv.stop()
        asyncio.run(go())
        self.sink.close()
        return self


def test_spoken_goto_moves_robot_and_is_logged_as_voice():
    def speak(rig):
        rec = FakeRecognizer([(None, "go to the"), ("go to the east side", "")])
        make_listener(rig.srv, rec, rig.said.append).process([CHUNK, CHUNK])

    rig = Rig({5: speak}).run()
    assert any(c.v > 0 for c in rig.applied)                        # it drove
    (op,) = rig.be.operator
    assert op["text"] == "go to the east side" and op["valid"]
    assert op["intent"]["channel"] == "voice" and op["intent"]["name"] == "GOTO"
    assert "heard: 'go to the east side'" in rig.said


def test_spoken_number_words_become_coordinates():
    def speak(rig):
        rec = FakeRecognizer([("go to x eight point five y six", "")])
        make_listener(rig.srv, rec, rig.said.append).process([CHUNK])

    rig = Rig({5: speak}).run()
    (op,) = rig.be.operator
    assert op["intent"]["params"] == {"x": 8.5, "y": 6.0} and op["valid"]


def test_stop_backstop_halts_mid_sentence_and_fires_once():
    def go_east(rig):
        make_listener(rig.srv, FakeRecognizer([("go to the east side", "")]),
                      rig.said.append).process([CHUNK])

    def half_sentence(rig):   # operator starts a sentence and says stop; sentence never finishes
        rec = FakeRecognizer([(None, "please"), (None, "please stop"), (None, "please stop now")])
        make_listener(rig.srv, rec, rig.said.append).process([CHUNK] * 3)
        rig.stop_idx = len(rig.applied)   # everything applied after this is post-STOP

    rig = Rig({5: go_east, 60: half_sentence}).run()
    assert any(c.v > 0 for c in rig.applied[:60])                   # was driving before
    tail = rig.applied[rig.stop_idx:]
    assert tail and all(c.v == 0 and c.w == 0 and not c.pump for c in tail)
    stops = [o for o in rig.be.operator if o["intent"]["channel"] == "backstop"]
    assert len(stops) == 1 and stops[0]["valid"] and stops[0]["intent"]["name"] == "STOP"


def test_noise_and_unknown_speech_do_nothing_dangerous():
    def speak(rig):
        rec = FakeRecognizer([("[unk] [unk]", ""), ("banana", ""), ("the", "")])
        make_listener(rig.srv, rec, rig.said.append).process([CHUNK] * 3)

    rig = Rig({5: speak}, max_steps=40).run()
    assert all(c.v == 0 and c.w == 0 and not c.pump for c in rig.applied)   # stayed IDLE
    assert all(not o["valid"] for o in rig.be.operator)


def test_voice_with_no_robot_connected_is_reported_not_crashing():
    srv = BrainServer(lambda: Brain(), token="t")
    said: list[str] = []
    rec = FakeRecognizer([("status", "")])
    make_listener(srv, rec, said.append).process([CHUNK])
    assert any("no robot connected" in m for m in said)
    assert srv.emergency_stop() is False


def test_start_voice_thread_reports_audio_failure_and_survives():
    def boom():
        yield CHUNK
        raise OSError("microphone unplugged")

    said: list[str] = []
    t = start_voice(BrainServer(lambda: Brain(), token="t"), FakeRecognizer([]), boom(),
                    said.append)
    t.join(2)
    assert not t.is_alive() and any("microphone unplugged" in m for m in said)


def test_typed_commands_are_still_logged_as_typed():
    def typed(rig):
        rig.srv.brain.submit_text("status")

    rig = Rig({5: typed}, max_steps=30).run()
    (op,) = rig.be.operator
    assert op["intent"]["channel"] == "typed"


def test_concurrent_voice_thread_and_control_loop():
    """A real background voice thread feeding commands while frames stream (no deadlock/race)."""
    ready = threading.Event()

    def chunks():
        ready.wait(5)
        for _ in range(3):
            yield CHUNK
            time.sleep(0.02)

    def start(rig):
        rec = FakeRecognizer([("status", ""), ("go to the east side", ""), (None, "stop")])
        rig.t = start_voice(rig.srv, rec, chunks(), rig.said.append)
        ready.set()

    rig = Rig({5: start}, max_steps=400).run()
    rig.t.join(5)
    texts = [o["text"] for o in rig.be.operator]
    assert "status" in texts and "go to the east side" in texts
    assert np.isfinite(rig.hw.env.robot).all()
