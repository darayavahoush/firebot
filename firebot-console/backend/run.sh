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
# librosa (local voice model) JIT-caches via numba; if numba can't find a writable cache dir,
# `import librosa` fails with "cannot cache function ... no locator available". Give it one.
export NUMBA_CACHE_DIR="${NUMBA_CACHE_DIR:-$(cd ../.. && pwd)/.numba_cache}"
mkdir -p "$NUMBA_CACHE_DIR"
# server.py reads the same FIREBOT_DB variable (same default), so setting it here is enough.
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

# ---- trained voice-intent model (optional) --------------------------------------------
# The checkpoint is gitignored, so it only exists on the machine that trained it. If one is
# there (repo-root checkpoints/intent_head.pt by default, or $FIREBOT_VOICE_INTENT_CHECKPOINT),
# hand server.py an absolute path -- it runs from this directory, so a relative one wouldn't
# resolve. Never fatal: without it /api/transcribe just uses Groq.
REPO_ROOT="$(cd .. && cd .. && pwd)"
VI_CKPT="${FIREBOT_VOICE_INTENT_CHECKPOINT:-$REPO_ROOT/checkpoints/intent_head.pt}"
case "$VI_CKPT" in /*) ;; *) VI_CKPT="$REPO_ROOT/$VI_CKPT" ;; esac
if [ -f "$VI_CKPT" ]; then
  if python3 -c "import torch, transformers, librosa" 2>/dev/null; then
    export FIREBOT_VOICE_INTENT_CHECKPOINT="$VI_CKPT"
    export FIREBOT_VOICE_INTENT_ROUTER_STATE="${FIREBOT_VOICE_INTENT_ROUTER_STATE:-$REPO_ROOT/voice_intent_router.json}"
    echo "-> voice: local intent model ON ($VI_CKPT)"
  else
    unset FIREBOT_VOICE_INTENT_CHECKPOINT
    echo "-> voice: checkpoint found but torch/transformers/librosa missing -- run:" >&2
    echo "     pip install -e \".[voice]\"   (falling back to Groq for now)" >&2
  fi
else
  unset FIREBOT_VOICE_INTENT_CHECKPOINT
  echo "-> voice: no checkpoint at $VI_CKPT -- using Groq only"
  echo "     (train one: see src/firebot/voice_intent/README.md, or set FIREBOT_VOICE_INTENT_CHECKPOINT)"
fi
# ---- offline Vosk tier (optional) ----------------------------------------------------
# An unpacked Vosk model dir: $FIREBOT_VOSK_MODEL, else the first models/vosk-model* under the
# repo root. Sits between the local intent model and Groq, so voice works with no API key.
# Set FIREBOT_VAD=1 to also trim non-speech from each clip with Silero VAD (needs the `vad` extra).
VK_DIR="${FIREBOT_VOSK_MODEL:-}"
if [ -z "$VK_DIR" ]; then
  for d in "$REPO_ROOT"/models/vosk-model*; do [ -d "$d" ] && VK_DIR="$d" && break; done
fi
if [ -n "$VK_DIR" ] && [ -d "$VK_DIR" ]; then
  if python3 -c "import vosk" 2>/dev/null; then
    export FIREBOT_VOSK_MODEL="$VK_DIR"
    echo "-> voice: offline Vosk ON ($VK_DIR)"
    [ -n "${FIREBOT_VAD:-}" ] && echo "-> voice: Silero VAD trimming ON"
  else
    unset FIREBOT_VOSK_MODEL
    echo "-> voice: Vosk model found but 'vosk' isn't installed -- run: pip install -e \".[speech]\"" >&2
  fi
else
  unset FIREBOT_VOSK_MODEL
  echo "-> voice: no Vosk model (put one in $REPO_ROOT/models/ or set FIREBOT_VOSK_MODEL for offline speech)"
fi
if [ -z "${GROQ_API_KEY:-}" ] && [ -z "${FIREBOT_VOICE_INTENT_CHECKPOINT:-}" ] && [ -z "${FIREBOT_VOSK_MODEL:-}" ]; then
  echo "   warning: no local model, no Vosk model and no GROQ_API_KEY -- /api/transcribe will return 503" >&2
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
