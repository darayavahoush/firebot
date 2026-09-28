#!/usr/bin/env bash
# Container entrypoint: the same three processes backend/run.sh starts locally.
# If any one exits, the container exits and Azure restarts it.
set -euo pipefail
: "${FIREBOT_TOKEN:?set FIREBOT_TOKEN}" "${FIREBOT_DB:?set FIREBOT_DB}"
cd /app/backend
uvicorn server:app --host 0.0.0.0 --port 8000 &
firebot-pi --sim --realtime --host 127.0.0.1 --token "$FIREBOT_TOKEN" &
sleep 2
# brain reads operator commands from stdin; keep it open (there is no terminal here)
tail -f /dev/null | firebot-brain --host 127.0.0.1 --db "$FIREBOT_DB" --token "$FIREBOT_TOKEN" --auto &
wait -n
