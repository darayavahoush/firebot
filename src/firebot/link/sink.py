"""Where the brain sends telemetry. The control loop must never wait on a database, so the
`BufferedSink` queues rows and a background thread writes them in batches, retrying (and
reconnecting) if the database is down. If the queue fills up, oldest-first frame rows are
dropped and counted -- control keeps running.
"""
from __future__ import annotations

import collections
import contextlib
import logging
import queue
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from .protocol import Command, Frame

log = logging.getLogger("firebot.sink")


@dataclass
class FrameRow:
    session: str
    frame: Frame
    est: dict
    mode: str
    cmd: Command
    compute_ms: float
    recv_at: float


class Sink(Protocol):
    def start_session(self, robot: str, notes: str | None = None, meta: dict | None = None) -> str: ...
    def log_frame(self, sid: str, frame: Frame, est: dict, mode: str, cmd: Command,
                  compute_ms: float) -> None: ...
    def log_operator(self, sid: str, text: str, intent: dict | None, valid: bool,
                     message: str) -> None: ...
    def end_session(self, sid: str) -> None: ...
    def close(self) -> None: ...


class NullSink:
    """Logs nothing (used when no database is configured)."""
    def start_session(self, robot, notes=None, meta=None) -> str:
        return str(uuid.uuid4())

    def log_frame(self, *a, **k) -> None: ...
    def log_operator(self, *a, **k) -> None: ...
    def end_session(self, sid) -> None: ...
    def close(self) -> None: ...


class MemoryBackend:
    """In-memory backend for tests."""
    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.frames: list[FrameRow] = []
        self.operator: list[dict] = []
        self.fail = False   # tests flip this to simulate an outage

    def _check(self) -> None:
        if self.fail:
            raise ConnectionError("db down")

    def insert_session(self, sid, robot, notes, meta) -> None:
        self._check()
        self.sessions.setdefault(sid, {"robot": robot, "notes": notes, "meta": meta, "ended": False})

    def insert_frames(self, rows: list[FrameRow]) -> None:
        self._check()
        self.frames.extend(rows)

    def insert_operator(self, sid, text, intent, valid, message) -> None:
        self._check()
        self.operator.append({"session": sid, "text": text, "intent": intent, "valid": valid,
                              "message": message})

    def update_session_end(self, sid) -> None:
        self._check()
        self.sessions[sid]["ended"] = True

    def reconnect(self) -> None: ...
    def close(self) -> None: ...


class BufferedSink:
    def __init__(self, backend: Any, max_frames: int = 20000, batch: int = 200,
                 flush_every: float = 0.5, retry_every: float = 1.0) -> None:
        self.backend = backend
        self.batch, self.flush_every, self.retry_every = batch, flush_every, retry_every
        self._ctl: queue.Queue = queue.Queue()               # session/operator/end: low volume
        self._frames: collections.deque[FrameRow] = collections.deque(maxlen=max_frames)
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = False
        self.dropped = 0
        self.written = 0
        self.failures = 0
        self._t = threading.Thread(target=self._run, name="sink", daemon=True)
        self._t.start()

    # -- called from the control loop: must be instant and must never raise ----------------
    def start_session(self, robot, notes=None, meta=None) -> str:
        sid = str(uuid.uuid4())
        self._ctl.put(("session", (sid, robot, notes, meta or {})))
        self._wake.set()
        return sid

    def log_frame(self, sid, frame, est, mode, cmd, compute_ms) -> None:
        row = FrameRow(sid, frame, dict(est), mode, cmd, compute_ms, time.time())
        with self._lock:
            if len(self._frames) == self._frames.maxlen:
                self.dropped += 1
            self._frames.append(row)
        if len(self._frames) >= self.batch:
            self._wake.set()

    def log_operator(self, sid, text, intent, valid, message) -> None:
        self._ctl.put(("operator", (sid, text, intent, valid, message)))
        self._wake.set()

    def end_session(self, sid) -> None:
        self._ctl.put(("end", (sid,)))
        self._wake.set()

    def close(self, timeout: float = 10.0) -> None:
        self._stop = True
        self._wake.set()
        self._t.join(timeout)
        with contextlib.suppress(Exception):
            self.backend.close()

    # -- worker ---------------------------------------------------------------------------
    def _flush(self) -> None:
        while True:  # control rows first, in order (they create the session frames refer to)
            try:
                kind, args = self._ctl.queue[0]
            except IndexError:
                break
            {"session": self.backend.insert_session, "operator": self.backend.insert_operator,
             "end": self.backend.update_session_end}[kind](*args)
            self._ctl.get_nowait()
        while True:
            with self._lock:
                rows = list(self._frames)[: self.batch]
            if not rows:
                return
            self.backend.insert_frames(rows)
            with self._lock:
                for _ in rows:
                    self._frames.popleft()
            self.written += len(rows)

    def _run(self) -> None:
        while True:
            self._wake.wait(self.flush_every)
            self._wake.clear()
            try:
                self._flush()
            except Exception as e:  # noqa: BLE001
                self.failures += 1
                if self.failures == 1 or self.failures % 30 == 0:
                    log.warning("telemetry write failed (%s); buffering, %d frames queued",
                                e, len(self._frames))
                time.sleep(self.retry_every)
                with contextlib.suppress(Exception):
                    self.backend.reconnect()
            if self._stop:
                try:
                    self._flush()
                except Exception:  # noqa: BLE001
                    log.error("shutting down with %d unwritten frames", len(self._frames))
                return
