"""Network side of the brain: accepts the Pi, feeds frames to `Brain`, returns commands."""
from __future__ import annotations

import asyncio
import hmac
import logging
import time
from collections.abc import Callable

from .brain import Brain
from .protocol import (
    MAX_LINE,
    STOP,
    VERSION,
    Command,
    Frame,
    ProtocolError,
    decode,
    encode,
    parse_frame,
)

log = logging.getLogger("firebot.brain")

KEEPALIVE = 0.15  # s: while the brain is busy planning, tell the Pi "stay stopped, I'm alive"


class BrainServer:
    def __init__(self, make_brain: Callable[[], Brain], host: str = "127.0.0.1", port: int = 8765,
                 token: str = "") -> None:
        self.make_brain, self.host, self.port, self.token = make_brain, host, port, token
        self.brain: Brain | None = None
        self.stats = {"frames": 0, "bad_frames": 0, "skipped_frames": 0, "sessions": 0}
        self._server: asyncio.AbstractServer | None = None
        self._active: asyncio.Task | None = None
        self.bound_port = port

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle, self.host, self.port, limit=MAX_LINE)
        self.bound_port = self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self._server:
            self._server.close()
        if self._active:
            self._active.cancel()
        if self._server:
            await self._server.wait_closed()

    def submit_command(self, text: str, channel: str = "typed") -> bool:
        """Operator text (typed or transcribed) for the connected robot. False if none."""
        brain = self.brain
        if brain is None:
            return False
        brain.submit_text(text, channel)
        return True

    say_to_operator = submit_command  # older name

    def emergency_stop(self, heard: str = "stop") -> bool:
        """STOP backstop: called the instant a stop word is heard, mid-utterance."""
        return self.submit_command("stop", "backstop")

    async def _handle(self, r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
        if self._active is not None and not self._active.done():
            self._active.cancel()  # a reconnecting robot replaces its stale session
            await asyncio.gather(self._active, return_exceptions=True)
        self._active = asyncio.current_task()
        try:
            await self._session(r, w)
        except (ConnectionError, asyncio.IncompleteReadError, asyncio.CancelledError):
            pass
        except Exception:
            log.exception("session crashed")
        finally:
            w.close()

    async def _session(self, r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
        try:
            hello = decode(await asyncio.wait_for(r.readline(), 5.0))
        except (ProtocolError, asyncio.TimeoutError):
            return
        ok = (hello.get("type") == "hello" and hello.get("version") == VERSION
              and hmac.compare_digest(str(hello.get("token", "")).encode(), self.token.encode()))
        if not ok:
            w.write(encode({"type": "error", "reason": "bad hello or token"}))
            await w.drain()
            return
        brain = self.brain = self.make_brain()
        self.stats["sessions"] += 1
        w.write(encode({"type": "welcome", "session": brain.sid}))
        await w.drain()
        log.info("robot %s connected (session %s)", hello.get("robot"), brain.sid)

        latest: list[Frame | None] = [None]
        wake = asyncio.Event()
        closed = asyncio.Event()

        async def reader() -> None:
            try:
                while True:
                    line = await r.readline()
                    if not line:
                        return
                    try:
                        msg = decode(line)
                        if msg["type"] == "bye":
                            return
                        if msg["type"] != "frame":
                            continue
                        f = parse_frame(msg)
                    except ProtocolError as e:
                        self.stats["bad_frames"] += 1
                        log.warning("dropping bad frame: %s", e)
                        continue
                    if latest[0] is not None:
                        self.stats["skipped_frames"] += 1  # only the newest frame is worth acting on
                    latest[0] = f
                    wake.set()
            finally:
                closed.set()
                wake.set()

        rt = asyncio.create_task(reader())
        loop = asyncio.get_running_loop()
        try:
            while True:
                await wake.wait()
                wake.clear()
                frame, latest[0] = latest[0], None
                if frame is None:
                    if closed.is_set():
                        return
                    continue
                fut = loop.run_in_executor(None, brain.on_frame, frame)
                while True:
                    try:
                        cmd = await asyncio.wait_for(asyncio.shield(fut), KEEPALIVE)
                        break
                    except asyncio.TimeoutError:  # planning is slow: hold the robot still
                        w.write(encode(Command(0.0, 0.0, False, -1).to_msg()))
                        await w.drain()
                w.write(encode(brain.final_check(cmd).to_msg()))
                await w.drain()
                self.stats["frames"] += 1
        finally:
            rt.cancel()
            try:
                w.write(encode(STOP.to_msg()))
                await w.drain()
            except (ConnectionError, OSError):
                pass
            brain.close()
            self.brain = None
            log.info("robot disconnected")


async def serve_forever(server: BrainServer) -> None:
    await server.start()
    log.info("brain listening on %s:%d", server.host, server.bound_port)
    while True:
        await asyncio.sleep(3600)


def _now() -> float:
    return time.monotonic()
