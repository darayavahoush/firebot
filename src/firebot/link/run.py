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
    p.add_argument("--cmd-port", type=int, default=8766,
                   help="loopback HTTP port for manual-control commands from the console "
                        "backend (see firebot.link.cmdhttp); needs --token; 0 disables it")
    p.add_argument("--db", default=os.environ.get("FIREBOT_DB"),
                   help="PostgreSQL DSN (or env FIREBOT_DB); omit to run without logging")
    p.add_argument("--thermal-every", type=int, default=10,
                   help="store the 24x32 thermal frame every Nth frame (0 = never)")
    p.add_argument("--auto", action="store_true", help="start extinguishing as soon as connected")
    p.add_argument("--voice-model", help="path to an unpacked Vosk model: enables voice control "
                                         "(needs the `speech` extra)")
    p.add_argument("--voice-wav", help="with --voice-model: read a 16 kHz mono WAV instead of the mic")
    p.add_argument("--voice-device", help="microphone device index or name (see: python -m "
                                          "sounddevice)")
    p.add_argument("--open-vocab", action="store_true",
                   help="voice: accept any words instead of the restricted command grammar")
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

    bridge = None
    if a.cmd_port and a.token:
        from .cmdhttp import CommandBridge
        bridge = CommandBridge(server, token=a.token, port=a.cmd_port)
        bridge.start_in_thread()
        log.info("manual-control command bridge on 127.0.0.1:%d", bridge.server_address[1])
    elif a.cmd_port:
        log.warning("no --token: manual-control command bridge disabled "
                    "(console backend's drive/pump/estop calls will fail)")
    holder["bridge"] = bridge
    loop = asyncio.new_event_loop()

    def operator_input() -> None:
        for line in sys.stdin:
            if line.strip() and not server.submit_command(line.strip()):
                print("  (no robot connected)", flush=True)
    threading.Thread(target=operator_input, daemon=True).start()
    if a.voice_model:
        from itertools import chain

        from firebot.speech.audio import mic_chunks, wav_chunks
        from firebot.speech.recognizer import VoskRecognizer

        from .voice import start_voice
        try:
            rec = VoskRecognizer(a.voice_model, restrict=not a.open_vocab)
            if a.voice_wav:
                chunks = wav_chunks(a.voice_wav)
            else:
                dev = int(a.voice_device) if a.voice_device and a.voice_device.isdigit() \
                    else a.voice_device
                mic = mic_chunks(device=dev)
                chunks = chain([next(mic)], mic)   # open the mic now so failures show up now
        except Exception as e:  # noqa: BLE001
            sys.exit(f"voice input unavailable: {e}")
        start_voice(server, rec, chunks, say=lambda m: print(m, flush=True))
        log.info("voice control on (say: put out the fire / go to the east side / status / stop)")
    try:
        loop.run_until_complete(serve_forever(server))
    except KeyboardInterrupt:
        pass
    finally:
        loop.run_until_complete(server.stop())
        if bridge is not None:
            bridge.shutdown()
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
