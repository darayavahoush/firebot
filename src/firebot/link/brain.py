"""PC-side brain: one frame in -> one command out. Fusion, planning, command layer all live here.

`Brain` is plain synchronous logic (no sockets), so it is unit-testable; `server.py` wires it to
the network. Safety properties:
  * starts IDLE on every (re)connection -- the robot does nothing until told to;
  * an operator STOP is spotted the moment it is submitted (before it is queued) and overrides
    the next outgoing command even if a slow planning step is in flight;
  * commands from a malformed frame are never produced: bad frames are dropped, and the Pi's
    watchdog covers the gap;
  * manual joystick samples (`submit_manual`) coalesce to the latest value between frames and
    carry their own dead-man timeout in `CommandController` -- silence stops the robot even if
    the operator's console never sends another sample.
"""
from __future__ import annotations

import queue
import threading
import time
from collections.abc import Callable

import numpy as np

from firebot.command import CommandController, Interpreter, Result, RuleParser
from firebot.command.intents import Intent
from firebot.perception import Perception
from firebot.sim.env import TURRET_LIMIT
from firebot.sim.world import World

from .protocol import STOP, Command, Frame
from .sink import NullSink, Sink

CONFIRM_YES = {"yes", "y", "confirm", "confirmed", "do it", "go ahead", "yeah", "ok", "okay"}


class Brain:
    def __init__(self, world: World | None = None, sink: Sink | None = None,
                 interpreter: Interpreter | None = None, seed: int = 0, vmax: float = 0.7,
                 robot: str = "firebot-1", auto: bool = False,
                 say: Callable[[str], None] | None = None) -> None:
        self.world = world or World()
        self.sink = sink or NullSink()
        self.interp = interpreter or Interpreter()
        self.ctrl = CommandController(self.world, seed=seed)
        self.perception = Perception(vmax)
        self.say = say or (lambda msg: None)
        self.robot, self.auto, self.seed = robot, auto, seed
        self.sid = self.sink.start_session(robot, "brain session", {"seed": seed, "auto": auto})
        self._texts: queue.Queue[tuple[str, str]] = queue.Queue()
        self._manual_lock = threading.Lock()
        self._manual_sample: tuple[float, float, bool, float] | None = None
        self.estop = threading.Event()
        self.pending: Intent | None = None
        self.last_t: float | None = None
        self.frames = 0
        self._started = False

    # ---- operator input (callable from any thread) --------------------------------------
    def submit_text(self, text: str, channel: str = "typed") -> None:
        """Queue an operator command ("typed", "voice" or "backstop" -- recorded with it).

        STOP is detected immediately, not at the next frame.
        """
        if RuleParser().parse(text).name == "STOP":
            self.estop.set()
        self._texts.put((text, channel))

    def submit_manual(self, v: float, w: float, pump: bool = False, nozzle: float = 0.0) -> None:
        """Latest joystick/HTTP-bridge sample (callable from any thread).

        Only the newest sample matters -- this overwrites, it does not queue -- so a burst of
        UI ticks between frames never backs up.
        """
        with self._manual_lock:
            self._manual_sample = (float(v), float(w), bool(pump), float(nozzle))

    def _drain_texts(self) -> None:
        while True:
            try:
                text, channel = self._texts.get_nowait()
            except queue.Empty:
                return
            self._handle_text(text, channel)

    def _drain_manual(self) -> None:
        with self._manual_lock:
            sample, self._manual_sample = self._manual_sample, None
        if sample is not None:
            self.ctrl.update_manual(*sample)

    def _handle_text(self, text: str, channel: str) -> None:
        if self.pending is not None:
            intent, self.pending = self.pending, None
            if text.strip().lower() in CONFIRM_YES:
                res = self.ctrl.handle(intent, confirmed=True)
                self._record(text, intent, True, res, channel)
                return
        intent, valid, reason = self.interp.interpret(text)
        res = self.ctrl.handle(intent) if valid else Result(False, f"rejected: {reason}")
        if res.pending is not None:
            self.pending = res.pending
        self._record(text, intent, valid, res, channel)

    def _record(self, text: str, intent: Intent, valid: bool, res: Result,
                channel: str) -> None:
        if intent.name == "STOP" and valid:
            self.estop.clear()  # the executor is now IDLE; later frames are safe again
        self.say(res.message)
        self.sink.log_operator(self.sid, text, {**intent.to_json(), "channel": channel},
                               valid and res.ok, res.message)

    # ---- control --------------------------------------------------------------------------
    def on_frame(self, frame: Frame) -> Command:
        t0 = time.perf_counter()
        if not self._started:
            self._started = True
            if self.auto:
                self.submit_text("put out the fire")
        self._drain_texts()
        self._drain_manual()
        dt = 0.1 if self.last_t is None else float(np.clip(frame.t - self.last_t, 0.02, 0.5))
        self.last_t = frame.t
        s = {**frame.sensors, "thermal": np.asarray(frame.thermal, dtype=np.float32)}
        # Perception.update() itself stays turret-agnostic (it also runs on real-hardware
        # frames, which don't have a pan servo yet -- item 8); the turret component is
        # appended here from the frame's own telemetry, exactly like FireEnv._obs() appends
        # the sim's internal turret state, so CommandController always sees a uniform 17-wide
        # observation regardless of whether it's driven by SimHardware or (eventually) a real
        # Pi.
        obs = np.concatenate([self.perception.update(s, frame.pose, frame.tank, frame.speed),
                              [frame.turret / TURRET_LIMIT]]).astype(np.float32)
        a = self.ctrl.act(obs, np.asarray(frame.pose), dt)
        cmd = Command(float(a[0]), float(a[1]), bool(a[3] > 0.5), frame.seq, float(a[2]))
        if self.estop.is_set() or self.ctrl.mode == "IDLE":
            cmd = Command(0.0, 0.0, False, frame.seq)
        self.frames += 1
        self.sink.log_frame(self.sid, frame, self.perception.est, self.ctrl.mode, cmd,
                            (time.perf_counter() - t0) * 1000)
        return cmd

    def final_check(self, cmd: Command) -> Command:
        """Last gate before a command goes on the wire (called on the network thread)."""
        return Command(0.0, 0.0, False, cmd.ack) if self.estop.is_set() else cmd

    def close(self) -> None:
        self.sink.end_session(self.sid)


__all__ = ["STOP", "Brain"]
