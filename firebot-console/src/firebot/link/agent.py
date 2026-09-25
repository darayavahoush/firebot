"""Pi-side agent: stream sensor frames to the PC, apply the commands that come back. Nothing else.

No database, no planning, no numpy. Fail-safe: if no valid command arrives within
`watchdog` seconds (link down, PC crashed, brain stuck), motors and pump are stopped, and the
agent keeps trying to reconnect. Motors and pump are also stopped on start-up and shutdown.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Protocol

from .protocol import (
    MAX_LINE,
    VERSION,
    Command,
    Frame,
    ProtocolError,
    decode,
    encode,
    parse_command,
)

log = logging.getLogger("firebot.agent")


class HardwareDone(Exception):
    """Raised by a driver's read() when there is nothing more to run (simulation only)."""


class Hardware(Protocol):
    def read(self) -> Frame:
        """Sample all sensors + odometry. Must return quickly (well under the frame period)."""
    def apply(self, cmd: Command) -> None:
        """Drive motors/pump from a normalised command (v 0..1, w -1..1, pump on/off)."""
    def stop(self) -> None:
        """Motors off, pump off. Must be idempotent and must never raise."""


class PiAgent:
    def __init__(self, hw: Hardware, host: str, port: int, token: str = "", robot: str = "firebot-1",
                 rate_hz: float = 10.0, watchdog: float = 0.5, lockstep: bool = False,
                 reconnect: float = 1.0) -> None:
        self.hw, self.host, self.port, self.token, self.robot = hw, host, port, token, robot
        self.period, self.watchdog, self.lockstep = 1.0 / rate_hz, watchdog, lockstep
        self.reconnect = reconnect
        self.seq = 0
        self.frames_sent = self.cmds_applied = self.bad_msgs = self.watchdog_trips = 0
        self._last_cmd = 0.0
        self._ack = asyncio.Event()
        self._halt = False
        self._done = False

    def shutdown(self) -> None:
        self._halt = True

    def _safe_stop(self) -> None:
        try:
            self.hw.stop()
        except Exception:
            log.exception("hw.stop failed")

    async def run(self) -> None:
        self._safe_stop()
        try:
            while not self._halt and not self._done:
                try:
                    r, w = await asyncio.open_connection(self.host, self.port, limit=MAX_LINE)
                except OSError as e:
                    log.warning("cannot reach PC (%s); retrying", e)
                    self._safe_stop()
                    await asyncio.sleep(self.reconnect)
                    continue
                try:
                    await self._session(r, w)
                except (ConnectionError, asyncio.IncompleteReadError, OSError) as e:
                    log.warning("link lost (%s)", e)
                finally:
                    self._safe_stop()
                    w.close()
                if not self._done and not self._halt:
                    await asyncio.sleep(self.reconnect)
        finally:
            self._safe_stop()

    async def _session(self, r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
        w.write(encode({"type": "hello", "version": VERSION, "robot": self.robot,
                        "token": self.token}))
        await w.drain()
        reply = decode(await asyncio.wait_for(r.readline(), 5.0))
        if reply["type"] != "welcome":
            raise ConnectionError(f"rejected by PC: {reply.get('reason', reply['type'])}")
        self._last_cmd = time.monotonic()
        self._ack.clear()
        tasks = [asyncio.create_task(self._send_loop(w)), asyncio.create_task(self._recv_loop(r)),
                 asyncio.create_task(self._watchdog_loop())]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                t.result()
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _send_loop(self, w: asyncio.StreamWriter) -> None:
        while not self._halt:
            t0 = time.monotonic()
            try:
                frame = self.hw.read()
            except HardwareDone:
                self._done = True
                w.write(encode({"type": "bye"}))
                await w.drain()
                return
            frame.seq = self.seq
            self.seq += 1
            w.write(encode(frame.to_msg()))
            await w.drain()
            self.frames_sent += 1
            if self.lockstep:
                try:
                    await asyncio.wait_for(self._ack.wait(), self.watchdog)
                except asyncio.TimeoutError:
                    pass  # the watchdog loop stops the robot; keep streaming
                self._ack.clear()
            else:
                await asyncio.sleep(max(0.0, self.period - (time.monotonic() - t0)))

    async def _recv_loop(self, r: asyncio.StreamReader) -> None:
        while True:
            line = await r.readline()
            if not line:
                raise ConnectionError("PC closed the connection")
            try:
                msg = decode(line)
                if msg["type"] != "cmd":
                    continue
                cmd = parse_command(msg)
            except ProtocolError as e:
                self.bad_msgs += 1
                log.warning("ignoring bad message: %s", e)
                continue
            self._last_cmd = time.monotonic()
            self.hw.apply(cmd)
            self.cmds_applied += 1
            if cmd.ack >= 0:  # keepalives (ack=-1) don't release lock-step
                self._ack.set()

    async def _watchdog_loop(self) -> None:
        tripped = False
        while True:
            await asyncio.sleep(self.watchdog / 4)
            stale = time.monotonic() - self._last_cmd > self.watchdog
            if stale and not tripped:
                self.watchdog_trips += 1
                log.warning("no command for %.2fs: stopping", self.watchdog)
                self._safe_stop()
            tripped = stale
