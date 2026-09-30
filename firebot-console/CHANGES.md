# Console changelog

Newest first. Commit messages carry the detail; this is the readable summary.

## Voice calibration
- Simulator > Voice > **Calibrate my voice**: record each command ~5 times, train a personal classifier
  head in seconds, kept only if it beats the default on held-out clips. Used automatically per operator
  (UI selection or speaker ID); everyone else keeps the default model. Reset to default at any time.
- Backend: `backend/calibration.py`, `firebot.voice_intent.personalize` (L2-SP fine-tune of the head),
  `IntentClassifier.embed_array` and a per-user `head` override; `/api/transcribe` takes an optional `user`.
- Recordings are stored in `data/calibration/` (gitignored).

## MuJoCo tab
- New page: a live 3-D episode from the MuJoCo-backed sim, streamed over `/ws/mujoco` and drawn
  with three.js. Seed and controller pickers, speed, pause, orbit / top-down / follow cameras,
  lidar rays and planned-path toggles, and a side panel with state, fire %, tank, collisions, pump.
- **Log this run** saves the episode to PostgreSQL (`mujoco-sim` sessions) so it shows in History
  and on Live while playing. Frames use the real robot's sensor names plus a 36-beam `lidar` list.
- Backend: `backend/mujoco_stream.py`, `firebot.sim.stream.EpisodeStream`,
  `GET /api/mujoco/status`. Needs the `mujoco` extra; the tab says so if it is missing.
- Simulator-side: `ScanController` and `FrontierController` (lidar avoidance and exploration),
  `firebot-sim --world mujoco --controller ...`. The lidar is sim-only.
- Bundle is about 1.1 MB with three.js; lazy-load the tab if that matters for a deploy.

## Fix: Live thermal view stuck on "Waiting for a thermal frame"
`/ws/telemetry` only ever sent the newest frame, and the brain stores a thermal grid on only every
10th frame, so the grid arrived only if a poll happened to land on such a frame. The WebSocket now
also fetches the newest stored grid when the latest frame has none, and sends it once
(`thermal_seq`). No schema or frontend change. See `docs/DATABASE.md` ("Thermal grids are sparse").

## Simulator: Sensors, Planner and Voice tabs redesigned
- Sensors: larger thermal view, a top-down view of the ultrasonic rays and flame sensors, gas and
  flame meters.
- Planner: plain-English status, straight-line distance, search-tree size, success-rate ring.
- Voice: mic hero with a status line, last-command card, collapsible tappable phrase list, history.
- The three tabs moved to `components/sim/`; the phrase reference moved to `lib/commandHelp.js`.

## Live Ops redesign
- Thermal view is the centrepiece (smoothed, crosshair on the hottest pixel, "Held from Ns ago").
- Tank, gas and fire-fix rings; analog joystick that re-sends while held (keeps the brain's 0.5 s
  dead-man timer fed) and sends an explicit stop on release.
- Backend: `DRIVE` also accepts analog `v` and `w` (clamped, non-finite rejected).
- Behaviour changes: left and right in `_DRIVE_VECTORS` were swapped so a right turn turns the sim
  robot right (positive `w` is counter-clockwise). The reverse button and arrow key were removed:
  there is no reverse gear, so they always returned 501.
- The camera is still placeholder footage and is labelled as such.

## History: replay, summary and fault list
Top-down run replay with a scrubber and speed control, a plain-English summary from
`/api/runs/{id}/summary`, and faults from `/api/runs/{id}/anomalies` that jump the replay to the
moment they happened. The replay draws the default room's walls as a reference outline.

## Earlier work
Browser notifications (link loss, low tank, fire located, pump on), the ironbow re-theme and slim
rail navigation, manual control through the brain's loopback bridge, real-telemetry rewiring to the
Postgres schema, speaker identification, the offline voice-intent classifier, and the Azure
low-cost deploy scripts.

## Simulator drop (original)

### Backend (Python) -- `src/firebot/`

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

### Frontend (React) -- `firebot-console/frontend/`

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

