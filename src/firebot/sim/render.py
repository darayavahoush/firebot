"""Polished top-down renderer for `MuJoCoWorld` (pure numpy -- no OpenGL, works headless/CI).

Draws the scene as a lit oblique "architectural plan": textured floors per room type (wood
planks, tile, concrete, grass), soft cast shadows, walls and furniture extruded with side
shading, and detailed props (leafy tree canopies, shrub clusters, barrel rims, shelf slats,
crate planks). Everything is supersampled and box-filtered down for smooth edges.
"""
from __future__ import annotations

import struct
import zlib

import numpy as np

PAD = 0.35                       # margin around the building, m
SUN = (0.16, -0.11)              # shadow drift per metre of height (world x, y)
LIFT = (-0.05, 0.09)             # how far a top face appears shifted per metre of height
BG = (34, 37, 44)
FLOORS = {                       # room kind -> floor style (mirrors mapgen.ROOM_KINDS)
    "office": "wood", "storage": "concrete", "workshop": "tile", "atrium": "grass",
    "datacenter": "tile", "hazmat_lab": "concrete", "control_room": "tile",
}


def _hash(a: np.ndarray, b: np.ndarray | float = 0.0, seed: float = 0.0) -> np.ndarray:
    """Cheap deterministic per-cell noise in [0, 1)."""
    v = np.sin(a * 12.9898 + b * 78.233 + seed * 37.719) * 43758.5453
    return v - np.floor(v)


def _c(rgb) -> np.ndarray:
    return np.asarray(rgb, dtype=np.float32)


class _Canvas:
    def __init__(self, width: float, height: float, ppm: int, ss: int) -> None:
        self.ppm = ppm * ss
        self.ss = ss
        self.x0, self.y1 = -PAD, height + PAD     # world coords of the image's top-left
        self.W = round((width + 2 * PAD) * ppm) * ss
        self.H = round((height + 2 * PAD) * ppm) * ss
        self.img = np.empty((self.H, self.W, 3), dtype=np.float32)
        self.img[:] = _c(BG)
        self.shadow = np.zeros((self.H, self.W), dtype=np.float32)

    def window(self, xa: float, xb: float, ya: float, yb: float):
        """Clip-safe pixel window covering world box [xa,xb]x[ya,yb] -> (slices, X, Y) or None."""
        c0 = max(int(np.floor((xa - self.x0) * self.ppm)), 0)
        c1 = min(int(np.ceil((xb - self.x0) * self.ppm)), self.W)
        r0 = max(int(np.floor((self.y1 - yb) * self.ppm)), 0)
        r1 = min(int(np.ceil((self.y1 - ya) * self.ppm)), self.H)
        if c1 <= c0 or r1 <= r0:
            return None
        xs = self.x0 + (np.arange(c0, c1) + 0.5) / self.ppm
        ys = self.y1 - (np.arange(r0, r1) + 0.5) / self.ppm
        X, Y = np.meshgrid(xs, ys)
        return (slice(r0, r1), slice(c0, c1)), X, Y


class _Shape:
    """A circle or yawed rectangle in world coords, with mask / local-frame helpers."""

    def __init__(self, x, y, r=None, w=None, h=None, yaw=0.0) -> None:
        self.x, self.y, self.r, self.w, self.h, self.yaw = x, y, r, w, h, yaw
        self.ext = r if r is not None else float(np.hypot(w, h)) / 2

    def local(self, X, Y, ox=0.0, oy=0.0):
        dx, dy = X - self.x - ox, Y - self.y - oy
        c, s = np.cos(self.yaw), np.sin(self.yaw)
        return dx * c + dy * s, -dx * s + dy * c            # u, v

    def mask(self, X, Y, ox=0.0, oy=0.0, grow=0.0):
        u, v = self.local(X, Y, ox, oy)
        if self.r is not None:
            return np.hypot(u, v) <= self.r + grow
        return (np.abs(u) <= self.w / 2 + grow) & (np.abs(v) <= self.h / 2 + grow)


def _paint(cv: _Canvas, shape: _Shape, color, ox=0.0, oy=0.0, grow=0.0, alpha=1.0,
           where=None) -> None:
    """Fill `shape` (shifted by ox, oy) with a colour or a callable(X, Y, shape) -> colour."""
    e = shape.ext + grow + 0.02
    win = cv.window(shape.x + ox - e, shape.x + ox + e, shape.y + oy - e, shape.y + oy + e)
    if win is None:
        return
    sl, X, Y = win
    m = shape.mask(X, Y, ox, oy, grow)
    if where is not None:
        m &= where(X, Y)
    if not m.any():
        return
    col = color(X, Y) if callable(color) else _c(color)
    dst = cv.img[sl]
    if alpha >= 1.0:
        dst[m] = col[m] if getattr(col, "ndim", 1) == 3 else col
    else:
        src = col[m] if getattr(col, "ndim", 1) == 3 else col
        dst[m] = dst[m] * (1 - alpha) + src * alpha


# ---- floors -------------------------------------------------------------------------------
def _floor(style: str, X, Y, seed: float) -> np.ndarray:
    if style == "wood":
        row = np.floor(Y / 0.17)
        col = np.floor((X + _hash(row, seed=seed) * 1.7) / 1.3)
        tone = 0.90 + 0.14 * _hash(row, col, seed)
        grain = 0.985 + 0.03 * np.sin(X * 40 + row * 3.1)
        seam_y = (Y / 0.17 - row) < 0.06
        seam_x = ((X + _hash(row, seed=seed) * 1.7) / 1.3 - col) < 0.012
        base = _c((204, 165, 120))[None, None, :] * (tone * grain)[..., None]
        base[seam_y | seam_x] *= 0.72
        return base
    if style == "tile":
        tx, ty = X / 0.55, Y / 0.55
        ix, iy = np.floor(tx), np.floor(ty)
        chk = ((ix + iy) % 2)[..., None]
        base = _c((206, 212, 216))[None, None, :] * (1 - 0.06 * chk)
        base = base * (0.97 + 0.04 * _hash(ix, iy, seed))[..., None]
        grout = ((tx - ix) < 0.035) | ((ty - iy) < 0.035)
        base[grout] = _c((150, 156, 160))
        return base
    if style == "grass":
        cell = 0.06
        n1 = _hash(np.floor(X / cell), np.floor(Y / cell), seed)
        n2 = _hash(np.floor(X / 0.5), np.floor(Y / 0.5), seed + 1)
        tone = 0.86 + 0.20 * n1 + 0.10 * n2
        return _c((104, 156, 84))[None, None, :] * tone[..., None]
    # concrete
    n1 = _hash(np.floor(X / 0.04), np.floor(Y / 0.04), seed)
    n2 = _hash(np.floor(X / 0.9), np.floor(Y / 0.9), seed + 2)
    tone = 0.93 + 0.08 * n1 + 0.07 * n2
    base = _c((172, 172, 168))[None, None, :] * tone[..., None]
    joint = (np.abs((X % 2.4) - 0.0) < 0.012) | (np.abs((Y % 2.4) - 0.0) < 0.012)
    base[joint] *= 0.78
    return base


def _draw_floors(cv: _Canvas, world) -> None:
    rooms = getattr(world, "rooms", None) or [
        {"x": 0.0, "y": 0.0, "w": world.width, "h": world.height, "kind": "storage"}]
    for k, r in enumerate(rooms):
        win = cv.window(r["x"], r["x"] + r["w"], r["y"], r["y"] + r["h"])
        if win is None:
            continue
        sl, X, Y = win
        inside = (X >= r["x"]) & (X <= r["x"] + r["w"]) & (Y >= r["y"]) & (Y <= r["y"] + r["h"])
        tex = _floor(FLOORS.get(r["kind"], "concrete"), X, Y, float(k))
        cv.img[sl][inside] = tex[inside]


# ---- shadows ------------------------------------------------------------------------------
def _box_blur(a: np.ndarray, rad: int) -> np.ndarray:
    if rad < 1:
        return a
    k = 2 * rad + 1
    for axis in (0, 1):
        p = np.pad(a, [(rad, rad) if i == axis else (0, 0) for i in range(2)], mode="edge")
        cs = np.cumsum(p, axis=axis, dtype=np.float64)
        z = np.zeros_like(cs.take([0], axis=axis))
        cs = np.concatenate([z, cs], axis=axis)
        n = a.shape[axis]
        a = ((cs.take(range(k, k + n), axis=axis) - cs.take(range(n), axis=axis)) / k
             ).astype(np.float32)
    return a


def _cast_shadow(cv: _Canvas, shape: _Shape, z: float, steps: int = 6) -> None:
    for t in np.linspace(0.15, 1.0, steps):
        ox, oy = SUN[0] * z * t, SUN[1] * z * t
        e = shape.ext + abs(ox) + abs(oy) + 0.05
        win = cv.window(shape.x - e, shape.x + e, shape.y - e, shape.y + e)
        if win is None:
            return
        sl, X, Y = win
        m = shape.mask(X, Y, ox, oy)
        cv.shadow[sl][m] = 1.0


def _apply_shadows(cv: _Canvas) -> None:
    sh = _box_blur(_box_blur(cv.shadow, int(0.05 * cv.ppm)), int(0.04 * cv.ppm))
    cv.img *= (1.0 - 0.42 * sh)[..., None] * _c((0.96, 0.97, 1.0))[None, None, :]


# ---- solids -------------------------------------------------------------------------------
def _extrude(cv: _Canvas, shape: _Shape, z: float, side_dark, side_lite, n: int = 7) -> tuple:
    """Draw the side walls of a prism by stacking the footprint upward; return top offset."""
    tx, ty = LIFT[0] * z, LIFT[1] * z
    for t in np.linspace(0.0, 1.0, n):
        col = _c(side_dark) * (1 - t) + _c(side_lite) * t
        _paint(cv, shape, col, tx * t, ty * t)
    return tx, ty


def _shade_disc(base, hi=1.18, lo=0.82):
    """Radial gradient callable factory: lit from the top-left."""
    def make(shape: _Shape, ox=0.0, oy=0.0, radius=None):
        R = radius or shape.r

        def f(X, Y):
            u = (X - shape.x - ox) / R
            v = (Y - shape.y - oy) / R
            lit = np.clip(0.5 + 0.5 * (-u * 0.55 + v * 0.65), 0, 1)
            return _c(base)[None, None, :] * (lo + (hi - lo) * lit)[..., None]
        return f
    return make


def _draw_wall(cv: _Canvas, x, y, w, h, height) -> None:
    s = _Shape(x + w / 2, y + h / 2, w=w, h=h)
    _cast_shadow(cv, s, height * 0.55)


def _wall_pass(cv: _Canvas, walls, height) -> None:
    z = height * 0.5
    for x, y, w, h in sorted(walls, key=lambda q: -(q[1] + q[3] / 2)):
        s = _Shape(x + w / 2, y + h / 2, w=w, h=h)
        if min(w, h) > 0.3 and max(w, h) <= 1.4:   # freestanding block -> concrete pillar
            tx, ty = _extrude(cv, s, z, (70, 74, 82), (128, 132, 140))
            _paint(cv, s, (150, 154, 162), tx, ty)
            _paint(cv, s, (176, 180, 188), tx, ty, grow=-0.05)
            continue
        tx, ty = _extrude(cv, s, z, (96, 92, 88), (168, 163, 156))
        _paint(cv, s, (236, 233, 226), tx, ty)


def _solid_shape(q: dict) -> _Shape:
    if "r" in q:
        return _Shape(q["x"], q["y"], r=q["r"])
    return _Shape(q["x"], q["y"], w=q["w"], h=q["h"], yaw=q.get("yaw", 0.0))


def _draw_prop(cv: _Canvas, q: dict, idx: int) -> None:
    kind = q["kind"]
    z = float(q.get("height", 0.8))
    rng = np.random.default_rng(1000 + idx)
    s = _solid_shape(q)
    tx, ty = LIFT[0] * z, LIFT[1] * z
    if kind == "tree":
        _paint(cv, s, _shade_disc((92, 62, 38))(s), 0, 0)              # trunk base
        cr = float(q.get("canopy", 0.6))
        top = (tx * 1.6, ty * 1.6 + 0.35)                              # canopy floats high
        c = _Shape(q["x"], q["y"], r=cr)
        _paint(cv, c, (20, 60, 28), top[0] * 0.5, top[1] * 0.5, alpha=0.55, grow=0.02)
        _paint(cv, c, _shade_disc((34, 112, 48))(c, top[0], top[1]), top[0], top[1])
        for _ in range(7):                                              # leaf clusters
            a, d = rng.uniform(0, 2 * np.pi), rng.uniform(0, cr * 0.62)
            bx, by = np.cos(a) * d, np.sin(a) * d
            b = _Shape(q["x"] + bx, q["y"] + by, r=cr * rng.uniform(0.28, 0.45))
            g = rng.uniform(0.85, 1.25)
            _paint(cv, b, _shade_disc((int(50 * g), int(140 * g), int(58 * g)), 1.25, 0.8)(
                b, top[0], top[1]), top[0], top[1], alpha=0.92,
                where=lambda X, Y, c=c, tp=top: c.mask(X, Y, tp[0], tp[1]))
        return
    if kind == "shrub":
        for _ in range(6):
            a, d = rng.uniform(0, 2 * np.pi), rng.uniform(0, q["r"] * 0.55)
            b = _Shape(q["x"] + np.cos(a) * d, q["y"] + np.sin(a) * d,
                       r=q["r"] * rng.uniform(0.5, 0.75))
            g = rng.uniform(0.8, 1.2)
            _paint(cv, b, _shade_disc((int(46 * g), int(130 * g), int(54 * g)), 1.28, 0.7)(
                b, tx, ty), tx * 0.8, ty * 0.8)
        return
    if kind in ("barrel", "gas_cylinder", "column"):
        if kind == "gas_cylinder":
            col = (210, 185, 45)
        elif kind == "column":
            col = (150, 155, 165)
        else:
            palette = [(178, 62, 48), (52, 98, 160), (196, 150, 46)]
            col = palette[idx % 3]
        _extrude(cv, s, z, tuple(int(c * 0.5) for c in col), tuple(int(c * 0.85) for c in col))
        top = _Shape(q["x"], q["y"], r=q["r"])
        _paint(cv, top, _shade_disc(col, 1.12, 0.9)(top, tx, ty), tx, ty)
        _paint(cv, _Shape(q["x"], q["y"], r=q["r"] * 0.82), tuple(int(c * 0.72) for c in col),
               tx, ty)
        _paint(cv, _Shape(q["x"], q["y"], r=q["r"] * 0.72), _shade_disc(col, 1.15, 0.95)(
            _Shape(q["x"], q["y"], r=q["r"] * 0.72), tx, ty), tx, ty)
        return
    # boxes ------------------------------------------------------------------------------
    body_map = {
        "shelf": ((88, 66, 46), (150, 118, 84), (176, 140, 100)),
        "table": ((120, 88, 58), (190, 150, 104), (214, 176, 128)),
        "crate": ((124, 88, 36), (190, 142, 66), (214, 166, 84)),
        "server_rack": ((24, 30, 42), (40, 52, 70), (55, 72, 95)),
        "generator": ((50, 55, 60), (90, 95, 105), (120, 128, 140)),
        "pallet": ((110, 85, 50), (160, 130, 85), (185, 155, 105)),
        "console": ((35, 40, 50), (65, 75, 90), (95, 110, 130)),
        "bench": ((90, 70, 50), (140, 110, 80), (170, 135, 100)),
    }
    body = body_map.get(kind, ((100, 100, 100), (150, 150, 150), (180, 180, 180)))
    _extrude(cv, s, z, body[0], body[1])
    _paint(cv, s, body[2], tx, ty)
    inner = _Shape(q["x"], q["y"], w=q["w"] - 0.08, h=q["h"] - 0.08, yaw=q.get("yaw", 0.0))
    if kind == "shelf":
        _paint(cv, inner, tuple(int(c * 0.78) for c in body[2]), tx, ty)
        along = q["w"] >= q["h"]

        def slats(X, Y, s=s, tx=tx, ty=ty, along=along):
            u, v = s.local(X, Y, tx, ty)
            return (np.floor((u if along else v) / 0.22) % 2).astype(bool)
        _paint(cv, inner, tuple(int(c * 0.66) for c in body[2]), tx, ty, where=slats)
        for _ in range(int(rng.integers(3, 6))):                        # boxes on the shelf
            bw = rng.uniform(0.12, 0.24)
            u0 = rng.uniform(-q["w"] / 2 + .12, q["w"] / 2 - .12)
            v0 = rng.uniform(-q["h"] / 2 + .1, q["h"] / 2 - .1)
            cy, sy = np.cos(q.get("yaw", 0.0)), np.sin(q.get("yaw", 0.0))
            it = _Shape(q["x"] + u0 * cy - v0 * sy, q["y"] + u0 * sy + v0 * cy, w=bw,
                        h=bw * .8, yaw=q.get("yaw", 0.0))
            c = [(196, 72, 60), (70, 120, 176), (232, 196, 82), (240, 236, 226)][
                int(rng.integers(0, 4))]
            _paint(cv, it, tuple(int(x * 0.6) for x in c), tx, ty + 0.02)
            _paint(cv, it, c, tx, ty + 0.05)
    elif kind == "table":
        _paint(cv, inner, tuple(int(c * 0.93) for c in body[2]), tx, ty)
        for dx, dy, r, col in ((-.2, .05, .06, (240, 240, 235)), (.25, -.08, .05, (60, 110, 170))):
            cy, sy = np.cos(q.get("yaw", 0.0)), np.sin(q.get("yaw", 0.0))
            it = _Shape(q["x"] + dx * cy - dy * sy, q["y"] + dx * sy + dy * cy, r=r)
            _paint(cv, it, (60, 50, 40), tx + .01, ty - .01, alpha=0.4)
            _paint(cv, it, col, tx, ty + 0.03)
    else:  # crate: border + X planks
        _paint(cv, inner, tuple(int(c * 0.92) for c in body[2]), tx, ty)

        def planks(X, Y, s=s, tx=tx, ty=ty, q=q):
            u, v = s.local(X, Y, tx, ty)
            a = q["h"] / q["w"]
            return (np.abs(v - u * a) < 0.03) | (np.abs(v + u * a) < 0.03)
        _paint(cv, inner, tuple(int(c * 0.66) for c in body[2]), tx, ty, where=planks)


def render_world(world, path: str, px_per_m: int = 60, supersample: int = 2) -> None:
    """Render `world` (walls, props, optional rooms) to a PNG at `path`."""
    cv = _Canvas(world.width, world.height, px_per_m, supersample)
    _draw_floors(cv, world)
    wall_h = getattr(world, "wall_height", 2.5)
    for x, y, w, h in world.walls:
        _draw_wall(cv, x, y, w, h, wall_h)
    for q in world.props:
        s = _solid_shape(q)
        _cast_shadow(cv, s, float(q.get("height", 0.8)) * 0.55)
        if q["kind"] == "tree":
            cs = _Shape(q["x"], q["y"], r=float(q.get("canopy", 0.6)) * 0.85)
            _cast_shadow(cv, cs, 1.7, steps=5)
    _apply_shadows(cv)
    # painter's algorithm: far (high y) first so nearer things overlap
    items = [("wall", w) for w in world.walls] + [("prop", (i, q)) for i, q in
                                                   enumerate(world.props)]

    def ykey(it):
        k, v = it
        return -(v[1] + v[3] / 2) if k == "wall" else -v[1]["y"]
    for kind, v in sorted(items, key=ykey):
        if kind == "wall":
            _wall_pass(cv, [v], wall_h)
        else:
            _draw_prop(cv, v[1], v[0])
    ss = cv.ss
    img = np.clip(cv.img, 0, 255)
    if ss > 1:
        img = img.reshape(cv.H // ss, ss, cv.W // ss, ss, 3).mean(axis=(1, 3))
    _write_png(path, img.astype(np.uint8))


def _write_png(path: str, rgb: np.ndarray) -> None:
    """Minimal PNG writer (no PIL/matplotlib dependency)."""
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[i].tobytes() for i in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
