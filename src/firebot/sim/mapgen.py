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


def _generate(rng: np.random.Generator, width_range, height_range, split_depth_range,
              enclosed: bool = False):
    """Core generator: `(width, height, walls, rooms)`; rooms are `(x, y, w, h)` leaf cells.

    `enclosed=False` keeps the original (historical) behaviour byte-for-byte: interior edges
    that touch the outer boundary are skipped, so many rooms open onto each other. With
    `enclosed=True` every room is walled in and each shared boundary gets exactly one wall
    (owned by the room to its right/above) with its own doorway.
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
        if enclosed:      # own only the left + bottom edge, and only if interior
            edges = [e for e in (edges[0], edges[2]) if (e[1] > 0 if e[2] > e[3] else e[0] > 0)]
        for ex, ey, ew, eh in edges:
            key = (round(ex, 2), round(ey, 2), round(ew, 2), round(eh, 2))
            if enclosed:
                if key in seen:
                    continue
            elif key in seen or ex <= 0 or ey <= 0 or ex + ew >= width or ey + eh >= height:
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
    return width, height, walls, rooms


def generate_building(rng: np.random.Generator, width_range=(15.0, 22.0),
                       height_range=(11.0, 16.0),
                       split_depth_range=(3, 4)) -> tuple[float, float, list[tuple]]:
    """Return `(width, height, walls)` for a fresh, randomly laid-out building.

    Bigger than the fixed 12x8 default map on purpose -- more rooms to search, longer corridors
    to route around, a different topology every time so a planner/controller can't memorise one
    floor plan.
    """
    width, height, walls, _ = _generate(rng, width_range, height_range, split_depth_range)
    return width, height, walls


# ---- typed rooms + reachability ---------------------------------------------------------------
# Each room gets a purpose; the purpose decides the floor finish (renderer) and which props
# furnish it (generate_props), so the map reads like a building instead of random clutter.
ROOM_KINDS = {
    # kind: (floor style, {prop kind: weight}, prop density multiplier)
    "office":       ("wood",         {"table": 4, "shrub": 2, "shelf": 1, "crate": 1}, 0.8),
    "storage":      ("concrete",     {"shelf": 3, "crate": 3, "barrel": 2, "pallet": 3}, 1.3),
    "workshop":     ("tile",         {"barrel": 2, "crate": 2, "table": 2, "generator": 2, "column": 1}, 1.0),
    "atrium":       ("grass",        {"tree": 4, "shrub": 4, "bench": 2}, 1.2),
    "datacenter":   ("server_grid",  {"server_rack": 5, "generator": 1, "column": 1}, 1.3),
    "hazmat_lab":   ("epoxy_hazard", {"gas_cylinder": 4, "barrel": 3, "table": 2}, 1.1),
    "control_room": ("tech_deck",    {"console": 4, "shelf": 2, "table": 2}, 0.9),
}
_KIND_ORDER = ("office", "storage", "workshop", "atrium")
ALL_ROOM_KINDS = ("office", "storage", "workshop", "atrium", "datacenter", "hazmat_lab", "control_room")


def generate_layout(rng: np.random.Generator, width_range=(15.0, 22.0),
                    height_range=(11.0, 16.0), split_depth_range=(3, 4),
                    max_tries: int = 40,
                    room_kinds: tuple[str, ...] | None = None) -> tuple[float, float, list[tuple], list[dict]]:
    """Like `generate_building` but also returns typed rooms and *guarantees* every room is
    reachable (a robot-sized body can drive between all of them); layouts that seal a room off
    are redrawn. Returns `(width, height, walls, rooms)` with rooms as
    `{"x", "y", "w", "h", "kind"}` dicts."""
    for _ in range(max_tries):
        width, height, walls, cells = _generate(rng, width_range, height_range,
                                                split_depth_range, enclosed=True)
        if is_connected(width, height, walls):
            break
    kinds = _assign_kinds(rng, len(cells), room_kinds=room_kinds)
    rooms = [{"x": float(x), "y": float(y), "w": float(w), "h": float(h), "kind": k}
             for (x, y, w, h), k in zip(cells, kinds)]
    return width, height, walls, rooms


def _assign_kinds(rng: np.random.Generator, n: int,
                  room_kinds: tuple[str, ...] | None = None) -> list[str]:
    """Cycle through kinds in random order so a building has variety, not five storerooms."""
    order = room_kinds or _KIND_ORDER
    out: list[str] = []
    while len(out) < n:
        out += [str(k) for k in rng.permutation(order)]
    return out[:n]


def is_connected(width: float, height: float, walls: list, res: float = 0.1,
                 robot_r: float = 0.25, min_fraction: float = 0.97) -> bool:
    """True if (almost) all robot-reachable free space is one connected region.

    Walls are inflated by the robot radius on a coarse grid, then flood-filled from the largest
    free region; anything sealed off (or a doorway too narrow for the robot) shows up as free
    space outside that region.
    """
    ny, nx = int(height / res), int(width / res)
    occ = np.zeros((ny, nx), dtype=bool)
    for x, y, w, h in walls:
        occ[int(y / res):int(np.ceil((y + h) / res)), int(x / res):int(np.ceil((x + w) / res))] = True
    for _ in range(int(np.ceil(robot_r / res))):   # dilate by the robot radius
        d = occ.copy()
        d[1:] |= occ[:-1]
        d[:-1] |= occ[1:]
        d[:, 1:] |= occ[:, :-1]
        d[:, :-1] |= occ[:, 1:]
        occ = d
    free = ~occ
    total = int(free.sum())
    if total == 0:
        return False
    label = np.zeros((ny, nx), dtype=np.int32)
    best, n_lab = 0, 0
    for si, sj in zip(*np.nonzero(free)):
        if label[si, sj]:
            continue
        n_lab += 1
        label[si, sj] = n_lab
        stack, size = [(si, sj)], 0
        while stack:
            i, j = stack.pop()
            size += 1
            for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if 0 <= a < ny and 0 <= b < nx and free[a, b] and not label[a, b]:
                    label[a, b] = n_lab
                    stack.append((a, b))
        best = max(best, size)
    return best >= min_fraction * total


# ---- freestanding scenery (trees, shrubs, barrels, shelves, tables, crates, tech) ------------
# Kept separate from `walls` on purpose: walls are the (x, y, w, h) rectangles every existing
# consumer (World grid, planners, DB scenario config) already understands, while props carry a
# kind/shape/yaw so a physics-backed world (`MuJoCoWorld`) can build proper 3-D bodies for them.
PROP_CLEARANCE = 0.6     # min free gap kept between a prop and any wall / other prop, m
_ROUND = {
    "tree": (0.12, 0.2, 1.3),
    "shrub": (0.25, 0.45, 0.8),
    "barrel": (0.22, 0.3, 0.9),
    "gas_cylinder": (0.12, 0.18, 1.25),
    "column": (0.20, 0.32, 2.5),
}
_BOXES = {
    "shelf": ((0.9, 1.6), (0.35, 0.5), 1.8),
    "table": ((0.8, 1.2), (0.6, 0.9), 0.75),
    "crate": ((0.4, 0.8), (0.4, 0.8), 0.6),
    "server_rack": ((0.7, 1.0), (0.7, 0.9), 2.1),
    "generator": ((1.0, 1.4), (0.6, 0.9), 1.1),
    "pallet": ((1.0, 1.2), (0.9, 1.1), 0.85),
    "console": ((1.1, 1.5), (0.5, 0.7), 0.85),
    "bench": ((1.0, 1.4), (0.4, 0.5), 0.45),
}
_KIND_WEIGHTS = {
    "tree": 3, "shrub": 3, "barrel": 2, "shelf": 1, "table": 1, "crate": 2,
    "server_rack": 2, "generator": 1, "gas_cylinder": 2, "column": 1, "pallet": 2,
    "console": 1, "bench": 1,
}


def _bound_radius(p: dict) -> float:
    return float(p["r"]) if "r" in p else float(np.hypot(p["w"], p["h"]) / 2)


def _dist_to_rect(px: float, py: float, rect: tuple) -> float:
    x, y, w, h = rect
    return float(np.hypot(max(x - px, 0.0, px - (x + w)), max(y - py, 0.0, py - (y + h))))


def generate_props(rng: np.random.Generator, width: float, height: float, walls: list,
                   area_per_prop: float = 9.0, max_tries: int = 60,
                   rooms: list[dict] | None = None) -> list[dict]:
    """Scatter clutter through a building, roughly one prop per `area_per_prop` m^2.

    Every prop keeps `PROP_CLEARANCE` of free space to every wall and to every other prop, so
    a doorway (1.1 m) can never be plugged and the map stays fully navigable however dense it
    gets. Round props carry a radius `r` (trunk radius for trees, plus a visual canopy radius
    `canopy`); box props carry `w`, `h` and a `yaw`.

    With `rooms` (from `generate_layout`) each room is furnished by its purpose -- shelves and
    crates in storage, trees and shrubs in an atrium, tables in an office -- shelves are
    aligned to the room's axes, and each prop is tagged with its `room` index.
    """
    props: list[dict] = []
    if rooms:
        plan = []          # (room index, count) -- density scales with room area and purpose
        for k, r in enumerate(rooms):
            n = r["w"] * r["h"] / area_per_prop * ROOM_KINDS[r["kind"]][2]
            plan.append((k, int(n) + int(rng.random() < n - int(n))))
        jobs = [k for k, n in plan for _ in range(n)]
    else:
        jobs = [None] * int(width * height / area_per_prop)
    for room_k in jobs:
        if room_k is None:
            kinds = list(_KIND_WEIGHTS)
            probs = np.array([_KIND_WEIGHTS[k] for k in kinds], dtype=float)
            rx0, ry0, rx1, ry1 = 1.0, 1.0, width - 1.0, height - 1.0
        else:
            room = rooms[room_k]
            wts = ROOM_KINDS[room["kind"]][1]
            kinds, probs = list(wts), np.array(list(wts.values()), dtype=float)
            rx0, ry0 = room["x"] + 0.5, room["y"] + 0.5
            rx1, ry1 = room["x"] + room["w"] - 0.5, room["y"] + room["h"] - 0.5
        probs = probs / probs.sum()
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
            if rx1 <= rx0 or ry1 <= ry0:
                break
            if room_k is not None and kind in ("shelf", "crate", "server_rack", "console", "pallet", "bench"):
                prop["yaw"] = float(rng.choice([0.0, np.pi / 2]))   # square to the room
            px, py = float(rng.uniform(rx0, rx1)), float(rng.uniform(ry0, ry1))
            if any(_dist_to_rect(px, py, w) < bound + PROP_CLEARANCE for w in walls):
                continue
            if any(np.hypot(px - q["x"], py - q["y"]) < bound + q["_b"] + PROP_CLEARANCE
                   for q in props):
                continue
            prop.update(x=px, y=py, _b=bound)
            if room_k is not None:
                prop["room"] = room_k
            props.append(prop)
            break
    for q in props:
        q.pop("_b")
    return props
