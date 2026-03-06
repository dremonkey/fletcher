#!/usr/bin/env bash
set -uo pipefail

# ensure-backend-ready.sh — Ensure the LiveKit backend is fully operational.
#
# Three stages, each idempotent:
#   1. LiveKit       — verify server is running, start via docker compose if needed
#   2. Agent         — verify voice-agent is running, start via docker compose if needed
#   3. Token + Env   — verify token-server is running, mobile .env has emulator URL
#
# Structured output on stdout (PASS / FIX / FAIL), progress on stderr.
#
# Exit codes:
#   0 — all stages passed (no changes needed)
#   1 — a stage failed and could not be fixed
#   2 — all stages passed but mobile .env was modified (caller should rebuild APK)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MOBILE_ENV="$PROJECT_ROOT/apps/mobile/.env"

LIVEKIT_PORT="${LIVEKIT_PORT:-7880}"
LIVEKIT_STARTUP_TIMEOUT="${LIVEKIT_STARTUP_TIMEOUT:-15}"
AGENT_STARTUP_WAIT="${AGENT_STARTUP_WAIT:-5}"
TOKEN_SERVER_PORT="${TOKEN_SERVER_PORT:-7882}"

# Expected URL for the Android emulator (10.0.2.2 maps to host localhost)
EMULATOR_LIVEKIT_URL="ws://10.0.2.2:${LIVEKIT_PORT}"

FAILED=0
ENV_CHANGED=false

# ── Helpers ───────────────────────────────────────────────────────────

progress() { echo "$*" >&2; }

# ── Stage 1: LiveKit Server ──────────────────────────────────────────

livekit_running() {
  curl -sf "http://localhost:${LIVEKIT_PORT}" >/dev/null 2>&1 ||
    docker compose -f "$PROJECT_ROOT/docker-compose.yml" ps livekit --status running 2>/dev/null | grep -q livekit
}

if livekit_running; then
  echo "PASS livekit: server running on :${LIVEKIT_PORT}"
else
  progress "Starting LiveKit server..."
  if docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d livekit >&2 2>&1; then
    # Poll until ready
    elapsed=0
    while [ $elapsed -lt "$LIVEKIT_STARTUP_TIMEOUT" ]; do
      if curl -sf "http://localhost:${LIVEKIT_PORT}" >/dev/null 2>&1; then
        break
      fi
      sleep 1
      elapsed=$((elapsed + 1))
    done

    if curl -sf "http://localhost:${LIVEKIT_PORT}" >/dev/null 2>&1; then
      echo "FIX  livekit: started server on :${LIVEKIT_PORT}"
    else
      echo "FAIL livekit: started container but port ${LIVEKIT_PORT} not responding after ${LIVEKIT_STARTUP_TIMEOUT}s"
      FAILED=1
    fi
  else
    echo "FAIL livekit: docker compose up failed"
    FAILED=1
  fi
fi

# ── Stage 2: Voice Agent ─────────────────────────────────────────────

agent_running() {
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" ps voice-agent --status running 2>/dev/null | grep -q voice-agent
}

if agent_running; then
  echo "PASS agent: voice-agent running"
else
  progress "Starting voice agent..."
  if docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d voice-agent >&2 2>&1; then
    # Give agent a few seconds to register with LiveKit
    sleep "$AGENT_STARTUP_WAIT"
    if agent_running; then
      echo "FIX  agent: started voice-agent"
    else
      echo "FAIL agent: started container but not running after ${AGENT_STARTUP_WAIT}s"
      FAILED=1
    fi
  else
    echo "FAIL agent: docker compose up failed"
    FAILED=1
  fi
fi

# ── Stage 3: Token Server + Mobile .env ──────────────────────────────

# 3a. Ensure token-server container is running
token_server_healthy() {
  curl -sf "http://localhost:${TOKEN_SERVER_PORT}/health" >/dev/null 2>&1
}

if token_server_healthy; then
  echo "PASS token-server: running on :${TOKEN_SERVER_PORT}"
else
  progress "Starting token server..."
  if docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d token-server >&2 2>&1; then
    # Poll until healthy
    elapsed=0
    while [ $elapsed -lt 10 ]; do
      if token_server_healthy; then break; fi
      sleep 1
      elapsed=$((elapsed + 1))
    done
    if token_server_healthy; then
      echo "FIX  token-server: started on :${TOKEN_SERVER_PORT}"
    else
      echo "FAIL token-server: started container but /health not responding after 10s"
      FAILED=1
    fi
  else
    echo "FAIL token-server: docker compose up failed"
    FAILED=1
  fi
fi

# 3b. Ensure mobile .env has emulator-reachable LIVEKIT_URL and token config
if [ ! -f "$MOBILE_ENV" ]; then
  progress "Mobile .env not found, creating..."
  cat > "$MOBILE_ENV" <<EOF
LIVEKIT_URL=${EMULATOR_LIVEKIT_URL}
TOKEN_SERVER_PORT=${TOKEN_SERVER_PORT}
DEPARTURE_TIMEOUT_S=120
EOF
  echo "FIX  env: created mobile .env for emulator"
  ENV_CHANGED=true
else
  current_url=$(grep '^LIVEKIT_URL=' "$MOBILE_ENV" 2>/dev/null | head -1 | cut -d= -f2-)
  if [ "$current_url" != "$EMULATOR_LIVEKIT_URL" ]; then
    progress "Fixing LIVEKIT_URL: '$current_url' → '$EMULATOR_LIVEKIT_URL'"
    sed -i "s|^LIVEKIT_URL=.*|LIVEKIT_URL=${EMULATOR_LIVEKIT_URL}|" "$MOBILE_ENV"
    echo "FIX  env: updated LIVEKIT_URL to ${EMULATOR_LIVEKIT_URL}"
    ENV_CHANGED=true
  fi

  # Remove stale LIVEKIT_TOKEN if present (dynamic rooms use token endpoint now)
  if grep -q '^LIVEKIT_TOKEN=' "$MOBILE_ENV" 2>/dev/null; then
    progress "Removing stale LIVEKIT_TOKEN from mobile .env (dynamic rooms use token endpoint)"
    sed -i '/^LIVEKIT_TOKEN=/d' "$MOBILE_ENV"
    ENV_CHANGED=true
  fi

  # Ensure TOKEN_SERVER_PORT is set
  if ! grep -q '^TOKEN_SERVER_PORT=' "$MOBILE_ENV" 2>/dev/null; then
    echo "TOKEN_SERVER_PORT=${TOKEN_SERVER_PORT}" >> "$MOBILE_ENV"
    ENV_CHANGED=true
  fi

  # Ensure DEPARTURE_TIMEOUT_S is set
  if ! grep -q '^DEPARTURE_TIMEOUT_S=' "$MOBILE_ENV" 2>/dev/null; then
    echo "DEPARTURE_TIMEOUT_S=120" >> "$MOBILE_ENV"
    ENV_CHANGED=true
  fi

  if [ "$ENV_CHANGED" = false ]; then
    echo "PASS env: mobile .env correct"
  fi
fi

# ── Exit ──────────────────────────────────────────────────────────────

if [ $FAILED -ne 0 ]; then
  exit 1
elif [ "$ENV_CHANGED" = true ]; then
  exit 2
else
  exit 0
fi
