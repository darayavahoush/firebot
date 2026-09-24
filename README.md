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
firebot-cmd --script "go to the east side; put out the fire; status"   # operator commands

# DRL (needs the `drl` extra: pip install -e ".[dev,drl]")
firebot-train --timesteps 200000 --n-envs 8 --out runs/ppo   # PPO via Stable-Baselines3
firebot-eval --model runs/ppo/model_final.zip --episodes 30  # vs. the rule baseline
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
- `web/firebot-sim.html` standalone browser visualiser (open in any browser)
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md` design, roadmap, schema reference

## Workflow
Branch from `main` (`feat/...`, `fix/...`), open a PR, CI must pass. Conventional commit messages
(`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Never commit `*.db` files.
