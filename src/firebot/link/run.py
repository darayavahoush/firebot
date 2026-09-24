"""Command-line entry points.

PC:    firebot-brain --db postgresql://user:pw@localhost/firebot --host 0.0.0.0 --token SECRET
Robot: firebot-pi --host <pc-ip> --token SECRET            (real drivers: roadmap item 8)
Test:  firebot-pi --sim --host <pc-ip> --token SECRET      (simulated robot, no hardware)

Type operator commands into the brain's terminal ("put out the fire", "go to the east side",
"status", "stop"). Speech input calls `BrainServer.say_to_operator(text)` the same way.
"""
from __future__ import annotations

import argparse
import asyncio
import ipaddress
import logging
import os
import sys
import threading

log = logging.getLogger("firebot")


def _is_loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost"


def brain_main() -> None:
    from .brain import Brain
    from .server import BrainServer, serve_forever
    from .sink import BufferedSink, NullSink

    p = argparse.ArgumentParser(description="PC brain: receives robot data, sends commands, "
                                            "logs to PostgreSQL.")
    p.add_argument("--host", default="127.0.0.1", help="interface to listen on (0.0.0.0 for LAN)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--token", default=os.environ.get("FIREBOT_TOKEN", ""),
                   help="shared secret the robot must present (or env FIREBOT_TOKEN)")
    p.add_argument("--db", default=os.environ.get("FIREBOT_DB"),
                   help="PostgreSQL DSN (or env FIREBOT_DB); omit to run without logging")
    p.add_argument("--thermal-every", type=int, default=10,
                   help="store the 24x32 thermal frame every Nth frame (0 = never)")
    p.add_argument("--auto", action="store_true", help="start extinguishing as soon as connected")
    p.add_argument("--seed", type=int, default=0)
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
    if not _is_loopback(a.host) and not a.token:
        sys.exit("refusing to listen on a non-loopback address without --token / FIREBOT_TOKEN: "
                 "this port controls a pump and motors")
    if a.db:
        from .pg import PostgresBackend
        sink = BufferedSink(PostgresBackend(a.db, thermal_every=a.thermal_every))
        log.info("logging to PostgreSQL")
    else:
        sink = NullSink()
        log.warning("no --db given: telemetry is NOT being stored")

    holder: dict = {}
    def make_brain() -> Brain:
        return Brain(sink=sink, seed=a.seed, auto=a.auto, say=lambda m: print(f"  {m}", flush=True))

    server = BrainServer(make_brain, a.host, a.port, a.token)
    holder["server"] = server
    loop = asyncio.new_event_loop()

    def operator_input() -> None:
        for line in sys.stdin:
            if line.strip():
                if server.brain is None:
                    print("  (no robot connected)", flush=True)
                else:
                    server.say_to_operator(line.strip())
    threading.Thread(target=operator_input, daemon=True).start()
    try:
        loop.run_until_complete(serve_forever(server))
    except KeyboardInterrupt:
        pass
    finally:
        loop.run_until_complete(server.stop())
        if hasattr(sink, "close"):
            sink.close()


def pi_main() -> None:
    from .agent import PiAgent

    p = argparse.ArgumentParser(description="Robot agent: streams sensors to the PC, applies "
                                            "commands. No processing, no database.")
    p.add_argument("--host", required=True, help="address of the PC running firebot-brain")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--token", default=os.environ.get("FIREBOT_TOKEN", ""))
    p.add_argument("--robot", default="firebot-1")
    p.add_argument("--rate", type=float, default=10.0, help="frames per second")
    p.add_argument("--watchdog", type=float, default=0.5,
                   help="stop motors+pump if no command arrives for this many seconds")
    p.add_argument("--sim", action="store_true", help="use the simulated robot (no hardware)")
    p.add_argument("--realtime", action="store_true", help="with --sim: run at --rate, not lock-step")
    p.add_argument("--seed", type=int, default=0, help="with --sim")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
    if not a.sim:
        sys.exit("real hardware drivers are not implemented yet (roadmap item 8); use --sim")
    from .simhw import SimHardware
    agent = PiAgent(SimHardware(seed=a.seed), a.host, a.port, a.token, a.robot, a.rate, a.watchdog,
                    lockstep=not a.realtime)
    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        pass
    log.info("done: %d frames, %d commands, %d watchdog trips",
             agent.frames_sent, agent.cmds_applied, agent.watchdog_trips)
