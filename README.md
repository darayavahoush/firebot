# NIRVANA

> **The fire ends here.**

NIRVANA is an autonomous firefighting robot: physics-backed MuJoCo 3-D simulation across procedural
8-room environments with volumetric particle systems, multimodal cross-attention deep reinforcement
learning (MM-FusionRL), EIF sensor fusion, lidar exploration and motion planning, a fire-event database
and a web console.

## Setup (macOS)
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q && ruff check .
```

## Quick start
```bash
firebot-sim --episodes 20   # runs the baseline, writes firebot.db + training.db

firebot-plan --episodes 30   # RRT* planning controller vs. the rule baseline

# MuJoCo 3-D world + multimodal controllers (needs the `mujoco` extra: pip install -e ".[pc,mujoco]")
firebot-sim --episodes 10 --world mujoco --controller mm_fusion   # rule | scan | frontier | mm_fusion
# voice (needs the `speech` extra + a Vosk model directory)
firebot-listen --model ~/models/vosk-model-small-en-us-0.15
firebot-cmd --script "go to the east side; put out the fire; status"   # operator commands

# PC brain + thin robot (needs the `pc` extra for PostgreSQL: pip install -e ".[pc]")
export FIREBOT_TOKEN=change-me
firebot-brain --host 0.0.0.0 --db postgresql://user:pw@localhost/firebot   # on the PC; type commands here
firebot-brain ... --voice-model ~/models/vosk-model-small-en-us-0.15   # + speak to the PC (needs the `speech` extra)
firebot-brain ... --voice-model ... --speaker-id   # + label each voice command with who said it
                                                   #   (enrol first: python enroll_speaker.py --speaker <name>)
firebot-pi --sim --host <pc-ip>          # on the robot (--sim = simulated robot; real drivers: item 8)

# DRL (needs the `drl` extra: pip install -e ".[dev,drl]")
firebot-train --timesteps 200000 --n-envs 8 --out runs/ppo   # PPO via Stable-Baselines3
firebot-eval --model runs/ppo/model_final.zip --episodes 30  # vs. the rule baseline

# Curriculum: one PPO model trained through 3 increasingly hard stages (fixed room ->
# fixed room with fire further away -> a fresh procedurally-generated building every
# episode), see src/firebot/drl/curriculum.py's docstring for the stage-by-stage detail.
firebot-train-curriculum --timesteps-per-stage 100000 --n-envs 8 --out runs/curriculum
firebot-eval --model runs/curriculum/model_final.zip --episodes 30 --train-db training.db
```

## Research: MM-FusionRL
A complete scientific paper formulation and benchmark suite is provided in [`docs/RESEARCH_PAPER.md`](docs/RESEARCH_PAPER.md):
- **Title**: *MM-FusionRL: Multimodal Cross-Attention Deep Reinforcement Learning with Information-Theoretic Active Sensing for Autonomous Firefighting Robots*
- **Target Venues**: IEEE ICRA / IROS / RA-L.
- **Key Contributions**:
  1. **Cross-Attention Multi-Sensor Encoder**: Dynamically tokenizes and weights 36-beam Lidar, $32 \times 24$ radiometric thermal arrays, chemical $MQ\text{-}2$ gas diffusion differentials, ultrasonic acoustic boundaries, and wheel odometry.
  2. **Information-Theoretic Active Triangulation Reward**: Rewards policy trajectories proportional to the reduction of Bayesian covariance trace ($\mathcal{R}_{\text{info}} \propto \Delta \text{Tr}(P)$), actively executing lateral baseline excitation to break collinear unobservability.
  3. **Neural-Bayesian Adaptive Covariance Head**: Predicts dynamic measurement noise covariance matrices ($\mathbf{R}_t$) for adaptive Kalman/EIF gating under sensory degradation.

## Web console
A React + FastAPI console sits on top of the brain: **Live** (thermal view, rings, joystick, pump
and nozzle), **Simulator** (a browser-only demo), **MuJoCo** (a live 3-D episode from the
physics-backed sim, drawn in the browser with three.js; optionally logged to History),
**History** (run replay, plain-English summary, fault list) and **About**. Two terminals:
```bash
cd firebot-console/backend  && ./run.sh   # FastAPI bridge + simulated robot + firebot-brain
cd firebot-console/frontend && ./run.sh   # Vite dev server on http://localhost:5173
```
Full setup, configuration and troubleshooting: [`firebot-console/README.md`](firebot-console/README.md).

### MuJoCo tab
Install the extra first (`pip install -e ".[pc,mujoco]"`), start both terminals above, open
http://localhost:5173 and pick **MuJoCo**. Choose a map seed and a controller (**Multimodal DRL Fusion**,
**Frontier Exploration**, **Lidar Scan Avoidance**, or **Rule Baseline**), press **Start Simulation**,
and watch the rover explore and suppress the fire.
- **Procedural Environments**: 8 domain-specific rooms (Datacenter Server Hall, Hazmat Lab, Control Room, Storage, Workshop, Atrium, Office) with 3D props (server racks, generators, gas cylinders, pallets, crates, consoles).
- **Volumetric Particles**: Real-time GPU particle simulation for turbulent smoke plume dispersion, high-velocity thermal fire embers, and extinguisher water mist.
- **Camera Modes**: Interactive Orbit, Third-Person Chase (`follow`), First-Person FPV Rover Camera (`fpv`), and Tactical Top-Down (`top`).
- **Telemetry HUD**: Live Bayesian EIF covariance ellipse overlay ($\hat{x}, \hat{y}, \sigma$), gas concentration, thermal peak intensity, 36-beam Lidar rays, and planned frontier paths.
- **Log this run**: Persists the episode directly to PostgreSQL so it shows up in History (and on Live while it plays).

Outside the console, the same world has an interactive viewer and renderers. On macOS the viewer
needs `mjpython` (installed with `mujoco`), not plain `python`:
```bash
mjpython -c "from firebot.sim.mujoco_world import MuJoCoWorld; MuJoCoWorld.random(seed=3).view()"
python -c "from firebot.sim.mujoco_world import MuJoCoWorld; MuJoCoWorld.random(seed=3).render3d('out.png', 'hero')"   # also 'sensors', 'overview'
```

## Configuration
| Variable | Used by | Purpose |
|---|---|---|
| `FIREBOT_TOKEN` | brain, Pi, console | Shared secret for the robot link and the brain's loopback command bridge |
| `FIREBOT_DB` | brain, console | PostgreSQL DSN. Console default: `postgresql://firebot:firebot@localhost:5432/firebot` |
| `FIREBOT_BRAIN_CMD_URL` | console | Brain's manual-control bridge (default `http://127.0.0.1:8766`) |
| `GROQ_API_KEY` | console | Hosted Whisper fallback for `/api/transcribe` |
| `FIREBOT_SLM_CMD` | brain, console | Optional local-model wrapper (intent fallback, `?narrate_text=true` summaries) |
| `FIREBOT_SPEAKER_ID`, `_THRESHOLD`, `_MARGIN`, `_VOICEPRINT_DIR` | console | Speaker identification (on by default; `0` disables) |
| `FIREBOT_VOSK_MODEL`, `FIREBOT_VAD`, `FIREBOT_VAD_THRESHOLD` | console | Offline Vosk transcription and the Silero VAD gate |
| `FIREBOT_VOICE_INTENT_*` | console | Optional trained local intent classifier, see `src/firebot/voice_intent/README.md` |
| `FIREBOT_CORS_ORIGINS`, `FIREBOT_WEB_DIR` | console | Allowed dev origins; directory of the built frontend to serve (Azure image) |

`psql` does not read `FIREBOT_DB`. Use `psql "$FIREBOT_DB"`; if it is unset, psql falls back to a
database named after your macOS user and fails with `database "<you>" does not exist`.

## Layout
- `src/firebot/db/` operational DB (`Store`), training DB (`TrainingStore`), migrations, device registry
- `src/firebot/fusion/` bearing-only Extended Information Filter
- `src/firebot/sim/` world, sensor models, `FireEnv` (Gymnasium-style), rule-based baseline, `firebot-sim` CLI;
  `mujoco_world.py` (3-D MJCF world, `mj_ray` lidar, contact queries), `mapgen.py` (procedural 8-room building generator),
  `scan_controller.py` / `frontier_controller.py` (lidar avoidance and frontier exploration),
  `stream.py` (`EpisodeStream`: steps an episode with live `mm_fusion`, `frontier`, `scan`, `rule` controllers for the console)
- `src/firebot/drl/` `FireGymEnv` (real `gymnasium.Env` wrapper for SB3), `firebot-train` (PPO),
  `firebot-eval` (compares a checkpoint against the rule baseline via `v_run_summary`),
  `drl_controller.py` (`MultimodalController`, `DRLController`: multimodal cross-attention fusion policy),
  `curriculum.py` (3-stage progressive difficulty trainer)
- `src/firebot/planning/` numpy RRT* (`RRTStar`, `Planner` interface), `PlanningController`
  (plans to a spray stand-off point, pure-pursuit follow), `firebot-plan` benchmark
- `src/firebot/command/` rule-based command interpreter (+ optional SLM fallback), intent schema/
  validator, executor, `firebot-cmd` CLI
- `src/firebot/speech/` offline speech input: Vosk recogniser, restricted grammar, STOP backstop,
  `firebot-listen` CLI
- `src/firebot/link/` robot<->PC link: Pi agent (stdlib only), wire protocol, brain, network server,
  PostgreSQL telemetry sink, simulated hardware, voice hookup (`voice.py`); `firebot-brain`, `firebot-pi`
- `src/firebot/fusion/` also holds `pose_ekf.py` (pose filter) and `anomaly.py` (explainable
  telemetry findings and run summaries used by the console's History page)
- `src/firebot/speech/` also holds `speaker_id.py` (who spoke, via SpeechBrain ECAPA) and `vad.py`
- `src/firebot/voice_intent/` trained offline voice-intent classifier and router (own README)
- `firebot-console/` the web console: `frontend/` (React + Vite + Tailwind + three.js), `backend/server.py`
  (FastAPI) and `backend/mujoco_stream.py` (the MuJoCo tab's WebSocket), `deploy/` (Azure scripts)
- `src/firebot/perception.py` sensor frame -> observation (fusion), shared by the sim and the brain
- `web/firebot-sim.html` standalone browser visualiser (open in any browser)
- `docs/RESEARCH_PAPER.md` academic research paper on MM-FusionRL (IEEE ICRA / IROS / RA-L target)
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md` design, roadmap, schema reference (the single source;
  `firebot-console/docs/` only points here)

## Workflow
Branch from `main` (`feat/...`, `fix/...`), open a PR, CI must pass. Conventional commit messages
(`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Never commit `*.db` files.

> Naming: the product is **NIRVANA**. The Python package, CLI commands (`firebot-*`), environment
> variables (`FIREBOT_*`) and database names keep the original `firebot` identifier so existing
> installs, configs and stored runs keep working.
