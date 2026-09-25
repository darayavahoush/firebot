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
