"""Procedural floor-plan generation for `World.random()`.

Builds a bigger multi-room building each call via recursive (BSP) space partition, then knocks a
doorway through the shared wall of every adjacent pair of rooms so the space is fully navigable.
Output is the same `(x, y, w, h)` wall-rectangle format `World` already consumes -- nothing
downstream needs to know the layout was generated instead of hand-drawn.
"""
from __future__ import annotations

import numpy as np

WALL_T = 0.12          # wall thickness, m
DOOR_W = 1.1            # doorway width, m
MIN_ROOM = 2.6           # smallest room span before we stop splitting, m


def _split(rng: np.random.Generator, rect: tuple[float, float, float, float],
           depth: int) -> list[tuple[float, float, float, float]]:
    """Recursively halve `rect` into leaf rooms, biasing the cut toward the longer axis."""
    x, y, w, h = rect
    if depth <= 0 or (w < MIN_ROOM * 2.1 and h < MIN_ROOM * 2.1):
        return [rect]
    vertical = w > h if abs(w - h) > 0.5 else bool(rng.integers(0, 2))
    span = w if vertical else h
    if span < MIN_ROOM * 2.1:
        return [rect]
    cut = rng.uniform(MIN_ROOM, span - MIN_ROOM)
    if vertical:
        a, b = (x, y, cut, h), (x + cut, y, w - cut, h)
    else:
        a, b = (x, y, w, cut), (x, y + cut, w, h - cut)
    return _split(rng, a, depth - 1) + _split(rng, b, depth - 1)


def generate_building(rng: np.random.Generator, width_range=(15.0, 22.0),
                       height_range=(11.0, 16.0),
                       split_depth_range=(3, 4)) -> tuple[float, float, list[tuple]]:
    """Return `(width, height, walls)` for a fresh, randomly laid-out building.

    Bigger than the fixed 12x8 default map on purpose -- more rooms to search, longer corridors
    to route around, a different topology every time so a planner/controller can't memorise one
    floor plan.
    """
    width = float(rng.uniform(*width_range))
    height = float(rng.uniform(*height_range))
    depth = int(rng.integers(*split_depth_range))
    rooms = _split(rng, (0.0, 0.0, width, height), depth)

    walls: list[tuple[float, float, float, float]] = [
        (0, 0, width, WALL_T), (0, height - WALL_T, width, WALL_T),
        (0, 0, WALL_T, height), (width - WALL_T, 0, WALL_T, height),
    ]
    # interior partitions with a doorway gap, one wall per room boundary (dedup shared edges)
    seen: set[tuple[float, float, float, float]] = set()
    for rx, ry, rw, rh in rooms:
        edges = [(rx, ry, rw, WALL_T), (rx, ry + rh - WALL_T, rw, WALL_T),
                 (rx, ry, WALL_T, rh), (rx + rw - WALL_T, ry, WALL_T, rh)]
        for ex, ey, ew, eh in edges:
            key = (round(ex, 2), round(ey, 2), round(ew, 2), round(eh, 2))
            if key in seen or ex <= 0 or ey <= 0 or ex + ew >= width or ey + eh >= height:
                continue
            seen.add(key)
            if ew > eh:  # horizontal partition: cut a doorway out of the middle
                if ew < DOOR_W + 1.0:
                    walls.append((ex, ey, ew, eh))
                    continue
                gap = rng.uniform(DOOR_W * .6, ew - DOOR_W - DOOR_W * .6)
                walls.append((ex, ey, gap, eh))
                walls.append((ex + gap + DOOR_W, ey, ew - gap - DOOR_W, eh))
            else:        # vertical partition
                if eh < DOOR_W + 1.0:
                    walls.append((ex, ey, ew, eh))
                    continue
                gap = rng.uniform(DOOR_W * .6, eh - DOOR_W - DOOR_W * .6)
                walls.append((ex, ey, ew, gap))
                walls.append((ex, ey + gap + DOOR_W, ew, eh - gap - DOOR_W))
    # a couple of freestanding obstacles (furniture/equipment) so open rooms aren't empty boxes
    n_props = int(rng.integers(2, 5))
    for _ in range(n_props):
        pw, ph = rng.uniform(0.4, 1.2), rng.uniform(0.4, 1.2)
        px = rng.uniform(1.5, width - 1.5 - pw)
        py = rng.uniform(1.5, height - 1.5 - ph)
        walls.append((px, py, pw, ph))
    return width, height, walls


# ---- freestanding scenery (trees, shrubs, barrels, shelves, tables, crates) -------------------
# Kept separate from `walls` on purpose: walls are the (x, y, w, h) rectangles every existing
# consumer (World grid, planners, DB scenario config) already understands, while props carry a
# kind/shape/yaw so a physics-backed world (`MuJoCoWorld`) can build proper 3-D bodies for them.
PROP_CLEARANCE = 0.6     # min free gap kept between a prop and any wall / other prop, m
_ROUND = {"tree": (0.12, 0.2, 1.3), "shrub": (0.25, 0.45, 0.8), "barrel": (0.22, 0.3, 0.9)}
_BOXES = {"shelf": ((0.9, 1.6), (0.35, 0.5), 1.8), "table": ((0.8, 1.2), (0.6, 0.9), 0.75),
          "crate": ((0.4, 0.8), (0.4, 0.8), 0.6)}
_KIND_WEIGHTS = {"tree": 3, "shrub": 3, "barrel": 2, "shelf": 1, "table": 1, "crate": 2}


def _bound_radius(p: dict) -> float:
    return float(p["r"]) if "r" in p else float(np.hypot(p["w"], p["h"]) / 2)


def _dist_to_rect(px: float, py: float, rect: tuple) -> float:
    x, y, w, h = rect
    return float(np.hypot(max(x - px, 0.0, px - (x + w)), max(y - py, 0.0, py - (y + h))))


def generate_props(rng: np.random.Generator, width: float, height: float, walls: list,
                   area_per_prop: float = 9.0, max_tries: int = 60) -> list[dict]:
    """Scatter clutter through a building, roughly one prop per `area_per_prop` m^2.

    Every prop keeps `PROP_CLEARANCE` of free space to every wall and to every other prop, so
    a doorway (1.1 m) can never be plugged and the map stays fully navigable however dense it
    gets. Round props carry a radius `r` (trunk radius for trees, plus a visual canopy radius
    `canopy`); box props carry `w`, `h` and a `yaw`.
    """
    kinds = list(_KIND_WEIGHTS)
    probs = np.array([_KIND_WEIGHTS[k] for k in kinds], dtype=float)
    probs /= probs.sum()
    target = int(width * height / area_per_prop)
    props: list[dict] = []
    for _ in range(target):
        for _try in range(max_tries):
            kind = str(rng.choice(kinds, p=probs))
            if kind in _ROUND:
                lo, hi, z = _ROUND[kind]
                prop = {"kind": kind, "r": float(rng.uniform(lo, hi)) if kind != "tree"
                        else float(rng.uniform(0.1, 0.16)), "height": z, "yaw": 0.0}
                if kind == "tree":
                    prop["canopy"] = float(rng.uniform(0.45, 0.8))
                bound = max(prop["r"], prop.get("canopy", 0.0) * 0.6)
            else:
                (wl, wh), (hl, hh), z = _BOXES[kind]
                prop = {"kind": kind, "w": float(rng.uniform(wl, wh)),
                        "h": float(rng.uniform(hl, hh)), "height": z,
                        "yaw": float(rng.uniform(0, np.pi))}
                bound = _bound_radius(prop)
            px, py = float(rng.uniform(1.0, width - 1.0)), float(rng.uniform(1.0, height - 1.0))
            if any(_dist_to_rect(px, py, w) < bound + PROP_CLEARANCE for w in walls):
                continue
            if any(np.hypot(px - q["x"], py - q["y"]) < bound + q["_b"] + PROP_CLEARANCE
                   for q in props):
                continue
            prop.update(x=px, y=py, _b=bound)
            props.append(prop)
            break
    for q in props:
        q.pop("_b")
    return props
