# FireBot Console

The web console: a React frontend (Live Ops, Simulator, History) talking to a small FastAPI
bridge, which forwards live commands to `firebot-brain` and reads run history from Postgres.

## One-time setup
```bash
# from the repo root
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[pc]"                                  # firebot-brain/firebot-pi + psycopg
pip install -r firebot-console/backend/requirements.txt # the FastAPI bridge + asyncpg

# Postgres itself is assumed to already be running as a local service
# (e.g. `brew services start postgresql@16`); this just needs a role + db once:
createuser -s firebot && createdb -O firebot firebot
```

## Running it -- 2 tabs

**Tab 1 -- backend** (from `firebot-console/backend/`, venv active):
```bash
./run.sh
```
Starts the FastAPI bridge (`:8000`), a simulated robot (`firebot-pi --sim`), and `firebot-brain`.
The brain owns this terminal's stdin, so you can also type operator commands directly here
("put out the fire", "go to the east side", "status", "stop"). `--auto` means it starts
extinguishing on its own without needing a typed command first. Ctrl-C stops all three.

**Tab 2 -- frontend** (from `firebot-console/frontend/`):
```bash
./run.sh
```
Installs `node_modules` on first run, then starts the Vite dev server at
`http://localhost:5173`.

That's it -- open `http://localhost:5173`, Live Ops should show live telemetry once the
simulated robot connects. The **Simulator** tab doesn't need either of the above: it's a
self-contained, browser-only demo (its own procedural map, sensors, planner, and voice/text
commands), useful for iterating on planner/UI behavior without the backend running at all.

## Configuration

- `FIREBOT_BRAIN_CMD_URL`, `FIREBOT_TOKEN` -- see the repo-root `README.md`.
- `GROQ_API_KEY` -- required for the `/api/transcribe` voice fallback (Groq-hosted
  Whisper). Without it, that endpoint returns a 503 unless the local classifier below
  handles the request standalone.
- `FIREBOT_VOICE_INTENT_CHECKPOINT` / `FIREBOT_VOICE_INTENT_MIN_CONFIDENCE` /
  `FIREBOT_VOICE_INTENT_ROUTER_STATE` -- optional local first-pass for `/api/transcribe`,
  tried before Groq. Unset by default (no effect on a console that doesn't use it); see
  `src/firebot/voice_intent/README.md` ("6. Wire it into the console backend") for what
  each one does and how to train a checkpoint.

## Layout
- `backend/server.py` -- FastAPI bridge: `/api/runs*` (read history from Postgres),
  `/api/command*` (forward drive/pump/nozzle/estop to the brain's manual-control bridge),
  `/ws/telemetry` (live frames + operator commands, polled from Postgres)
- `frontend/src/pages/` -- `LiveOps.jsx` (real robot), `Simulator.jsx` (self-contained JS sim),
  `History.jsx` (past runs)
- `frontend/src/lib/simEngine.js` / `simController.js` -- the browser-only simulator: procedural
  map generator, mock sensors, EIF fire-source estimator, RRT* planner, command grammar -- all
  ported from the Python backend so the Simulator tab needs no server at all
- See the repo-root `README.md` / `docs/ARCHITECTURE.md` for the rest of the Python package
  (`src/firebot/`) that the backend/brain/robot processes are built on.
