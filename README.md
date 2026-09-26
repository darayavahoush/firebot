# FireBot

Autonomous firefighting robot: simulation, EIF sensor fusion, motion planning, fire-event database.

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
- `src/firebot/perception.py` sensor frame -> observation (fusion), shared by the sim and the brain
- `web/firebot-sim.html` standalone browser visualiser (open in any browser)
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md` design, roadmap, schema reference

## Workflow
Branch from `main` (`feat/...`, `fix/...`), open a PR, CI must pass. Conventional commit messages
(`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Never commit `*.db` files.
