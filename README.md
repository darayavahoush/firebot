# FireBot

Autonomous firefighting robot: simulation, EIF sensor fusion, motion planning, fire-event database.

## Setup (macOS)
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q && ruff check .
```

## Layout
- `src/firebot/db/` operational DB (`Store`), training DB (`TrainingStore`), migrations, device registry
- `src/firebot/fusion/` bearing-only Extended Information Filter
- `web/firebot-sim.html` standalone browser visualiser (open in any browser)
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md` design, roadmap, schema reference

## Workflow
Branch from `main` (`feat/...`, `fix/...`), open a PR, CI must pass. Conventional commit messages
(`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Never commit `*.db` files.
