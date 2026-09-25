"""Link layer: protocol validation, Pi fail-safes, brain behaviour, telemetry sinks."""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import tempfile
import time

import numpy as np
import pytest

from firebot.link import protocol as P
from firebot.link.agent import PiAgent
from firebot.link.brain import Brain
from firebot.link.protocol import Command
from firebot.link.server import BrainServer
from firebot.link.simhw import SimHardware
from firebot.link.sink import BufferedSink, MemoryBackend
from firebot.perception import Perception


def frame_msg(seq=0, **over):
    m = {"type": "frame", "seq": seq, "t": 0.1 * (seq if isinstance(seq, int) else 0), "pose": [1.0, 1.0, 0.0], "speed": 0.0,
         "tank": 1.0, "sensors": {**{n: 1.0 for n in P.SCALARS},
                                  "thermal": [[25.0] * 32 for _ in range(24)]}}
    m.update(over)
    return m


# ---- protocol ------------------------------------------------------------------------------
def test_frame_roundtrip():
    f = P.parse_frame(P.decode(P.encode(frame_msg(3))))
    assert f.seq == 3 and len(f.thermal) == 24 and len(f.thermal[0]) == 32


@pytest.mark.parametrize("bad", [
    {"pose": [1, 2]}, {"seq": "x"}, {"tank": None}, {"sensors": []},
    {"sensors": {"thermal": []}},
])
def test_bad_frames_rejected(bad):
    with pytest.raises(P.ProtocolError):
        P.parse_frame(frame_msg(**bad))


def test_missing_sensor_and_nan_rejected():
    m = frame_msg()
    del m["sensors"]["us_left"]
    with pytest.raises(P.ProtocolError):
        P.parse_frame(m)
    m = frame_msg()
    m["sensors"]["us_left"] = float("nan")
    with pytest.raises(P.ProtocolError):
        P.parse_frame(m)
    with pytest.raises(ValueError):
        P.encode({"type": "x", "v": float("nan")})  # NaN never goes on the wire


def test_command_clamped_and_validated():
    c = P.parse_command({"type": "cmd", "v": 5, "w": -9, "pump": True, "ack": 4})
    assert (c.v, c.w, c.pump, c.ack) == (1.0, -1.0, True, 4)
    for bad in ({"v": "1", "w": 0, "pump": False}, {"v": 0, "w": 0, "pump": 1},
                {"v": 0, "w": 0}, {"v": float("inf"), "w": 0, "pump": False}):
        with pytest.raises(P.ProtocolError):
            P.parse_command(bad)


def test_decode_rejects_junk():
    for line in (b"not json", b"[1,2]", b'{"no_type":1}', b"x" * (P.MAX_LINE + 1)):
        with pytest.raises(P.ProtocolError):
            P.decode(line)


def test_pi_side_needs_no_numpy():
    code = ("import sys, firebot.link.agent, firebot.link.protocol; "
            "sys.exit(any(m.split('.')[0] in ('numpy','psycopg','sqlite3') for m in sys.modules))")
    assert subprocess.run([sys.executable, "-c", code], check=False).returncode == 0


def test_scalar_names_match_sensor_layout():
    from firebot.sensing import FLAME, US
    assert set(P.SCALARS) == {*US, *FLAME, "mq2_front", "mq2_rear"}


def test_perception_matches_env():
    """The extracted Perception reproduces what the sim environment observes."""
    from firebot.sim.env import FireEnv
    env = FireEnv()
    obs, _ = env.reset(seed=3)
    ref = Perception(vmax=0.7)
    rng = np.random.default_rng(0)
    for _ in range(60):
        obs, *_ = env.step(np.array([.7, rng.uniform(-1, 1), 0.0]))
        # env fused this frame already; a fresh filter fed the same history must agree
        mine = ref.update(env.last, env.robot, env.tank, env.meas_speed)
        assert mine.shape == obs.shape
    assert np.allclose(ref.est["x"], env.est["x"], atol=1.0)


# ---- helpers -------------------------------------------------------------------------------
class Probe(SimHardware):
    """SimHardware that records commands and can run a hook at frame N."""
    def __init__(self, *a, hooks=None, **k):
        super().__init__(*a, **k)
        self.applied, self.hooks, self.reads = [], hooks or {}, 0

    def apply(self, cmd):
        self.applied.append(cmd)
        super().apply(cmd)

    def read(self):
        self.reads += 1
        if self.reads in self.hooks:
            self.hooks[self.reads]()
        return super().read()


async def run_link(hw, *, auto=False, token="t", lockstep=True, sink=None, timeout=60, **brain_kw):
    sink = sink or BufferedSink(MemoryBackend())
    holder = {}

    def make():
        holder["brain"] = Brain(sink=sink, auto=auto, **brain_kw)
        return holder["brain"]
    srv = BrainServer(make, token=token)
    await srv.start()
    agent = PiAgent(hw, "127.0.0.1", srv.bound_port, token, lockstep=lockstep, watchdog=1.0)
    holder["server"] = srv
    try:
        await asyncio.wait_for(agent.run(), timeout)
    finally:
        await srv.stop()
    return agent, srv, holder


# ---- end to end ----------------------------------------------------------------------------
def test_e2e_auto_extinguishes_and_logs():
    be = MemoryBackend()
    sink = BufferedSink(be)
    hw = SimHardware(seed=2)
    _, srv, _ = asyncio.run(run_link(hw, auto=True, sink=sink))
    sink.close()
    assert hw.env.fire.p == 0.0
    assert len(be.frames) == srv.stats["frames"] > 50
    assert any(f.cmd.pump for f in be.frames)
    assert all(f.mode in ("IDLE", "AUTO", "GOTO") for f in be.frames)
    (sess,) = be.sessions.values()
    assert sess["ended"]


def test_idle_until_commanded():
    hw = Probe(seed=0, max_steps=40)
    start = hw.env.robot.copy()
    asyncio.run(run_link(hw))
    assert np.allclose(hw.env.robot, start)      # never moved
    assert all(c.v == 0 and c.w == 0 and not c.pump for c in hw.applied)


def test_operator_goto_then_stop_is_immediate():
    box = {}
    hooks = {5: lambda: box["b"].submit_text("go to the east side"),
             60: lambda: box["b"].submit_text("stop")}
    hw = Probe(seed=4, max_steps=100, hooks=hooks)

    async def go():
        sink = BufferedSink(MemoryBackend())
        srv = BrainServer(lambda: box.setdefault("b", Brain(sink=sink, seed=4)), token="t")
        await srv.start()
        ag = PiAgent(hw, "127.0.0.1", srv.bound_port, "t", lockstep=True, watchdog=1.0)
        await asyncio.wait_for(ag.run(), 60)
        await srv.stop()
        return sink
    sink = asyncio.run(go())
    sink.close()
    moved = [i for i, c in enumerate(hw.applied) if c.v > 0]
    assert moved and moved[0] < 20                       # GOTO started promptly
    after = hw.applied[62:]                              # STOP submitted at frame 60
    assert after and all(c.v == 0 and c.w == 0 and not c.pump for c in after)
    ops = sink.backend.operator
    assert [o["text"] for o in ops] == ["go to the east side", "stop"]
    assert all(o["valid"] for o in ops)


def test_reconnect_starts_idle_again():
    """A fresh connection gets a fresh brain: mode IDLE, no residual motion."""
    seen = []

    def make():
        b = Brain(sink=BufferedSink(MemoryBackend()), auto=True)
        seen.append(b)
        return b

    async def go():
        srv = BrainServer(make, token="t")
        await srv.start()
        for _ in range(2):
            ag = PiAgent(SimHardware(seed=2, max_steps=30), "127.0.0.1", srv.bound_port, "t",
                         lockstep=True, watchdog=1.0)
            await asyncio.wait_for(ag.run(), 30)
        await srv.stop()
    asyncio.run(go())
    assert len(seen) == 2 and seen[0] is not seen[1]


# ---- security / robustness -----------------------------------------------------------------
async def _raw(port, lines, read=True):
    r, w = await asyncio.open_connection("127.0.0.1", port)
    for ln in lines:
        w.write(ln if isinstance(ln, bytes) else P.encode(ln))
    await w.drain()
    out = []
    if read:
        try:
            while True:
                ln = await asyncio.wait_for(r.readline(), 0.5)
                if not ln:
                    break
                out.append(json.loads(ln))
        except asyncio.TimeoutError:
            pass
    w.close()
    return out


def hello(token="t", version=P.VERSION):
    return {"type": "hello", "version": version, "robot": "x", "token": token}


def test_wrong_token_and_version_rejected():
    async def go():
        srv = BrainServer(lambda: Brain(), token="secret")
        await srv.start()
        bad = await _raw(srv.bound_port, [hello("nope"), frame_msg()])
        old = await _raw(srv.bound_port, [hello("secret", version=99), frame_msg()])
        no_hello = await _raw(srv.bound_port, [frame_msg()])
        await srv.stop()
        return bad, old, no_hello, srv.stats
    bad, old, no_hello, stats = asyncio.run(go())
    for out in (bad, old, no_hello):
        assert not any(m["type"] == "cmd" for m in out)
    assert bad[0]["type"] == "error" and stats["frames"] == 0 and stats["sessions"] == 0


def test_garbage_does_not_kill_session():
    async def go():
        srv = BrainServer(lambda: Brain(), token="t")
        await srv.start()
        out = await _raw(srv.bound_port, [
            hello(), b"garbage\n", b'{"type":"frame"}\n', frame_msg(1, pose=[1, 2]),
            b'{"type":"frame","seq":1e999}\n',
            frame_msg(3)])
        await srv.stop()
        return out, srv.stats
    out, stats = asyncio.run(go())
    cmds = [m for m in out if m["type"] == "cmd"]
    assert len(cmds) == 1 and cmds[0]["ack"] == 3 and stats["bad_frames"] >= 3


# ---- Pi fail-safes -------------------------------------------------------------------------
class FakeHW:
    def __init__(self):
        self.stops, self.applied, self.n = 0, [], 0

    def read(self):
        self.n += 1
        return P.Frame(0, self.n * 0.1, (1.0, 1.0, 0.0), 0.0, 1.0,
                       {k: 1.0 for k in P.SCALARS}, [[25.0] * 32 for _ in range(24)])

    def apply(self, cmd):
        self.applied.append(cmd)

    def stop(self):
        self.stops += 1


def test_watchdog_stops_robot_when_pc_goes_silent():
    async def go():
        async def pc(r, w):
            await r.readline()
            w.write(P.encode({"type": "welcome", "session": "s"}))
            w.write(P.encode(P.Command(1.0, 0.0, True, 0).to_msg()))  # one "drive + pump" command
            await w.drain()
            await asyncio.sleep(1.2)                                   # ...then silence, link open
            w.close()
        srv = await asyncio.start_server(pc, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        hw = FakeHW()
        ag = PiAgent(hw, "127.0.0.1", port, watchdog=0.2, rate_hz=50, reconnect=5)
        task = asyncio.create_task(ag.run())
        await asyncio.sleep(0.7)
        stops_mid, trips = hw.stops, ag.watchdog_trips
        ag.shutdown()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        srv.close()
        return hw, stops_mid, trips
    hw, stops_mid, trips = asyncio.run(go())
    assert hw.applied and hw.applied[0].pump           # it did receive a pump-on command
    assert trips >= 1 and stops_mid >= 2               # ...and stopped when commands ceased


def test_link_loss_stops_and_agent_reconnects():
    conns = []

    async def go():
        async def pc(r, w):
            await r.readline()
            conns.append(1)
            w.write(P.encode({"type": "welcome", "session": "s"}))
            w.write(P.encode(P.Command(1.0, 0.0, True, 0).to_msg()))
            await w.drain()
            await asyncio.sleep(0.15)
            w.close()                                   # drop the link
        srv = await asyncio.start_server(pc, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        hw = FakeHW()
        ag = PiAgent(hw, "127.0.0.1", port, watchdog=5, rate_hz=50, reconnect=0.05)
        task = asyncio.create_task(ag.run())
        await asyncio.sleep(0.8)
        ag.shutdown()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        srv.close()
        return hw
    hw = asyncio.run(go())
    assert len(conns) >= 2                              # reconnected on its own
    assert hw.stops >= 3                                # stopped at start, on each loss, on exit


def test_agent_ignores_malformed_commands():
    async def go():
        async def pc(r, w):
            await r.readline()
            w.write(P.encode({"type": "welcome", "session": "s"}))
            w.write(b"junk\n")
            w.write(P.encode({"type": "cmd", "v": "fast", "w": 0, "pump": False}))
            w.write(P.encode({"type": "cmd", "v": 0.5, "w": 0, "pump": "yes"}))
            w.write(P.encode(P.Command(0.5, 0.0, False, 0).to_msg()))
            await w.drain()
            await asyncio.sleep(0.3)
            w.close()
        srv = await asyncio.start_server(pc, "127.0.0.1", 0)
        hw = FakeHW()
        ag = PiAgent(hw, "127.0.0.1", srv.sockets[0].getsockname()[1], watchdog=5, rate_hz=50,
                     reconnect=5)
        task = asyncio.create_task(ag.run())
        await asyncio.sleep(0.4)
        ag.shutdown()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        srv.close()
        return hw, ag
    hw, ag = asyncio.run(go())
    assert len(hw.applied) == 1 and hw.applied[0].v == 0.5 and ag.bad_msgs == 3


# ---- slow planning: keepalive + STOP override ----------------------------------------------
class SlowBrain(Brain):
    delay = 0.5

    def on_frame(self, frame):
        time.sleep(self.delay)
        return Command(1.0, 0.0, True, frame.seq)   # what a "drive forward, pump on" plan says


def test_slow_brain_keeps_pi_alive_but_still():
    async def go():
        brain = SlowBrain(sink=BufferedSink(MemoryBackend()))
        srv = BrainServer(lambda: brain, token="t")
        await srv.start()
        hw = FakeHW()
        ag = PiAgent(hw, "127.0.0.1", srv.bound_port, "t", watchdog=0.4, rate_hz=5, reconnect=5)
        task = asyncio.create_task(ag.run())
        await asyncio.sleep(0.42)     # first frame is mid-"planning": only keepalives so far
        early = list(hw.applied)
        await asyncio.sleep(0.9)
        ag.shutdown()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await srv.stop()
        return hw, ag, early
    hw, ag, early = asyncio.run(go())
    assert early and all(c.v == 0 and not c.pump for c in early)   # held still while thinking
    assert any(c.v == 1.0 for c in hw.applied)                     # then the real command
    assert ag.watchdog_trips == 0                                  # keepalives fed the watchdog


def test_estop_overrides_inflight_command():
    async def go():
        brain = SlowBrain(sink=BufferedSink(MemoryBackend()))
        srv = BrainServer(lambda: brain, token="t")
        await srv.start()
        hw = FakeHW()
        ag = PiAgent(hw, "127.0.0.1", srv.bound_port, "t", watchdog=0.4, rate_hz=5, reconnect=5)
        task = asyncio.create_task(ag.run())
        await asyncio.sleep(0.25)
        brain.submit_text("stop!")     # while the plan for the first frame is still computing
        await asyncio.sleep(0.9)
        ag.shutdown()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await srv.stop()
        return hw
    hw = asyncio.run(go())
    assert hw.applied and all(c.v == 0 and not c.pump for c in hw.applied)


# ---- manual control (console joystick / cmdhttp bridge) -------------------------------------
def test_manual_drive_via_server_reaches_hardware():
    box = {}
    hooks = {5: lambda: box["srv"].submit_manual(0.7, 0.0, pump=True, nozzle=15.0)}
    hw = Probe(seed=4, max_steps=60, hooks=hooks)

    async def go():
        sink = BufferedSink(MemoryBackend())
        srv = BrainServer(lambda: Brain(sink=sink, seed=4), token="t")
        box["srv"] = srv
        await srv.start()
        ag = PiAgent(hw, "127.0.0.1", srv.bound_port, "t", lockstep=True, watchdog=1.0)
        await asyncio.wait_for(ag.run(), 30)
        await srv.stop()
    asyncio.run(go())
    driving = [c for c in hw.applied if c.v > 0]
    assert driving and driving[0].v == pytest.approx(0.7) and driving[0].pump


def test_manual_dead_man_timeout_over_link():
    """No fresh submit_manual() call -> the executor's own timeout stops the robot, even

    though the operator never sent STOP."""
    box = {}
    hooks = {5: lambda: box["srv"].submit_manual(1.0, 0.0)}  # one sample, then silence
    hw = Probe(seed=4, max_steps=200, hooks=hooks)

    async def go():
        sink = BufferedSink(MemoryBackend())
        srv = BrainServer(lambda: Brain(sink=sink, seed=4), token="t")
        box["srv"] = srv
        await srv.start()
        ag = PiAgent(hw, "127.0.0.1", srv.bound_port, "t", lockstep=True, watchdog=1.0)
        await asyncio.wait_for(ag.run(), 60)
        await srv.stop()
    asyncio.run(go())
    moved = [i for i, c in enumerate(hw.applied) if c.v > 0]
    stopped_again = [i for i, c in enumerate(hw.applied) if c.v == 0 and i > moved[-1]]
    assert moved and stopped_again                 # drove briefly, then the dead-man kicked in
    assert all(c.v == 0 and not c.pump for c in hw.applied[stopped_again[0]:])


def test_manual_submit_when_disconnected_is_a_noop():
    srv = BrainServer(lambda: Brain(sink=BufferedSink(MemoryBackend())), token="t")
    assert srv.submit_manual(0.5, 0.0) is False   # no robot connected: nothing to crash into


# ---- cmdhttp: loopback bridge the console backend calls -------------------------------------
def _http_post(port, path, body, token="t"):
    import urllib.error
    import urllib.request
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_cmdhttp_bridge_requires_a_token():
    from firebot.link.cmdhttp import CommandBridge
    srv = BrainServer(lambda: Brain(sink=BufferedSink(MemoryBackend())), token="t")
    with pytest.raises(ValueError):
        CommandBridge(srv, token="", port=0)


def test_cmdhttp_bridge_forwards_manual_and_estop_and_checks_token():
    from firebot.link.cmdhttp import CommandBridge

    box = {}

    def send_wrong_token():
        box["wrong"] = _http_post(box["port"], "/manual", {"v": 0.5, "w": 0.0}, token="nope")

    def send_manual():
        box["manual"] = _http_post(box["port"], "/manual", {"v": 0.5, "w": 0.0}, token="tok")

    def send_estop():
        box["estop"] = _http_post(box["port"], "/estop", {}, token="tok")

    hooks = {5: send_wrong_token, 8: send_manual, 40: send_estop}
    hw = Probe(seed=4, max_steps=80, hooks=hooks)

    async def go():
        sink = BufferedSink(MemoryBackend())
        srv = BrainServer(lambda: Brain(sink=sink, seed=4), token="tok")
        await srv.start()
        bridge = CommandBridge(srv, token="tok", port=0)
        box["port"] = bridge.server_address[1]
        bridge.start_in_thread()
        ag = PiAgent(hw, "127.0.0.1", srv.bound_port, "tok", lockstep=True, watchdog=1.0)
        await asyncio.wait_for(ag.run(), 30)
        bridge.shutdown()
        await srv.stop()
    asyncio.run(go())

    assert box["wrong"][0] == 401 and not box["wrong"][1]["ok"]
    assert box["manual"] == (200, {"ok": True})
    assert box["estop"] == (200, {"ok": True})
    driving = [c for c in hw.applied if c.v > 0]
    assert driving                                   # the HTTP /manual call reached the robot
    assert all(c.v == 0 and not c.pump for c in hw.applied[-5:])  # then /estop stopped it


# ---- telemetry sink ------------------------------------------------------------------------
def _row_frame(i):
    return P.Frame(i, i * 0.1, (0.0, 0.0, 0.0), 0.0, 1.0, {k: 0.0 for k in P.SCALARS}, [])


def test_sink_buffers_through_outage_and_recovers():
    be = MemoryBackend()
    be.fail = True
    s = BufferedSink(be, retry_every=0.05, flush_every=0.05)
    sid = s.start_session("r")
    for i in range(50):
        s.log_frame(sid, _row_frame(i), {}, "IDLE", P.STOP, 1.0)
    s.log_operator(sid, "status", {"name": "STATUS"}, True, "ok")
    time.sleep(0.3)
    assert not be.frames and s.failures >= 1          # nothing lost, nothing written yet
    be.fail = False
    time.sleep(0.5)
    s.end_session(sid)
    s.close()
    assert [f.frame.seq for f in be.frames] == list(range(50))
    assert be.sessions[sid]["ended"] and len(be.operator) == 1


def test_sink_drops_oldest_when_full_and_never_blocks():
    be = MemoryBackend()
    be.fail = True
    s = BufferedSink(be, max_frames=100, retry_every=0.05, flush_every=0.05)
    sid = s.start_session("r")
    t0 = time.perf_counter()
    for i in range(1000):
        s.log_frame(sid, _row_frame(i), {}, "IDLE", P.STOP, 1.0)
    assert time.perf_counter() - t0 < 1.0             # control loop never waited on the DB
    assert s.dropped == 900
    be.fail = False
    time.sleep(0.4)
    s.close()
    assert [f.frame.seq for f in be.frames] == list(range(900, 1000))   # newest kept


# ---- PostgreSQL (real server via pgserver; skipped if not installed) ------------------------
@pytest.fixture(scope="module")
def pg():
    pytest.importorskip("psycopg")
    pgserver = pytest.importorskip("pgserver")
    d = tempfile.mkdtemp()
    srv = pgserver.get_server(d)
    yield srv.get_uri()
    srv.cleanup()


def test_postgres_end_to_end(pg):
    import psycopg

    from firebot.link.pg import PostgresBackend
    sink = BufferedSink(PostgresBackend(pg, thermal_every=10), flush_every=0.05)
    box = {}
    hw = Probe(seed=2, hooks={3: lambda: box["b"].submit_text("status")})

    async def go():
        srv = BrainServer(lambda: box.setdefault("b", Brain(sink=sink, seed=2, auto=True)),
                          token="t")
        await srv.start()
        ag = PiAgent(hw, "127.0.0.1", srv.bound_port, "t", lockstep=True, watchdog=1.0)
        await asyncio.wait_for(ag.run(), 60)
        await srv.stop()
    asyncio.run(go())
    sink.close()
    with psycopg.connect(pg) as c:
        (n, thermal, pumped, sigma_ok) = c.execute(
            "SELECT count(*), count(thermal), bool_or(cmd_pump), bool_and(est_sigma IS NOT NULL) "
            "FROM frames").fetchone()
        assert n > 50 and pumped and sigma_ok
        assert thermal == -(-n // 10)                       # thermal kept every 10th frame only
        (arr_len,) = c.execute("SELECT array_length(thermal,1) FROM frames "
                               "WHERE thermal IS NOT NULL LIMIT 1").fetchone()
        assert arr_len == 24 * 32
        ops = c.execute("SELECT text, valid FROM operator_commands").fetchall()
        assert ("status", True) in ops
        row = c.execute("SELECT frames, min_tank < 1, pumped FROM v_session_summary").fetchone()
        assert row[0] == n and row[1] and row[2]
        assert c.execute("SELECT ended_at IS NOT NULL FROM sessions").fetchone()[0]
        assert c.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == 1


def test_postgres_migration_is_idempotent_and_recovers_from_disconnect(pg):
    import psycopg

    from firebot.link.pg import PostgresBackend
    b = PostgresBackend(pg)
    PostgresBackend(pg).close()                              # second migrate: no error
    s = BufferedSink(b, flush_every=0.05, retry_every=0.05)
    sid = s.start_session("r2")
    for i in range(5):
        s.log_frame(sid, _row_frame(i), {"x": 1.0, "y": 2.0, "sigma": 0.5}, "IDLE", P.STOP, 1.0)
    time.sleep(0.3)
    b.conn.close()                                           # kill the connection mid-run
    for i in range(5, 10):
        s.log_frame(sid, _row_frame(i), {"x": 1.0, "y": 2.0, "sigma": 0.5}, "IDLE", P.STOP, 1.0)
    time.sleep(1.0)
    s.close()
    with psycopg.connect(pg) as c:
        assert c.execute("SELECT count(*) FROM frames WHERE session_id = %s",
                         (sid,)).fetchone()[0] == 10
