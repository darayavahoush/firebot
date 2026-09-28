# NIRVANA

> **The fire ends here.**

NIRVANA is an autonomous firefighting robot: simulation, EIF sensor fusion, motion planning, fire-event database.

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

## Web console
A React + FastAPI console sits on top of the brain: **Live** (thermal view, rings, joystick, pump
and nozzle), **Simulator** (a browser-only demo), **History** (run replay, plain-English summary,
fault list) and **About**. Two terminals:
```bash
cd firebot-console/backend  && ./run.sh   # FastAPI bridge + simulated robot + firebot-brain
cd firebot-console/frontend && ./run.sh   # Vite dev server on http://localhost:5173
```
Full setup, configuration and troubleshooting: [`firebot-console/README.md`](firebot-console/README.md).

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
- `src/firebot/sim/` world, sensor models, `FireEnv` (Gymnasium-style), rule-based baseline, `firebot-sim` CLI
- `src/firebot/drl/` `FireGymEnv` (real `gymnasium.Env` wrapper for SB3), `firebot-train` (PPO),
  `firebot-eval` (compares a checkpoint against the rule baseline via `v_run_summary`)
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
- `firebot-console/` the web console: `frontend/` (React + Vite + Tailwind), `backend/server.py`
  (FastAPI), `deploy/` (Azure scripts)
- `src/firebot/perception.py` sensor frame -> observation (fusion), shared by the sim and the brain
- `web/firebot-sim.html` standalone browser visualiser (open in any browser)
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md` design, roadmap, schema reference (the single source;
  `firebot-console/docs/` only points here)

## Workflow
Branch from `main` (`feat/...`, `fix/...`), open a PR, CI must pass. Conventional commit messages
(`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Never commit `*.db` files.

> Naming: the product is **NIRVANA**. The Python package, CLI commands (`firebot-*`), environment
> variables (`FIREBOT_*`) and database names keep the original `firebot` identifier so existing
> installs, configs and stored runs keep working.
