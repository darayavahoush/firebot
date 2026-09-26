#!/usr/bin/env bash
# One tab, everything Live Ops needs on the backend side:
#   - the FastAPI bridge (server.py) the frontend talks to over HTTP + WebSocket
#   - a simulated robot (firebot-pi --sim) standing in for real hardware
#   - the PC brain (firebot-brain) -- it owns this terminal's stdin, so you can
#     also type operator commands right here ("put out the fire", "stop", "status", ...)
#
# One-time setup (not part of this script, do this once):
#   python3 -m venv .venv && source .venv/bin/activate        # from the repo root
#   pip install -e ".[pc]"                                     # firebot-brain/firebot-pi + psycopg
#   pip install -r firebot-console/backend/requirements.txt    # the FastAPI bridge + asyncpg
#   createuser -s firebot && createdb -O firebot firebot       # once, against your local Postgres
#     (Postgres itself -- e.g. `brew services start postgresql@16` -- is assumed to already be
#      running as a background service, same as any other local dev database)
#
# Usage: from firebot-console/backend/, with the venv above active: ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

export FIREBOT_TOKEN="${FIREBOT_TOKEN:-dev-secret}"
# Must match server.py's DATABASE_URL -- that one's hardcoded, not read from the environment,
# so if you override this, go update the constant at the top of server.py to match.
DB_URL="${FIREBOT_DB:-postgresql://firebot:firebot@localhost:5432/firebot}"

command -v firebot-brain >/dev/null 2>&1 || {
  echo "firebot-brain not on PATH -- activate the venv first (see the header of this script)." >&2
  exit 1
}

if ! python3 - "$DB_URL" <<'PY'
import sys
try:
    import psycopg
    psycopg.connect(sys.argv[1]).close()
except Exception as e:
    sys.exit(str(e))
PY
then
  echo "Postgres isn't reachable at $DB_URL (or psycopg isn't installed) -- start Postgres and" >&2
  echo "create the firebot db/role first (see the header of this script)." >&2
  exit 1
fi

PIDS=()
cleanup() {
  echo
  echo "stopping..."
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "-> console API on :8000"
uvicorn server:app --port 8000 &
PIDS+=("$!")

echo "-> simulated robot (firebot-pi --sim --realtime)"
firebot-pi --sim --realtime --host 127.0.0.1 --token "$FIREBOT_TOKEN" &
PIDS+=("$!")

sleep 1
echo "-> brain starting -- type commands below any time (\"put out the fire\", \"stop\", \"status\", ...)"
echo
firebot-brain --host 127.0.0.1 --db "$DB_URL" --token "$FIREBOT_TOKEN" --auto
