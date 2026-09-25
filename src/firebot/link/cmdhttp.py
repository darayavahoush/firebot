"""Loopback HTTP bridge: the only channel the console's FastAPI backend (a separate process,
possibly a separate language/host in principle) has into a running `firebot-brain`.

Stdlib only, deliberately -- this must not grow a dependency on asyncio, FastAPI, or anything
else the brain process doesn't already need. Binds loopback by default and always requires a
token (`Authorization: Bearer <token>`, checked with `hmac.compare_digest`); `firebot-brain`
refuses to start this bridge at all without one (see `run.py`), same spirit as the operator
link's own non-loopback token requirement.

Routes:
    POST /manual  {"v", "w", "pump"?, "nozzle"?}  -> BrainServer.submit_manual(...)
    POST /estop   {}                               -> BrainServer.emergency_stop()

Both return {"ok": true/false}: false (with a 409) means the bridge itself is fine but no
robot is currently connected to the brain -- nothing to steer.
"""
from __future__ import annotations

import hmac
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .server import BrainServer


class _Handler(BaseHTTPRequestHandler):
    server: "CommandBridge"  # narrows the inherited attribute for type checkers

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
        pass  # quiet; the brain process already logs at the BrainServer level

    def _authorized(self) -> bool:
        want = f"Bearer {self.server.token}".encode()
        got = self.headers.get("Authorization", "").encode()
        return hmac.compare_digest(got, want)

    def _reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802 - stdlib method name
        if not self._authorized():
            self._reply(401, {"ok": False, "reason": "bad token"})
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            self._reply(400, {"ok": False, "reason": "malformed json"})
            return

        brain_server = self.server.brain_server
        if self.path == "/manual":
            try:
                v = float(body.get("v", 0.0))
                w = float(body.get("w", 0.0))
                pump = bool(body.get("pump", False))
                nozzle = float(body.get("nozzle", 0.0))
            except (TypeError, ValueError):
                self._reply(400, {"ok": False, "reason": "bad manual params"})
                return
            ok = brain_server.submit_manual(v, w, pump, nozzle)
        elif self.path == "/estop":
            ok = brain_server.emergency_stop()
        else:
            self._reply(404, {"ok": False, "reason": "not found"})
            return
        self._reply(200 if ok else 409, {"ok": ok})


class CommandBridge(ThreadingHTTPServer):
    """Loopback-only HTTP server exposing `/manual` and `/estop` for one `BrainServer`."""

    daemon_threads = True

    def __init__(self, brain_server: BrainServer, token: str, host: str = "127.0.0.1",
                 port: int = 8766) -> None:
        if not token:
            raise ValueError("cmdhttp bridge refuses to start without a token: "
                              "this port controls a pump and motors")
        self.brain_server = brain_server
        self.token = token
        super().__init__((host, port), _Handler)
        self._thread: threading.Thread | None = None

    def start_in_thread(self) -> None:
        self._thread = threading.Thread(target=self.serve_forever, daemon=True)
        self._thread.start()

    def shutdown(self) -> None:  # type: ignore[override]
        super().shutdown()
        self.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2.0)


__all__ = ["CommandBridge"]
