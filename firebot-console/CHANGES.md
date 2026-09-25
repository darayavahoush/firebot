# Changes in this drop

Generated locally from a clone of `darayavahoush/firebot`; nothing has been pushed. Review with
`git status` / `git diff`, then commit and push yourself.

## Backend (Python) -- `src/firebot/`

- **`sim/mapgen.py`** (new) -- procedural BSP building generator: a bigger, randomly laid-out
  multi-room floor plan (with doorways and a few furniture props) every call, instead of the
  fixed 12x8 single-pillar room.
- **`sim/world.py`** -- added `World.random(seed=...)`, built on `mapgen.generate_building`.
  `World()`'s default behaviour (the fixed room every existing test relies on) is untouched --
  `width`/`height` are now instance attributes but default to the old module constants.
- **`planning/ompl_planner.py`** (new) -- `OMPLPlanner`, a real OMPL-backed planner
  (InformedRRTstar via `pip install ompl`) implementing the same `Planner` protocol as
  `RRTStar`, reusing `CostMap` for collision checking. Import is deferred so the rest of the
  package works without OMPL installed.
- **`planning/rrtstar.py`** -- samples within the *world's own* bounds (`world.width/height`)
  instead of the fixed module constants, so it works correctly against `World.random()` maps.
- **`planning/controller.py`** -- `PlanningController` now takes a `planner_cls` param
  (defaults to `RRTStar`); pass `firebot.planning.OMPLPlanner` to route through real OMPL.
- **`planning/__init__.py`** -- exports `OMPLPlanner`/`OMPLNotInstalled` when `ompl` is
  installed, no-ops otherwise.
- **`pyproject.toml`** -- added an `ompl` optional-dependency group.
- **`tests/test_mapgen.py`** (new) -- 5 tests covering `World.random`, RRT* against random
  bounds, and `OMPLPlanner` (skipped automatically if `ompl` isn't installed).

Full suite: `104 passed, 3 skipped` (the 3 skips are pre-existing, unrelated to this change).
`ruff check .` clean.

## Frontend (React) -- `firebot-console/frontend/`

New "Simulator" tab (`TopBar.jsx` / `App.jsx`) -- a self-contained, browser-only demo that
doesn't need the backend running:

- **`src/lib/simEngine.js`** -- procedural map generator (JS port of `mapgen.py`), mock sensors
  mirroring the real hardware constants in `sensing.py` (ultrasonic angles, flame triad, MLX90640
  24x32 thermal frame, gas sensors), an EIF fire-source estimator, an RRT* planner + pure-pursuit
  path follower, and a voice/text command grammar ported from `command/parser.py`'s regex rules.
- **`src/lib/simController.js`** -- the EXPLORE -> TRACK -> PLAN -> SPRAY -> SAFE state machine,
  plus STOP / GOTO / EXTINGUISH / RETURN_HOME / STATUS command handling, stuck-recovery, and a
  stall watchdog for hard-to-reach fire placements.
- **`src/components/SimCanvas.jsx`** -- live canvas rendering: building, robot, fire (ground
  truth + estimate/uncertainty ellipse), RRT* search tree, planned path.
- **`src/components/ThermalFrame.jsx`** -- mock thermal-camera heatmap.
- **`src/pages/Simulator.jsx`** -- the page itself: scenario controls (new building, pause,
  speed), Telemetry / Sensors / Planner / Voice tabs, a mic button (Web Speech API) with a text
  fallback for browsers without speech recognition, and an event log.

Verified: `npm run build` succeeds; a jsdom mount + interaction test (new building, pause/resume,
every tab, text command, STOP) runs with no thrown errors. The simulation engine itself was
stress-tested standalone in Node across 30 random seeds -- median time-to-extinguish ~28s,
near-zero collisions.

Note on OMPL in the browser: OMPL is a C++/Python library with no browser build, so the in-page
planner runs the same informed-RRT* *algorithm* in plain JS rather than calling real OMPL. The
Python backend's `OMPLPlanner` (above) is the one that actually uses OMPL.

## To ship it

```
git add -A
git commit -m "Bigger procedural maps, mock sensors, voice input, OMPL planner"
git push
cd firebot-console/frontend && npm install   # package-lock.json is untouched, nothing new to add
```
