# NIRVANA Console

The web console: a React frontend talking to a small FastAPI bridge, which forwards live commands
to `firebot-brain` and reads telemetry and run history from PostgreSQL.

| Page | What it is | Needs the backend? |
|---|---|---|
| **Live** | Real robot: MLX90640 thermal view, tank / gas / fire-fix rings, analog joystick, pump toggle, nozzle slider, command log, alerts | yes |
| **Simulator** | Self-contained browser demo: procedural map, mock sensors, EIF estimator, RRT* planner, voice and text commands | no (voice transcription fallback aside) |
| **MuJoCo** | Live 3-D episode from the physics-backed sim (three.js): 8 procedural room domains, volumetric GPU particles, controllers (Multimodal DRL Fusion, Frontier, Scan, Rule), 4 camera modes (orbit / top / follow / fpv), lidar rays, EIF belief overlay, planned path, optional logging to History | yes, and `pip install -e ".[mujoco]"` |
| **History** | Past runs: replay with a scrubber, plain-English summary, fault list, sensor chart | yes |
| **About** | Technical manual: searchable reference covering state estimation, planning, MuJoCo 3D engine, DRL & multimodal fusion, and the MM-FusionRL research paper | no |

## One-time setup
```bash
# from the repo root
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[pc]"                                   # firebot-brain/firebot-pi + psycopg
pip install -r firebot-console/backend/requirements.txt  # the FastAPI bridge + asyncpg

# Postgres is assumed to be running already (e.g. `brew services start postgresql@16`).
createuser -s firebot && createdb -O firebot firebot
```

## Running it: 2 tabs
**Tab 1, backend** (`firebot-console/backend/`, venv active): `./run.sh`
Starts the FastAPI bridge (`:8000`), a simulated robot (`firebot-pi --sim`) and `firebot-brain`
(with `--auto`, so it starts extinguishing on its own). The brain owns this terminal's stdin, so
you can also type commands here ("put out the fire", "go to the east side", "status", "stop").
Ctrl-C stops all three.

**Tab 2, frontend** (`firebot-console/frontend/`): `./run.sh`
Installs `node_modules` on first run, then serves `http://localhost:5173`.

The Simulator page works with neither running.

## Live page
- **Thermal view:** the real 32x24 grid, smoothed, with a crosshair on the hottest pixel. The
  brain stores a grid only every Nth frame (`--thermal-every`, default 10), so the view holds the
  last grid and shows "Held from Ns ago" between updates.
- **Rings:** tank, gas and fire-fix certainty (fire-fix shows only when a frame carries `est_sigma`).
- **Drive:** analog joystick, active in **Manual** mode only. It re-sends while held so the brain's
  0.5 s dead-man timer never trips, and sends an explicit stop on release. There is no reverse
  gear, so the lower half of the stick stops the robot. Arrow keys drive at half speed, Space stops.
- **Turn direction:** positive `w` is counter-clockwise (left), as in the sim. If a real drive
  board turns the other way, fix it in the Pi driver, not in the console.
- **Camera:** placeholder footage. No camera stream is wired to the robot yet.
- **Alerts:** optional browser notifications for link loss, low tank, fire located and pump on.

## History page
Click a run to get:
- **Replay:** top-down map with the path fading purple to yellow, the thermal frame nearest the
  scrubber, a ring for the fire estimate that tightens as certainty improves, and the pump cone.
  Play/pause and 1x / 4x / 16x. The walls are the default room as a reference outline, not a
  recording of the real room.
- **Faults:** ticks on the scrubber and a clickable list (stuck or spiking sensors, pump not
  draining the tank, leaks, slow compute, link dropouts).
- **What happened:** the summary text. Add `?narrate_text=true` to the summary endpoint (with
  `FIREBOT_SLM_CMD` set) for a local-model rewording; numbers are verified against the facts.

## Voice calibration (personal voice model)
On the Simulator page's Voice tab, **Calibrate my voice** opens a guided panel: enter a name, say each
command about 5 times (2.6 s per clip), then **Train my model**. The backend embeds the clips with the
frozen Whisper encoder and fine-tunes only the small classifier head (seconds, CPU), keeping the result
only if it beats the default model on clips held out from training. The personal model is saved as
`checkpoints/users/<name>.pt` and used automatically for that operator (chosen in the UI, or recognised
by the speaker-ID voiceprints); everyone else keeps the default model. **Reset to default** deletes it.
- Needs a current-format checkpoint from `firebot.voice_intent` (not the old 7-label one) and the `voice` extra.
- Recordings live in `data/calibration/<name>/` on the server (gitignored): they are voice data, don't commit them.
- There are no user accounts, so anyone who can reach the console can calibrate or reset any operator name.

## MuJoCo page
Runs the MuJoCo-backed 3-D simulator on the backend and streams it live to the browser via WebSocket.
- **Controllers**:
  - `Multimodal DRL Fusion` (`mm_fusion`): Deep actor-critic cross-attention policy fusing 36-beam Lidar, radiometric thermal array, 4x ultrasonic sonar, and MQ-2 chemical gas diffusion gradients with Bayesian EIF estimation.
  - `Frontier Exploration` (`frontier`): Autonomous occupancy grid SLAM and frontier point routing with pure-pursuit path execution.
  - `Lidar Scan Avoidance` (`scan`): 360° obstacle clearance scanning with wandering open-corridor search and thermal takeover.
  - `Rule-Based Baseline` (`rule`): Direct observation reactive policy relying strictly on 4 ultrasonic range beams.
- **Procedural Environments**: 8 domain-specific semantic rooms (Datacenter Server Hall, Hazmat Lab, Control Room, High-Density Storage, Workshop, Central Atrium, Executive Office) populated with 3D obstacle props (dual-bay server racks, emergency generators, pressurized gas cylinders, cargo pallets, crates, steel shelving, control consoles, benches, structural pillars).
- **Volumetric GPU Particles**: Real-time particle simulation for turbulent smoke plume dispersion, high-velocity thermal fire embers, water mist extinguisher spray, and ground thermal heat dissipation footprints.
- **Multi-Camera Modes**: Interactive Orbit, Third-Person Chase (`follow`), First-Person FPV Rover Camera (`fpv`), and Tactical Top-Down (`top`).
- **Telemetry HUD**: Live Bayesian EIF Covariance Ellipse overlay (x̂, ŷ, σ), gas concentration, thermal peak intensity, 36-beam Lidar rays, and planned frontier paths.
- **Playback Controls**: Speed multipliers (0.5x, 1x, 2x, 4x, 8x), pause/resume, random seed generator.
- **Log this run**: Saves the episode as a `mujoco-sim` session in PostgreSQL, enabling scrubbed replay in History and live mirroring on the Live tab.
- It shows a simulated robot on a generated map. It is not connected to the real robot, and the
  lidar it uses does not exist on the hardware.
- If the tab says the backend can't be reached or `mujoco` isn't installed, see Troubleshooting.

## Simulator page
Controls: new building, move the fire, pause, 0.5x to 4x, planner-tree and camera-view toggles,
and a Stop button. The side panel has four tabs:
- **Telemetry:** mission metrics, tank / battery / fire-out rings, EIF fire estimate, robot pose.
- **Sensors:** thermal camera, a top-down view of the four ultrasonic rays and three flame
  sensors around the robot, and gas / flame meters.
- **Planner:** what the robot is heading for, waypoints, straight-line distance, search-tree size,
  routes found and failed, and a success-rate ring.
- **Voice:** mic (Web Speech API), or record-and-transcribe on the server for browsers without it
  (Opera, Brave); a typed command box with autocomplete; the last command and whether it was
  understood; tappable example phrases; history.

## API
| Route | Purpose |
|---|---|
| `GET /api/runs`, `GET /api/runs/{id}` | Run list; all frames of a run |
| `GET /api/runs/{id}/anomalies` | Explainable fault findings |
| `GET /api/runs/{id}/summary` | Plain-English summary and its facts |
| `POST /api/command` | `DRIVE` (`dir`/`speed`, or analog `v` 0..1 and `w` -1..1, both finite), `PUMP`, `NOZZLE` (clamped to ±45°), `SET_MODE` (UI-local) |
| `POST /api/command/estop` | Emergency stop via the brain bridge |
| `GET /api/voice/status`, `POST /api/transcribe` | Speech backend in use; transcription (plus speaker ID) |
| `GET /api/mujoco/status` | Whether `mujoco` is installed, and the controller names |
| `GET/POST/DELETE /api/voice/calibrate/{status,clip,train,model}` | Per-user voice calibration (`?user=`) |
| `WS /ws/mujoco` | One streamed episode (`?seed=&controller=&speed=&log=`): `scene`, `frame`s, `end` |
| `WS /ws/telemetry` | Live `frame` and `command` messages, polled from Postgres every 0.4 s |

`/ws/telemetry` sends the newest frame. When that frame has no thermal grid, it attaches the
newest stored one once (as `thermal_seq`), so the Live view is never left waiting on frame timing.
Drive commands return 409 if no robot is connected and 501 for reverse.

## Configuration
All variables are listed in the repo-root `README.md`. The ones you are most likely to touch:
`FIREBOT_DB`, `FIREBOT_TOKEN`, `GROQ_API_KEY`, and the `FIREBOT_SPEAKER_*` / `FIREBOT_VOICE_INTENT_*`
groups. `FIREBOT_DB` is read by both `run.sh` and `server.py`.

## Troubleshooting
- **Live says "Waiting for a thermal frame":** update to a build with the WebSocket fix above and
  restart the backend. If it persists, check the DB actually holds grids:
  `psql "$FIREBOT_DB" -c "SELECT count(*) AS frames, count(thermal) AS with_thermal FROM frames;"`.
  `with_thermal = 0` means the brain isn't storing them (`--thermal-every 0`) or the Pi sends no grid.
- **`psql: database "<you>" does not exist`:** `$FIREBOT_DB` is empty. Use
  `psql postgresql://firebot:firebot@localhost:5432/firebot`.
- **`zsh: command not found: python`:** use `python3`, or activate `.venv`.
- **Manual drive does nothing:** the mode must be Manual, and a robot must be connected (409 otherwise).
- **MuJoCo tab shows "Not Found":** the backend on :8000 is older than the MuJoCo routes (`run.sh`
  does not auto-reload). Stop it (`pkill -f "uvicorn server:app"`), check `lsof -nP -iTCP:8000
  -sTCP:LISTEN` shows nothing, then run `./run.sh` again. `curl localhost:8000/api/mujoco/status`
  should return `"available":true`.
- **MuJoCo tab says `mujoco` isn't installed:** `pip install -e ".[pc,mujoco]"` in the venv the
  backend runs from.
- **Vite warns about chunks over 500 kB:** harmless (three.js makes the bundle about 1.1 MB).

## Azure (low-cost, one person)
`deploy/azure-deploy.sh` (run from the repo root after `az login`) creates a Container App that
scales to zero and a small Postgres, and saves names to `.azure-firebot.env` (gitignored).
`deploy/nirvana-up.sh` starts the database and opens the site; `deploy/nirvana-down.sh` stops it so
you only pay for storage. Deleting the Postgres server is the only way to stop its billing fully.

## Layout
- `backend/calibration.py`: per-user voice calibration API; `backend/server.py`: the FastAPI bridge (routes above); `backend/mujoco_stream.py`: the MuJoCo tab's
  WebSocket and run logging
- `frontend/src/pages/`: `LiveOps`, `Simulator`, `MuJoCo`, `History`, `About`
- `frontend/src/components/`: shared pieces (`ThermalHero`, `Ring`, `Joystick`, `RunReplay`,
  `RunInsights`, `RunChart`, ...); `components/sim/` holds the Simulator's Sensors, Planner and Voice tabs
- `frontend/src/components/mujoco/MujocoScene.js`: the three.js scene (walls, props, rover, rays, path)
- `frontend/src/lib/`: `simEngine.js` / `simController.js` (the browser-only simulator, ported from
  the Python backend), `commandHelp.js` (voice phrase reference, keep in sync with `simEngine.js`
  `parseIntent()` and `command/parser.py`)
- `deploy/`: Azure scripts and the container entrypoint
- Architecture and schema: repo-root `docs/`
