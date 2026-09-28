"""Incident summary for one stored run.

`summarize_run` computes facts deterministically from the frames/commands -- duration, distance,
water used, pump time, when the first fire cue appeared, operator commands, anomalies -- and
renders them as plain sentences. It only states what the data shows: frames don't record
"fire out", so the summary never claims the fire was extinguished.

`narrate` optionally asks an LLM (any `generate(prompt) -> str`, same shape as the SLM parser and
sequencer use) to re-word those sentences more naturally. The output is checked: every number in
it must already appear in the facts, otherwise the deterministic text is returned instead. So a
model can improve the prose but can't invent a figure.
"""
from __future__ import annotations

import math
import re
from collections.abc import Callable
from itertools import pairwise

FLAME_CUE = 0.15  # same threshold Perception uses to treat flame sensors as a fire cue


def _distance(frames: list[dict]) -> float:
    pts = [(f["x"], f["y"]) for f in frames if f.get("x") is not None and f.get("y") is not None]
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in pairwise(pts))


def _pump_intervals(frames: list[dict]) -> list[tuple[float, float]]:
    spans, start, last = [], None, None
    for f in frames:
        if f.get("cmd_pump"):
            start = f["t"] if start is None else start
            last = f["t"]
        elif start is not None:
            spans.append((start, last))
            start = None
    if start is not None:
        spans.append((start, last))
    return spans


def _first_fire_cue(frames: list[dict]) -> float | None:
    for f in frames:
        s = f.get("sensors") or {}
        flame = sum(v for k, v in s.items() if k.startswith("flame_") and isinstance(v, (int, float)))
        if flame > FLAME_CUE:
            return f["t"]
    return None


def summarize_run(frames: list[dict], commands: list[dict], anomalies: list[dict]) -> dict:
    frames = sorted((f for f in frames if f.get("t") is not None), key=lambda f: f["t"])
    if not frames:
        return {"facts": {}, "text": "No telemetry was recorded for this run."}
    tanks = [f["tank"] for f in frames if f.get("tank") is not None]
    pumps = _pump_intervals(frames)
    cue = _first_fire_cue(frames)
    modes: list[str] = []
    for f in frames:
        m = f.get("mode")
        if m and (not modes or modes[-1] != m):
            modes.append(m)
    invalid = [c for c in commands if not c.get("valid")]
    crit = [a for a in anomalies if a["severity"] == "critical"]
    facts = {
        "duration_s": round(frames[-1]["t"] - frames[0]["t"], 1),
        "distance_m": round(_distance(frames), 1),
        "modes": modes,
        "first_fire_cue_s": None if cue is None else round(cue, 1),
        "pump_on_s": round(sum(b - a for a, b in pumps), 1),
        "pump_activations": len(pumps),
        "tank_start": round(tanks[0], 2) if tanks else None,
        "tank_end": round(tanks[-1], 2) if tanks else None,
        "water_used_pct": round((tanks[0] - min(tanks)) * 100) if tanks else None,
        "operator_commands": len(commands),
        "rejected_commands": len(invalid),
        "anomalies": len(anomalies),
        "critical_anomalies": len(crit),
    }
    lines = [f"The robot ran for {facts['duration_s']:g} s and travelled {facts['distance_m']:g} m"
             + (f" (modes: {' -> '.join(modes)})." if modes else ".")]
    lines.append(f"Flame sensors first registered a fire at {facts['first_fire_cue_s']:g} s."
                 if cue is not None else "The flame sensors never registered a fire.")
    if pumps:
        lines.append(f"The pump ran {facts['pump_activations']} time(s) for {facts['pump_on_s']:g} s "
                     f"in total and used {facts['water_used_pct']}% of the tank "
                     f"({facts['tank_start']:g} -> {facts['tank_end']:g}).")
    else:
        lines.append("The pump was never activated.")
    if commands:
        lines.append(f"The operator issued {len(commands)} command(s)"
                     + (f"; {len(invalid)} rejected." if invalid else "."))
    if anomalies:
        lines.append(f"{len(anomalies)} anomaly finding(s), {len(crit)} critical: "
                     + "; ".join(a["message"] for a in anomalies[:3])
                     + ("..." if len(anomalies) > 3 else "."))
    else:
        lines.append("No telemetry anomalies were detected.")
    return {"facts": facts, "text": " ".join(lines)}


_NUM = re.compile(r"\d+(?:\.\d+)?")


def narrate(summary: dict, generate: Callable[[str], str]) -> str:
    """LLM re-wording of `summary["text"]`, or the deterministic text if the model output
    fails to parse, is empty, or contains a number that isn't in the source text."""
    base = summary["text"]
    prompt = ("Rewrite this robot run report as 2-4 clear sentences for an operator. Use ONLY "
              "the facts below; do not add, round, or infer any numbers or events.\n\n" + base)
    try:
        out = (generate(prompt) or "").strip()
    except Exception:  # noqa: BLE001 -- narration is optional; never break the endpoint
        return base
    if not out or not set(_NUM.findall(out)) <= set(_NUM.findall(base)):
        return base
    return out
