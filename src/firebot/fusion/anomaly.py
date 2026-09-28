"""Telemetry anomaly detection over a run's stored frames. Pure Python, no model to train:
robust statistics (median/MAD) and a few physical sanity checks, so findings are explainable
("flame_left was stuck at 0.0 for 14 s while the robot drove 3 m") rather than a score.

Input: a list of frame dicts as the console stores them -- keys `seq`, `t`, `speed`, `tank`,
`sensors` (dict of scalar channels), `cmd_pump`, `compute_ms`. Missing keys are tolerated.
Output: findings `{"kind", "channel", "t", "t_end", "severity", "message"}`, time-ordered.

Detectors: stuck_sensor, spike, pump_no_drain, tank_leak, slow_compute, frame_gap. Each merges
consecutive hits into one finding so a 30-second fault is one line, not 300.
"""
from __future__ import annotations

import math
from itertools import pairwise
from statistics import median

MOVING_SPEED = 0.05        # m/s: below this the robot is effectively parked
STUCK_MIN_SECONDS = 4.0    # a channel this long at one value, while moving, is suspicious
SPIKE_K = 8.0              # robust-z threshold for a single-sample outlier
PUMP_WINDOW_S = 3.0
PUMP_MIN_DRAIN = 0.001     # tank fraction the tank should lose over the pump window
LEAK_WINDOW_S = 5.0
LEAK_MIN_DROP = 0.02
SLOW_K = 6.0
GAP_FACTOR = 4.0


def _mad(values: list[float]) -> float:
    m = median(values)
    return median(abs(v - m) for v in values)


def _finding(kind: str, channel: str, t: float, t_end: float, severity: str, message: str) -> dict:
    return {"kind": kind, "channel": channel, "t": round(t, 2), "t_end": round(t_end, 2),
            "severity": severity, "message": message}


def _channels(frames: list[dict]) -> list[str]:
    names: set[str] = set()
    for f in frames:
        names.update(k for k, v in (f.get("sensors") or {}).items()
                     if isinstance(v, (int, float)) and not isinstance(v, bool))
    return sorted(names)


def _stuck_finding(ch: str, start_t: float, last_t: float, value: float, driven: float) -> dict | None:
    if last_t - start_t >= STUCK_MIN_SECONDS and driven > 0.5:
        return _finding(
            "stuck_sensor", ch, start_t, last_t, "warning",
            f"{ch} sat at {value:g} for {last_t - start_t:.0f} s while the robot drove "
            f"{driven:.1f} m -- likely a stuck or disconnected sensor")
    return None


def _stuck(frames: list[dict]) -> list[dict]:
    out = []
    for ch in _channels(frames):
        # run = consecutive frames reporting the identical value
        run: list | None = None          # [start_t, last_t, value, driven_m]
        for f in frames:
            v = (f.get("sensors") or {}).get(ch)
            numeric = isinstance(v, (int, float)) and not isinstance(v, bool)
            if run is not None and numeric and v == run[2]:
                run[3] += (f.get("speed") or 0.0) * max(0.0, f["t"] - run[1])
                run[1] = f["t"]
                continue
            if run is not None and (hit := _stuck_finding(ch, *run)):
                out.append(hit)
            run = [f["t"], f["t"], v, 0.0] if numeric else None
        if run is not None and (hit := _stuck_finding(ch, *run)):
            out.append(hit)
    return out


def _spikes(frames: list[dict]) -> list[dict]:
    out = []
    for ch in _channels(frames):
        pts = [(f["t"], f["sensors"][ch]) for f in frames
               if isinstance((f.get("sensors") or {}).get(ch), (int, float))]
        if len(pts) < 20:
            continue
        vals = [v for _, v in pts]
        mad = _mad(vals) or 1e-6
        med = median(vals)
        for k in range(1, len(pts) - 1):
            t, v = pts[k]
            z = abs(v - med) / (1.4826 * mad)
            neighbours_ok = all(abs(pts[j][1] - med) / (1.4826 * mad) < SPIKE_K / 2
                                for j in (k - 1, k + 1))
            if z > SPIKE_K and neighbours_ok:  # isolated: neighbours normal => glitch, not event
                out.append(_finding("spike", ch, t, t, "info",
                                    f"{ch} jumped to {v:g} for one sample (typical {med:g})"))
    return out


def _pump_and_tank(frames: list[dict]) -> list[dict]:
    out = []
    tanked = [f for f in frames if f.get("tank") is not None]
    # pump commanded but tank not draining
    i = 0
    while i < len(tanked):
        if not tanked[i].get("cmd_pump"):
            i += 1
            continue
        j = i
        while j + 1 < len(tanked) and tanked[j + 1].get("cmd_pump"):
            j += 1
        span = tanked[j]["t"] - tanked[i]["t"]
        drain = tanked[i]["tank"] - tanked[j]["tank"]
        if span >= PUMP_WINDOW_S and drain < PUMP_MIN_DRAIN and tanked[i]["tank"] > 0.05:
            out.append(_finding("pump_no_drain", "tank", tanked[i]["t"], tanked[j]["t"], "critical",
                                f"pump commanded on for {span:.0f} s but the tank barely moved "
                                f"({tanked[i]['tank']:.2f} -> {tanked[j]['tank']:.2f}) -- pump or hose fault"))
        i = j + 1
    # tank dropping with the pump off
    i = 0
    while i < len(tanked):
        if tanked[i].get("cmd_pump"):
            i += 1
            continue
        j = i
        while j + 1 < len(tanked) and not tanked[j + 1].get("cmd_pump"):
            j += 1
        span = tanked[j]["t"] - tanked[i]["t"]
        drop = tanked[i]["tank"] - tanked[j]["tank"]
        if span >= LEAK_WINDOW_S and drop >= LEAK_MIN_DROP:
            out.append(_finding("tank_leak", "tank", tanked[i]["t"], tanked[j]["t"], "critical",
                                f"tank fell {drop:.2f} over {span:.0f} s with the pump off -- possible leak"))
        i = j + 1
    return out


def _slow_compute(frames: list[dict]) -> list[dict]:
    pts = [(f["t"], f["compute_ms"]) for f in frames if f.get("compute_ms") is not None]
    if len(pts) < 20:
        return []
    vals = [v for _, v in pts]
    med, mad = median(vals), (_mad(vals) or 0.5)
    limit = med + SLOW_K * 1.4826 * mad
    out, start, last, peak = [], None, None, 0.0
    for t, v in pts + [(math.inf, -1.0)]:
        if v > limit:
            start = t if start is None else start
            last, peak = t, max(peak, v)
        elif start is not None:
            if last - start >= 1.0:
                out.append(_finding("slow_compute", "compute_ms", start, last, "warning",
                                    f"brain latency reached {peak:.0f} ms (typical {med:.0f} ms) "
                                    f"for {last - start:.0f} s"))
            start, peak = None, 0.0
    return out


def _gaps(frames: list[dict]) -> list[dict]:
    if len(frames) < 10:
        return []
    dts = [b["t"] - a["t"] for a, b in pairwise(frames) if b["t"] > a["t"]]
    if not dts:
        return []
    typical = median(dts)
    out = []
    for a, b in pairwise(frames):
        dt = b["t"] - a["t"]
        if dt > GAP_FACTOR * typical and dt > 0.5:
            out.append(_finding("frame_gap", "link", a["t"], b["t"], "warning",
                                f"no telemetry for {dt:.1f} s (normally every {typical:.2f} s) "
                                f"-- link dropout"))
    return out


def detect_anomalies(frames: list[dict]) -> list[dict]:
    frames = sorted((f for f in frames if f.get("t") is not None), key=lambda f: f["t"])
    if len(frames) < 2:
        return []
    found = (_stuck(frames) + _spikes(frames) + _pump_and_tank(frames)
             + _slow_compute(frames) + _gaps(frames))
    order = {"critical": 0, "warning": 1, "info": 2}
    return sorted(found, key=lambda x: (x["t"], order[x["severity"]]))
