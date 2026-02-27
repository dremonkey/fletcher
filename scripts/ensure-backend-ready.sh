#!/usr/bin/env bash
set -uo pipefail

# ensure-backend-ready.sh — Ensure the LiveKit backend is fully operational.
#
# Three stages, each idempotent:
#   1. LiveKit  — verify server is running, start via docker compose if needed
#   2. Agent    — verify voice-agent is running, start via docker compose if needed
#   3. Token    — verify mobile .env has emulator-reachable URL + non-expired token
#
# Structured output on stdout (PASS / FIX / FAIL), progress on stderr.
#
# Exit codes:
#   0 — all stages passed (no changes needed)
#   1 — a stage failed and could not be fixed
#   2 — all stages passed but token was regenerated (caller should rebuild APK)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MOBILE_ENV="$PROJECT_ROOT/apps/mobile/.env"

LIVEKIT_PORT="${LIVEKIT_PORT:-7880}"
LIVEKIT_STARTUP_TIMEOUT="${LIVEKIT_STARTUP_TIMEOUT:-15}"
AGENT_STARTUP_WAIT="${AGENT_STARTUP_WAIT:-5}"

# Expected URL for the Android emulator (10.0.2.2 maps to host localhost)
EMULATOR_LIVEKIT_URL="ws://10.0.2.2:${LIVEKIT_PORT}"

FAILED=0
TOKEN_REGENERATED=false

# ── Helpers ───────────────────────────────────────────────────────────

progress() { echo "$*" >&2; }

# Decode a JWT payload (base64url → JSON). No verification.
jwt_payload() {
  local token="$1"
  local payload
  payload=$(echo "$token" | cut -d. -f2)
  # Pad base64url to valid base64
  local pad=$(( (4 - ${#payload} % 4) % 4 ))
  for ((i=0; i<pad; i++)); do payload="${payload}="; done
  # base64url → base64
  payload=$(echo "$payload" | tr '_-' '/+')
  echo "$payload" | base64 -d 2>/dev/null
}

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

# ── Stage 3: Mobile Token ────────────────────────────────────────────

needs_token_regen=false

if [ ! -f "$MOBILE_ENV" ]; then
  progress "Mobile .env not found, will generate"
  needs_token_regen=true
else
  # Check LIVEKIT_URL points to emulator-reachable address
  current_url=$(grep '^LIVEKIT_URL=' "$MOBILE_ENV" 2>/dev/null | cut -d= -f2-)
  if [ "$current_url" != "$EMULATOR_LIVEKIT_URL" ]; then
    progress "LIVEKIT_URL is '$current_url', expected '$EMULATOR_LIVEKIT_URL'"
    needs_token_regen=true
  fi

  # Check token exists and is not expired
  current_token=$(grep '^LIVEKIT_TOKEN=' "$MOBILE_ENV" 2>/dev/null | cut -d= -f2-)
  if [ -z "$current_token" ]; then
    progress "No LIVEKIT_TOKEN in mobile .env"
    needs_token_regen=true
  elif [ "$needs_token_regen" = false ]; then
    # Decode and check exp claim
    payload_json=$(jwt_payload "$current_token")
    if [ -n "$payload_json" ]; then
      exp=$(echo "$payload_json" | grep -o '"exp":[0-9]*' | cut -d: -f2)
      now=$(date +%s)
      if [ -n "$exp" ] && [ "$exp" -le "$now" ] 2>/dev/null; then
        progress "Token expired (exp=$exp, now=$now)"
        needs_token_regen=true
      fi
    else
      progress "Could not decode token, will regenerate"
      needs_token_regen=true
    fi
  fi
fi

if [ "$needs_token_regen" = true ]; then
  progress "Regenerating mobile token..."
  # Source root .env for API key/secret, override LIVEKIT_URL for emulator
  if (
    set -a
    # shellcheck disable=SC1091
    . "$PROJECT_ROOT/.env"
    set +a
    export LIVEKIT_URL="$EMULATOR_LIVEKIT_URL"
    cd "$PROJECT_ROOT" && bun run scripts/generate-token.ts
  ) >&2 2>&1; then
    echo "FIX  token: regenerated for ${EMULATOR_LIVEKIT_URL}"
    TOKEN_REGENERATED=true
  else
    echo "FAIL token: regeneration failed"
    FAILED=1
  fi
else
  # Report token expiry time
  current_token=$(grep '^LIVEKIT_TOKEN=' "$MOBILE_ENV" 2>/dev/null | cut -d= -f2-)
  payload_json=$(jwt_payload "$current_token")
  exp=$(echo "$payload_json" | grep -o '"exp":[0-9]*' | cut -d: -f2)
  if [ -n "$exp" ]; then
    expires_at=$(date -d "@$exp" '+%Y-%m-%d %H:%M' 2>/dev/null || date -r "$exp" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "unknown")
    echo "PASS token: valid (expires ${expires_at})"
  else
    echo "PASS token: valid"
  fi
fi

# ── Exit ──────────────────────────────────────────────────────────────

if [ $FAILED -ne 0 ]; then
  exit 1
elif [ "$TOKEN_REGENERATED" = true ]; then
  exit 2
else
  exit 0
fi
