import random

from firebot.fusion.anomaly import detect_anomalies


def _frames(n=200, dt=0.1, **over):
    """Healthy run: driving, noisy sensors, tank steady, pump off."""
    rng = random.Random(0)
    out = []
    for i in range(n):
        out.append({"seq": i, "t": round(i * dt, 3), "speed": 0.4, "tank": 1.0, "cmd_pump": False,
                    "compute_ms": 5.0 + rng.random(),
                    "sensors": {"us_left": 1.0 + rng.random() * 0.1, "flame_left": rng.random() * 0.05}})
    for f in out:
        for fn in over.values():
            fn(f)
    return out


def kinds(found):
    return {f["kind"] for f in found}


def test_healthy_run_has_no_findings():
    assert detect_anomalies(_frames()) == []


def test_needs_at_least_two_frames():
    assert detect_anomalies([]) == [] and detect_anomalies(_frames(1)) == []


def test_stuck_sensor_while_moving_is_one_merged_finding():
    def stick(f):
        if 5.0 <= f["t"] <= 15.0:
            f["sensors"]["flame_left"] = 0.0
    found = [x for x in detect_anomalies(_frames(n=250, s=stick)) if x["kind"] == "stuck_sensor"]
    assert len(found) == 1 and found[0]["channel"] == "flame_left"
    assert found[0]["t"] == 5.0 and found[0]["t_end"] == 15.0
    assert "stuck or disconnected" in found[0]["message"]


def test_constant_sensor_while_parked_is_not_flagged():
    def park(f):
        f["speed"] = 0.0
        f["sensors"]["us_left"] = 1.0
    assert "stuck_sensor" not in kinds(detect_anomalies(_frames(p=park)))


def test_single_sample_spike_flagged_but_sustained_change_is_not():
    def spike(f):
        if f["seq"] == 100:
            f["sensors"]["us_left"] = 50.0
    assert "spike" in kinds(detect_anomalies(_frames(s=spike)))

    def step(f):
        if f["seq"] >= 100:
            f["sensors"]["us_left"] = 50.0 + f["seq"] * 1e-3
    assert "spike" not in kinds(detect_anomalies(_frames(s=step)))


def test_pump_on_but_tank_flat_is_critical():
    def pump(f):
        if 5.0 <= f["t"] <= 12.0:
            f["cmd_pump"] = True
    found = [x for x in detect_anomalies(_frames(p=pump)) if x["kind"] == "pump_no_drain"]
    assert len(found) == 1 and found[0]["severity"] == "critical"


def test_pump_draining_normally_is_fine():
    def pump(f):
        if 5.0 <= f["t"] <= 12.0:
            f["cmd_pump"] = True
            f["tank"] = 1.0 - (f["t"] - 5.0) * 0.05
        elif f["t"] > 12.0:
            f["tank"] = 1.0 - 7.0 * 0.05
    assert "pump_no_drain" not in kinds(detect_anomalies(_frames(p=pump)))


def test_tank_falling_with_pump_off_is_leak():
    def leak(f):
        f["tank"] = 1.0 - f["t"] * 0.01
    assert "tank_leak" in kinds(detect_anomalies(_frames(l=leak)))


def test_sustained_latency_flagged():
    def slow(f):
        if 8.0 <= f["t"] <= 11.0:
            f["compute_ms"] = 200.0
    found = [x for x in detect_anomalies(_frames(s=slow)) if x["kind"] == "slow_compute"]
    assert len(found) == 1 and "200 ms" in found[0]["message"]


def test_link_dropout_detected_from_time_gap():
    frames = [f for f in _frames() if not (8.0 < f["t"] < 11.0)]
    found = [x for x in detect_anomalies(frames) if x["kind"] == "frame_gap"]
    assert len(found) == 1 and found[0]["t_end"] - found[0]["t"] > 2.5


def test_findings_are_time_ordered():
    def both(f):
        if 5.0 <= f["t"] <= 12.0:
            f["cmd_pump"] = True
        if f["seq"] == 20:
            f["sensors"]["us_left"] = 50.0
    ts = [x["t"] for x in detect_anomalies(_frames(b=both))]
    assert ts == sorted(ts) and len(ts) >= 2
