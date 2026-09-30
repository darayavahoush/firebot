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
* `render()` writes a polished top-down PNG (pure numpy, works headless); `view()` opens
  MuJoCo's interactive viewer with textured floors, sky and lighting.

Trees are modelled the way a 2-D lidar sees them: a thin trunk is the solid geom, the canopy
is visual-only (it sits above the scan plane).
"""
from __future__ import annotations

import json

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
_FLOOR_RGBA = {
    "office": (0.80, 0.65, 0.47), "storage": (0.68, 0.68, 0.66),
    "workshop": (0.80, 0.83, 0.85), "atrium": (0.41, 0.61, 0.33),
    "datacenter": (0.18, 0.26, 0.38), "hazmat_lab": (0.75, 0.70, 0.25),
    "control_room": (0.28, 0.32, 0.42),
}
_RGBA = {
    "wall": (0.72, 0.70, 0.66), "tree": (0.36, 0.24, 0.14), "canopy": (0.16, 0.5, 0.2),
    "shrub": (0.2, 0.55, 0.25), "barrel": (0.75, 0.3, 0.2), "shelf": (0.55, 0.42, 0.3),
    "table": (0.65, 0.5, 0.35), "crate": (0.8, 0.6, 0.25),
    "server_rack": (0.18, 0.22, 0.28), "generator": (0.40, 0.45, 0.50),
    "gas_cylinder": (0.85, 0.75, 0.20), "column": (0.60, 0.62, 0.65),
    "pallet": (0.70, 0.55, 0.35), "console": (0.25, 0.30, 0.38),
    "bench": (0.55, 0.40, 0.25),
}

_NEON = {
    "wall": (0.20, 0.14, 0.36, 1), "tree": (0.28, 0.16, 0.30, 1),
    "canopy": (0.20, 0.85, 0.62, 0.92), "shrub": (0.22, 0.80, 0.55, 1),
    "barrel": (0.95, 0.30, 0.65, 1), "shelf": (0.30, 0.48, 0.88, 1),
    "table": (0.72, 0.62, 0.95, 1), "crate": (0.30, 0.85, 0.85, 0.95),
    "server_rack": (0.12, 0.55, 0.88, 1), "generator": (0.35, 0.30, 0.60, 1),
    "gas_cylinder": (0.95, 0.85, 0.20, 1), "column": (0.30, 0.25, 0.50, 1),
    "pallet": (0.75, 0.45, 0.25, 1), "console": (0.20, 0.65, 0.75, 1),
    "bench": (0.55, 0.35, 0.65, 1),
}


# (label, rgb, where it sits) -- drives both the beam colours in the scene and the legend
SENSOR_LEGEND = [
    ("Ultrasonic x4", (0.10, 0.90, 0.85), "front L/R at +/-25 deg, sides at +/-90 deg"),
    ("Flame x3", (1.00, 0.25, 0.25), "front bumper, 0 and +/-30 deg"),
    ("Thermal MLX90640", (1.00, 0.90, 0.20), "roof front, 55 deg FOV"),
    ("MQ-2 gas x2", (1.00, 0.55, 0.10), "roof front-right, rear-left"),
    ("Scan plane (lidar rays)", (0.90, 0.90, 1.00), "0.15 m above floor"),
    ("Nozzle + pan servo", (0.25, 0.55, 1.00), "roof centre, +/-90 deg, 2.5 m spray"),
]
BEAM_LEN = 1.5      # drawn length of sensor beams, m (real ultrasonic range is 4 m)


def _rover_mjcf(x: float, y: float, yaw: float, turret: float = 0.0, beams: bool = True) -> str:
    """Visual-only rover with every sensor mounted where `firebot.sensing` says it points.

    Frame: +x forward, +y left. Ultrasonics use `US` angles, flame sensors `FLAME`, the thermal
    camera `HFOV`; the nozzle sits on a pan servo rotated by `turret` (rad, + = left).
    """
    from firebot.sensing import FLAME, HFOV, US
    vis = f'group="{VISUAL}" contype="0" conaffinity="0"'
    col = {n: c for n, c, _ in SENSOR_LEGEND}

    def rgba(name: str, a: float = 1.0) -> str:
        r, g, b = col[name]
        return f"{r} {g} {b} {a}"

    def box(pos, size, mat='material="metal"', euler="0 0 0"):
        return (f'<geom {vis} type="box" pos="{pos[0]} {pos[1]} {pos[2]}" euler="{euler}" '
                f'size="{size[0]} {size[1]} {size[2]}" {mat}/>')

    def cyl(pos, r, hh, mat, euler="0 0 0"):
        return (f'<geom {vis} type="cylinder" pos="{pos[0]} {pos[1]} {pos[2]}" euler="{euler}" '
                f'size="{r} {hh}" {mat}/>')

    def beam(p0, ang, length, name, alpha=0.55, r=0.004):
        p1 = (p0[0] + np.cos(ang) * length, p0[1] + np.sin(ang) * length, p0[2])
        return (f'<geom {vis} type="capsule" fromto="{p0[0]} {p0[1]} {p0[2]} {p1[0]} {p1[1]} '
                f'{p1[2]}" size="{r}" rgba="{rgba(name, alpha)}"/>')

    P = []
    for sx in (-1, 1):                                            # 4 wheels + suspension
        for sy in (-1, 1):
            P.append(cyl((sx * .19, sy * .225, .095), .095, .04, 'material="tyre"', "1.5708 0 0"))
            P.append(cyl((sx * .19, sy * .225, .095), .055, .046, 'rgba=".42 .42 .48 1"',
                         "1.5708 0 0"))
            P.append(box((sx * .19, sy * .17, .15), (.025, .012, .05)))
    P += [box((0, 0, .15), (.25, .16, .03)),                          # chassis
          box((-.03, 0, .245), (.15, .125, .065)),                    # cabin
          box((.155, 0, .235), (.075, .125, .045), euler="0 .55 0"),  # sloped nose
          box((.285, 0, .15), (.012, .2, .07), 'rgba=".5 .5 .55 1"'),  # bumper
          box((-.28, 0, .17), (.012, .19, .05), 'rgba=".5 .5 .55 1"')]

    # ultrasonic modules: housing + two transducer "eyes", pointing along the sensor angle
    us_mount = {"us_front_left": (.265, .10), "us_front_right": (.265, -.10),
                "us_left": (0.0, .165), "us_right": (0.0, -.165)}
    for n, a in US.items():
        mx, my = us_mount[n]
        z = .215 if "front" in n else .17
        c, sn = np.cos(a), np.sin(a)
        P.append(f'<body pos="{mx} {my} {z}" euler="0 0 {a}">'
                 + box((0, 0, 0), (.012, .036, .018), 'rgba=".1 .35 .75 1"')
                 + cyl((.014, .016, 0), .013, .008, 'rgba=".85 .85 .9 1"', "0 1.5708 0")
                 + cyl((.014, -.016, 0), .013, .008, 'rgba=".85 .85 .9 1"', "0 1.5708 0")
                 + "</body>")
        if beams:
            for da in (0.0, .13, -.13):       # ~15 deg cone: centre + edges
                P.append(beam((mx + c * .03, my + sn * .03, z), a + da, BEAM_LEN,
                              "Ultrasonic x4", .5 if da == 0 else .25))

    # flame sensors: red-tipped, on the bumper top, splayed at FLAME angles
    fl_y = {"flame_left": .07, "flame_center": 0.0, "flame_right": -.07}
    for n, a in FLAME.items():
        P.append(f'<body pos="{.275} {fl_y[n]} {.245}" euler="0 0 {a}">'
                 + box((0, 0, 0), (.014, .012, .012), 'rgba=".15 .15 .18 1"')
                 + cyl((.016, 0, 0), .008, .004, f'rgba="{rgba("Flame x3")}"', "0 1.5708 0")
                 + "</body>")
        if beams:
            P.append(beam((.29, fl_y[n], .245), a, BEAM_LEN * .8, "Flame x3", .35, .003))

    # thermal camera (MLX90640) on the roof, looking forward; FOV edges drawn
    P.append(box((.09, 0, .338), (.026, .036, .022), 'rgba=".08 .08 .1 1"'))
    P.append(cyl((.118, 0, .338), .012, .006, f'rgba="{rgba("Thermal MLX90640")}"', "0 1.5708 0"))
    if beams:
        for da, al, r in ((HFOV / 2, .55, .004), (-HFOV / 2, .55, .004), (0.0, .25, .003)):
            P.append(beam((.125, 0, .338), da, BEAM_LEN * 1.1, "Thermal MLX90640", al, r))

    # MQ-2 gas sensors (perforated cans)
    for gx, gy in ((.13, -.10), (-.15, .10)):
        P.append(cyl((gx, gy, .333), .02, .016, f'rgba="{rgba("MQ-2 gas x2")}"'))
        P.append(cyl((gx, gy, .35), .015, .002, 'rgba=".2 .2 .2 1"'))

    # low lidar puck on the rear deck + the sim's scan plane (a thin disc at LIDAR_Z)
    P.append(cyl((-.215, 0, .205), .035, .025, 'rgba=".2 .2 .24 1"'))
    if beams:
        for a in np.linspace(0, 2 * np.pi, 24, endpoint=False):     # radial scan rays
            P.append(beam((-.215, 0, LIDAR_Z), a, 0.75, "Scan plane (lidar rays)", .28, .003))

    # pan-servo turret: base fixed, everything above rotates by `turret`
    P.append(cyl((-.02, 0, .33), .04, .014, 'rgba=".25 .25 .3 1"'))
    P.append(f'<body pos="-.02 0 .36" euler="0 0 {turret}">'
             + cyl((0, 0, 0), .028, .012, f'rgba="{rgba("Nozzle + pan servo", 1)}"')
             + f'<geom {vis} type="capsule" fromto="0 0 .012 .19 0 .03" size=".012" '
               'rgba=".85 .88 .95 1"/>'
             + (f'<geom {vis} type="capsule" fromto=".19 0 .03 {BEAM_LEN} 0 .03" size=".02" '
                f'rgba="{rgba("Nozzle + pan servo", .3)}"/>' if beams else "")
             + "</body>")
    return (f'<body name="rover" pos="{x} {y} 0" euler="0 0 {yaw}">' + "".join(P) + "</body>")


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
                 props: list[dict] | None = None, wall_height: float = WALL_HEIGHT,
                 rooms: list[dict] | None = None) -> None:
        _require()
        super().__init__(walls=walls, width=width, height=height)  # analytic grid, replaced below
        self.props = [dict(q) for q in (props or [])]
        self.rooms = [dict(r) for r in (rooms or [])]
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
               area_per_prop: float = 9.0,
               room_kinds: tuple[str, ...] | None = None) -> MuJoCoWorld:
        """A fresh procedurally generated building, filled with clutter (denser = smaller
        `area_per_prop`)."""
        from .mapgen import generate_layout, generate_props
        rng = rng if rng is not None else np.random.default_rng(seed)
        width, height, walls, rooms = generate_layout(rng, room_kinds=room_kinds)   # typed rooms, all reachable
        props = generate_props(rng, width, height, walls, area_per_prop=area_per_prop,
                               rooms=rooms)
        return cls(walls=walls, width=width, height=height, props=props, rooms=rooms)

    def _geoms(self, pal: dict[str, tuple], canopy_blobs: bool = True,
               wall_h: float | None = None) -> list[str]:
        """Static solid + visual geoms for walls and props, coloured from palette `pal`."""
        def rgba(name: str, shade: float = 1.0) -> str:
            r, g, b, *a = pal[name]
            return f"{r * shade:.3f} {g * shade:.3f} {b * shade:.3f} {a[0] if a else 1}"

        g: list[str] = []
        wh = self.wall_height if wall_h is None else wall_h
        for x, y, w, h in self.walls:
            g.append(f'<geom type="box" group="{SOLID}" pos="{x + w / 2} {y + h / 2} '
                     f'{wh / 2}" size="{w / 2} {h / 2} {wh / 2}" '
                     f'rgba="{rgba("wall")}"/>')
        for q in self.props:
            kind, z = q["kind"], float(q.get("height", 0.8))
            if "r" in q:
                g.append(f'<geom type="cylinder" group="{SOLID}" pos="{q["x"]} {q["y"]} {z / 2}" '
                         f'size="{q["r"]} {z / 2}" rgba="{rgba(kind)}"/>')
                if kind == "tree" and canopy_blobs:  # visual-only canopy above the scan plane
                    c = float(q.get("canopy", 0.6))
                    for k, (dx, dy, dz, f) in enumerate(
                            ((0, 0, .6, 1.0), (.5, .2, .35, .65), (-.45, .3, .4, .6),
                             (.1, -.5, .3, .62), (-.2, .05, 1.0, .55))):
                        g.append(f'<geom type="sphere" group="{VISUAL}" contype="0" '
                                 f'conaffinity="0" pos="{q["x"] + dx * c} {q["y"] + dy * c} '
                                 f'{z + c * dz}" size="{c * f}" '
                                 f'rgba="{rgba("canopy", 0.85 + 0.12 * (k % 3))}"/>')
            else:
                g.append(f'<geom type="box" group="{SOLID}" pos="{q["x"]} {q["y"]} {z / 2}" '
                         f'euler="0 0 {q.get("yaw", 0.0)}" '
                         f'size="{q["w"] / 2} {q["h"] / 2} {z / 2}" rgba="{rgba(kind)}"/>')
        return g

    def _mjcf(self, theme: str = "day", rover: tuple | None = None, probe: bool = True,
              beams: bool = True) -> str:
        """Scene MJCF. `theme="day"` is the plain physics/viewer look; `"neon"` is the dark
        purple, glossy-floor look with an optional rover model at `rover=(x, y, yaw)`."""
        neon = theme == "neon"
        g = self._geoms(_NEON if neon else {k: v + (1,) for k, v in _RGBA.items()},
                        wall_h=min(self.wall_height, 1.1) if neon else None)
        cx, cy = self.width / 2, self.height / 2
        if neon:
            floors = []
            head = ('''
  <visual>
    <headlight ambient=".24 .22 .30" diffuse=".38 .38 .42" specular=".2 .2 .25"/>
    <quality shadowsize="4096" offsamples="8"/>
    <rgba haze=".07 .04 .16 1"/>
    <map haze="0.35" zfar="80"/>
  </visual>
  <asset>
    <texture type="skybox" builtin="gradient" rgb1=".16 .08 .34" rgb2=".02 .01 .06"
             width="512" height="512"/>
    <texture name="tiles" type="2d" builtin="checker" rgb1=".13 .065 .24" rgb2=".10 .05 .19"
             width="512" height="512" mark="edge" markrgb=".34 .22 .55"/>
    <material name="floor" texture="tiles" texuniform="true" texrepeat="1 1"
              reflectance=".38" specular=".6" shininess=".8"/>
    <material name="metal" rgba=".60 .60 .62 1" specular=".8" shininess=".7" reflectance=".05"/>
    <material name="tyre" rgba=".88 .88 .9 1" specular=".5" shininess=".6"/>
    <material name="glass" rgba=".3 .85 .85 .9" specular=".9" shininess=".9" reflectance=".12"/>
  </asset>''')
            light = (f'<light pos="{cx - 4} {cy - 6} 10" dir=".35 .5 -1" directional="true" '
                     'castshadow="true" diffuse=".85 .84 .9" specular=".5 .5 .6"/>'
                     f'<light pos="{cx + 3} {cy + 5} 6" dir="-.3 -.5 -1" castshadow="false" '
                     'diffuse=".25 .45 .55"/>')
            floor = (f'<geom name="floor" type="plane" group="{VISUAL}" contype="0" conaffinity="0" '
                     f'pos="{cx} {cy} 0" size="{cx + 25} {cy + 25} .1" material="floor"/>')
        else:
            floors = [f'<geom type="box" group="{VISUAL}" contype="0" conaffinity="0" '
                      f'pos="{r["x"] + r["w"] / 2} {r["y"] + r["h"] / 2} -0.01" '
                      f'size="{r["w"] / 2} {r["h"] / 2} 0.01" material="floor" '
                      f'rgba="{" ".join(f"{c:.3f}" for c in _FLOOR_RGBA.get(r["kind"], (.7, .7, .7)))} 1"/>'
                      for r in self.rooms]
            head = f'''
  <visual>
    <headlight ambient=".45 .45 .48" diffuse=".5 .5 .5" specular="0 0 0"/>
    <quality shadowsize="4096"/>
    <global azimuth="-60" elevation="-55"/>
    <rgba haze=".7 .78 .9 1"/>
  </visual>
  <asset>
    <texture type="skybox" builtin="gradient" rgb1=".55 .68 .85" rgb2=".95 .96 .98"
             width="256" height="256"/>
    <texture name="grid" type="2d" builtin="checker" rgb1=".93 .93 .93" rgb2=".86 .86 .86"
             width="128" height="128" mark="edge" markrgb=".7 .7 .7"/>
    <material name="floor" texture="grid" texrepeat="{max(self.width, 1) / 1.2:.1f} {max(self.height, 1) / 1.2:.1f}"
              reflectance=".08" specular=".1"/>
  </asset>'''
            light = (f'<light pos="{cx - self.width * .3} {cy - self.height * .3} 12" '
                     'dir=".3 .3 -1" castshadow="true" diffuse=".7 .68 .62" directional="true"/>')
            floor = (f'<geom name="floor" type="plane" group="{VISUAL}" contype="0" conaffinity="0" '
                     f'pos="{cx} {cy} -0.03" size="{cx + 1} {cy + 1} .1" rgba=".16 .17 .2 1"/>')
        nl = chr(10)
        rover_xml = _rover_mjcf(*rover, beams=beams) if rover is not None else ""
        probe_xml = f'''<body name="probe" pos="{cx} {cy} 100">
      <freejoint/>
      <geom name="probe_geom" type="cylinder" group="{PROBE}" size="{ROBOT_RADIUS}
            {ROBOT_HEIGHT / 2}" rgba="0 0 1 .3"/>
    </body>''' if probe else ""
        return f"""<mujoco model="firebot">
  <compiler angle="radian"/>
  <option gravity="0 0 0"/>{head}
  <worldbody>
    {light}
    {floor}
    {nl.join(floors)}
    {nl.join(g)}
    {rover_xml}
    {probe_xml}
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
                "walls": [list(w) for w in self.walls], "props": self.props,
                "rooms": self.rooms}

    def export_map(self, path: str) -> None:
        """Dump walls + props as JSON so other tools (e.g. the web console) can load the map."""
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=1)

    def export_mjcf(self, path: str, theme: str = "day", rover=None) -> None:
        """Write the scene as MJCF -- open it in `python -m mujoco.viewer --mjcf=<path>`.
        `theme="neon"` gives the dark glossy look (pass `rover=(x, y, yaw)` to include the
        rover model)."""
        with open(path, "w") as f:
            f.write(self._mjcf(theme, rover=rover if theme == "neon" else None,
                               probe=theme != "neon"))

    def _display_model(self, theme: str, rover, beams: bool = True):
        pose = rover if rover is not None else self.default_rover_pose()
        return (mujoco.MjModel.from_xml_string(self._mjcf(theme, rover=pose, probe=False,
                                                          beams=beams)), pose)

    def _clearance(self, x: float, y: float, n: int = 16) -> float:
        a = np.linspace(0, 2 * np.pi, n, endpoint=False)
        return float(self.rays(x, y, a, 6.0).min())

    def default_rover_pose(self) -> tuple[float, float, float]:
        """A deterministic, roomy spot (most free space around it) and heading to park the
        display rover."""
        rng = np.random.default_rng(len(self.walls) * 31 + len(self.props))
        cands = [self.random_free_point(rng, margin=0.6) for _ in range(60)]
        x, y = max(cands, key=lambda p: self._clearance(*p))
        return x, y, float(rng.uniform(-np.pi, np.pi))

    def view(self, theme: str = "neon", rover=None) -> None:  # pragma: no cover - needs a display
        """Open MuJoCo's interactive viewer on the styled scene (rover included)."""
        import mujoco.viewer
        model, _ = self._display_model(theme, rover)
        mujoco.viewer.launch(model, mujoco.MjData(model))

    def render3d(self, path: str, shot: str = "hero", rover=None, width: int = 1280,
                 height: int = 800, theme: str = "neon", beams: bool = True,
                 legend: bool = True) -> None:
        """Real 3-D render through MuJoCo's own renderer (needs `MUJOCO_GL=egl|osmesa` when
        headless). The rover carries every sensor at its simulated mounting and angle, with
        beams / fields of view drawn in colour (`beams=False` hides them).

        Shots: `"hero"` is a close three-quarter view of the rover, `"sensors"` looks straight
        down with the rover facing up the image (best for checking placements), `"overview"`
        looks over the whole building. `rover=(x, y, yaw[, turret])` sets the pose; a legend is
        added when Pillow is installed and `legend=True`.
        """
        from .render import _write_png
        model, pose = self._display_model(theme, rover, beams)
        model.vis.global_.offwidth, model.vis.global_.offheight = width, height
        data = mujoco.MjData(model)
        mujoco.mj_forward(model, data)
        cam = mujoco.MjvCamera()
        cam.type = mujoco.mjtCamera.mjCAMERA_FREE
        x, y, yaw = pose[:3]
        if shot == "overview":
            cam.lookat[:] = [self.width / 2, self.height / 2 - 0.5, 0.0]
            cam.distance = max(self.width, self.height) * 1.25
            cam.azimuth, cam.elevation = 90.0, -58.0
        elif shot == "sensors":
            cam.lookat[:] = [x + np.cos(yaw) * 0.55, y + np.sin(yaw) * 0.55, 0.0]
            cam.distance, cam.elevation = 3.3, -82.0
            cam.azimuth = float(np.degrees(yaw))            # rover faces up the image
        else:
            cam.lookat[:] = [x + np.cos(yaw) * 0.2, y + np.sin(yaw) * 0.2, 0.2]
            cam.distance, cam.elevation = 2.0, -26.0
            # pick the viewing azimuth whose line back to the camera is clear of walls/props,
            # preferring a front three-quarter view (camera ahead-left of the rover)
            def score(d: int) -> tuple[float, float]:
                off = (d - 180.0 - np.degrees(yaw) - 40.0 + 180.0) % 360.0 - 180.0
                return (min(self.ray(x, y, np.radians(d - 180.0), 4.0), 2.2), -abs(off))
            cam.azimuth = float(max(range(0, 360, 15), key=score))
        opt = mujoco.MjvOption()
        opt.geomgroup[:] = 0
        opt.geomgroup[[SOLID, VISUAL]] = 1
        with mujoco.Renderer(model, height, width) as r:
            r.update_scene(data, camera=cam, scene_option=opt)
            img = r.render()
        if legend and beams and shot != "overview":
            img = _add_legend(img)
        _write_png(path, img)

    def render(self, path: str, px_per_m: int = 60, supersample: int = 2) -> None:
        """Top-down PNG of the scene (pure numpy, headless): textured room floors, cast
        shadows, extruded walls and detailed props. See `firebot.sim.render`."""
        from .render import render_world
        render_world(self, path, px_per_m=px_per_m, supersample=supersample)

    # ---- lifecycle (no global client in MuJoCo; kept so FireEnv can release worlds) -------
    def close(self) -> None:
        pass

    def __getstate__(self) -> dict:  # MjModel/MjData aren't picklable: ship the recipe instead
        return {"walls": self.walls, "width": self.width, "height": self.height,
                "props": self.props, "wall_height": self.wall_height, "rooms": self.rooms}

    def __setstate__(self, s: dict) -> None:
        self.__init__(**s)


def _add_legend(img: np.ndarray) -> np.ndarray:
    """Overlay the sensor colour key (needs Pillow; silently skipped without it)."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:  # pragma: no cover - optional
        return img
    im = Image.fromarray(img).convert("RGBA")
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    try:
        font = ImageFont.load_default(size=max(13, im.size[1] // 50))
    except TypeError:  # older Pillow
        font = ImageFont.load_default()
    lh = max(20, im.size[1] // 34)
    w = int(im.size[0] * 0.42)
    x0, y0 = 14, 14
    d.rounded_rectangle((x0, y0, x0 + w, y0 + lh * (len(SENSOR_LEGEND) + 1) + 8), radius=10,
                        fill=(10, 6, 24, 190))
    d.text((x0 + 12, y0 + 6), "Sensor layout (+x = forward)", fill=(255, 255, 255, 255),
           font=font)
    for k, (name, rgb, where) in enumerate(SENSOR_LEGEND, start=1):
        yy = y0 + 6 + lh * k
        d.rounded_rectangle((x0 + 12, yy + 3, x0 + 30, yy + 17), radius=3,
                            fill=tuple(int(c * 255) for c in rgb) + (255,))
        d.text((x0 + 38, yy), f"{name}: {where}", fill=(230, 230, 240, 255), font=font)
    return np.asarray(Image.alpha_composite(im, ov).convert("RGB"))
