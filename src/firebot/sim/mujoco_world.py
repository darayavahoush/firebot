"""MuJoCo-backed world: the map is a real 3-D MJCF scene, not a painted grid.

`MuJoCoWorld` is a drop-in `World`: same `grid` / `occupied` / `is_free` / `ray` /
`line_of_sight` API, so `FireEnv`, the sensors, RRT* and the controllers run unchanged. What
differs is where the truth comes from:

* walls and props (trees, shrubs, barrels, shelves, tables, crates) are static MuJoCo geoms
  (boxes and cylinders, with yaw) compiled from generated MJCF;
* `ray()` / `rays()` are exact `mj_ray` / `mj_multiRay` casts at lidar height, restricted to
  the "solid" geom group so purely visual geoms (tree canopies) are never scanned;
* the planning `grid` is *derived from the scene* by casting rays down through every solid
  geom's footprint, so planners and physics can never disagree about what is solid;
* `robot_collides()` is a real narrow-phase contact query with a robot-sized cylinder;
* `render()` writes a top-down PNG (pure numpy, works headless); `view()` opens MuJoCo's
  interactive viewer.

Trees are modelled the way a 2-D lidar sees them: a thin trunk is the solid geom, the canopy
is visual-only (it sits above the scan plane).
"""
from __future__ import annotations

import json
import struct
import zlib

import numpy as np

from .world import RES, World

try:  # optional dependency: `pip install 'firebot[mujoco]'`
    import mujoco
except ImportError:  # pragma: no cover - exercised only when mujoco is absent
    mujoco = None

WALL_HEIGHT = 2.5
LIDAR_Z = 0.15            # height of the simulated scan plane, m
ROBOT_RADIUS, ROBOT_HEIGHT = 0.22, 0.25
SOLID, VISUAL, PROBE = 0, 1, 2   # geom groups; rays only see SOLID
_SOLID_MASK = None
_RGBA = {"wall": (0.72, 0.70, 0.66), "tree": (0.36, 0.24, 0.14), "canopy": (0.16, 0.5, 0.2),
         "shrub": (0.2, 0.55, 0.25), "barrel": (0.75, 0.3, 0.2), "shelf": (0.55, 0.42, 0.3),
         "table": (0.65, 0.5, 0.35), "crate": (0.8, 0.6, 0.25)}


def _require() -> None:
    if mujoco is None:
        raise ImportError("MuJoCoWorld needs mujoco: pip install 'firebot[mujoco]'")


def _solid_mask() -> np.ndarray:
    global _SOLID_MASK
    if _SOLID_MASK is None:
        _SOLID_MASK = np.zeros(6, dtype=np.uint8)
        _SOLID_MASK[SOLID] = 1
    return _SOLID_MASK


def _rgb(name: str) -> str:
    return " ".join(f"{c:.3f}" for c in _RGBA[name]) + " 1"


class MuJoCoWorld(World):
    def __init__(self, walls=None, width: float = 12.0, height: float = 8.0,
                 props: list[dict] | None = None, wall_height: float = WALL_HEIGHT) -> None:
        _require()
        super().__init__(walls=walls, width=width, height=height)  # analytic grid, replaced below
        self.props = [dict(q) for q in (props or [])]
        self.wall_height = float(wall_height)
        self.model = mujoco.MjModel.from_xml_string(self._mjcf())
        self.data = mujoco.MjData(self.model)
        mujoco.mj_forward(self.model, self.data)
        self._probe_body = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, "probe")
        self._probe_geom = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_GEOM, "probe_geom")
        self._solid_geoms = np.flatnonzero(self.model.geom_group == SOLID)
        self.grid = self._rasterise()

    # ---- construction ---------------------------------------------------------------------
    @classmethod
    def random(cls, rng: np.random.Generator | None = None, seed: int | None = None,
               area_per_prop: float = 9.0) -> MuJoCoWorld:
        """A fresh procedurally generated building, filled with clutter (denser = smaller
        `area_per_prop`)."""
        from .mapgen import generate_building, generate_props
        rng = rng if rng is not None else np.random.default_rng(seed)
        width, height, walls = generate_building(rng)
        props = generate_props(rng, width, height, walls, area_per_prop=area_per_prop)
        return cls(walls=walls, width=width, height=height, props=props)

    def _mjcf(self) -> str:
        g: list[str] = []
        for x, y, w, h in self.walls:
            g.append(f'<geom type="box" group="{SOLID}" pos="{x + w / 2} {y + h / 2} '
                     f'{self.wall_height / 2}" size="{w / 2} {h / 2} {self.wall_height / 2}" '
                     f'rgba="{_rgb("wall")}"/>')
        for q in self.props:
            kind, z = q["kind"], float(q.get("height", 0.8))
            if "r" in q:
                g.append(f'<geom type="cylinder" group="{SOLID}" pos="{q["x"]} {q["y"]} {z / 2}" '
                         f'size="{q["r"]} {z / 2}" rgba="{_rgb(kind)}"/>')
                if kind == "tree":  # visual-only canopy above the scan plane
                    c = float(q.get("canopy", 0.6))
                    g.append(f'<geom type="sphere" group="{VISUAL}" contype="0" conaffinity="0" '
                             f'pos="{q["x"]} {q["y"]} {z + c * .6}" size="{c}" '
                             f'rgba="{_rgb("canopy")}"/>')
            else:
                g.append(f'<geom type="box" group="{SOLID}" pos="{q["x"]} {q["y"]} {z / 2}" '
                         f'euler="0 0 {q.get("yaw", 0.0)}" '
                         f'size="{q["w"] / 2} {q["h"] / 2} {z / 2}" rgba="{_rgb(kind)}"/>')
        cx, cy = self.width / 2, self.height / 2
        return f"""<mujoco model="firebot">
  <compiler angle="radian"/>
  <option gravity="0 0 0"/>
  <worldbody>
    <geom name="floor" type="plane" group="{VISUAL}" contype="0" conaffinity="0"
          pos="{cx} {cy} 0" size="{cx} {cy} .1" rgba=".82 .8 .75 1"/>
    {chr(10).join(g)}
    <body name="probe" pos="{cx} {cy} 100">
      <freejoint/>
      <geom name="probe_geom" type="cylinder" group="{PROBE}" size="{ROBOT_RADIUS}
            {ROBOT_HEIGHT / 2}" rgba="0 0 1 .3"/>
    </body>
  </worldbody>
</mujoco>"""

    def _rasterise(self) -> np.ndarray:
        """Planning grid from the scene: drop rays through each solid geom's footprint
        (2x2 sub-samples per cell, so thin walls stay conservative like `World`'s grid)."""
        ny, nx = self.grid.shape
        grid = np.zeros((ny, nx), dtype=bool)
        m, d = self.model, self.data
        z_top = max([self.wall_height] + [float(q.get("height", 0.8)) for q in self.props]) + 0.5
        down = np.array([0.0, 0.0, -1.0])
        gid = np.zeros(1, dtype=np.int32)
        mask = _solid_mask()
        for k in self._solid_geoms:
            # geom_aabb is in the geom frame: rotate its half-extents into the world frame
            pos = d.geom_xpos[k]
            ext = np.abs(d.geom_xmat[k].reshape(3, 3)) @ m.geom_aabb[k, 3:]
            j0, j1 = max(int(np.floor((pos[0] - ext[0]) / RES)), 0), \
                min(int(np.ceil((pos[0] + ext[0]) / RES)), nx)
            i0, i1 = max(int(np.floor((pos[1] - ext[1]) / RES)), 0), \
                min(int(np.ceil((pos[1] + ext[1]) / RES)), ny)
            for i in range(i0, i1):
                for j in range(j0, j1):
                    if grid[i, j]:
                        continue
                    for sy in (0.25, 0.75):
                        for sx in (0.25, 0.75):
                            pnt = np.array([(j + sx) * RES, (i + sy) * RES, z_top])
                            dist = mujoco.mj_ray(m, d, pnt, down, mask, 1, -1, gid)
                            if dist >= 0 and gid[0] == k:
                                grid[i, j] = True
                                break
                        if grid[i, j]:
                            break
        return grid

    # ---- World API, physics-backed ---------------------------------------------------------
    def ray(self, x: float, y: float, a: float, max_range: float) -> float:
        """Exact distance to the first solid geom along angle `a` at lidar height."""
        gid = np.zeros(1, dtype=np.int32)
        dist = mujoco.mj_ray(self.model, self.data, np.array([x, y, LIDAR_Z]),
                             np.array([np.cos(a), np.sin(a), 0.0]), _solid_mask(), 1, -1, gid)
        return float(dist) if 0 <= dist < max_range else float(max_range)

    def rays(self, x: float, y: float, angles, max_range: float) -> np.ndarray:
        """Batched `ray()` for a whole lidar sweep -- one call instead of N."""
        a = np.asarray(angles, dtype=float)
        n = len(a)
        vec = np.stack([np.cos(a), np.sin(a), np.zeros(n)], axis=1).ravel()
        gid = np.zeros(n, dtype=np.int32)
        dist = np.zeros(n)
        mujoco.mj_multiRay(self.model, self.data, np.array([x, y, LIDAR_Z]), vec, _solid_mask(),
                           1, -1, gid, dist, None, n, max_range)
        return np.where((dist >= 0) & (gid >= 0), np.minimum(dist, max_range), max_range)

    def robot_collides(self, x: float, y: float, r: float = ROBOT_RADIUS) -> bool:
        """Real narrow-phase contact query: does a robot-sized cylinder at (x, y) overlap any
        solid geom?"""
        m, d = self.model, self.data
        m.geom_size[self._probe_geom, 0] = r
        # free body on purpose: a mocap body counts as static and generates no contacts
        d.qpos[:3] = [x, y, ROBOT_HEIGHT / 2 + .01]
        mujoco.mj_kinematics(m, d)
        mujoco.mj_collision(m, d)
        return any(c.dist <= 0 and self._probe_geom in (c.geom1, c.geom2)
                   for c in d.contact[:d.ncon])

    # ---- export / viewing -----------------------------------------------------------------
    def to_dict(self) -> dict:
        return {"width": self.width, "height": self.height,
                "walls": [list(w) for w in self.walls], "props": self.props}

    def export_map(self, path: str) -> None:
        """Dump walls + props as JSON so other tools (e.g. the web console) can load the map."""
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=1)

    def export_mjcf(self, path: str) -> None:
        """Write the scene as MJCF -- open it in `python -m mujoco.viewer --mjcf=<path>`."""
        with open(path, "w") as f:
            f.write(self._mjcf())

    def view(self) -> None:  # pragma: no cover - needs a display
        import mujoco.viewer
        mujoco.viewer.launch(self.model, self.data)

    def render(self, path: str, px_per_m: int = 50) -> None:
        """Top-down PNG of the scene (pure numpy, works headless -- no OpenGL needed)."""
        w, h = int(self.width * px_per_m), int(self.height * px_per_m)
        img = np.empty((h, w, 3), dtype=np.uint8)
        img[:] = (209, 204, 191)
        yy, xx = (np.mgrid[0:h, 0:w] + .5) / px_per_m
        yy = self.height - yy  # image row 0 is the top of the map (max y)

        def col(name):
            return tuple(int(c * 255) for c in _RGBA[name])

        for x, y, ww, hh in self.walls:
            img[(xx >= x) & (xx <= x + ww) & (yy >= y) & (yy <= y + hh)] = col("wall")
        for q in self.props:
            if q["kind"] == "tree":  # canopy first, then trunk on top
                img[np.hypot(xx - q["x"], yy - q["y"]) <= q["canopy"]] = col("canopy")
            if "r" in q:
                img[np.hypot(xx - q["x"], yy - q["y"]) <= q["r"]] = col(q["kind"])
            else:
                c, s = np.cos(q["yaw"]), np.sin(q["yaw"])
                u = (xx - q["x"]) * c + (yy - q["y"]) * s
                v = -(xx - q["x"]) * s + (yy - q["y"]) * c
                img[(np.abs(u) <= q["w"] / 2) & (np.abs(v) <= q["h"] / 2)] = col(q["kind"])
        _write_png(path, img)

    # ---- lifecycle (no global client in MuJoCo; kept so FireEnv can release worlds) -------
    def close(self) -> None:
        pass

    def __getstate__(self) -> dict:  # MjModel/MjData aren't picklable: ship the recipe instead
        return {"walls": self.walls, "width": self.width, "height": self.height,
                "props": self.props, "wall_height": self.wall_height}

    def __setstate__(self, s: dict) -> None:
        self.__init__(**s)


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
