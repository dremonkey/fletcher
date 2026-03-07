#!/usr/bin/env bash
set -uo pipefail

# check-preconditions.sh — Ensure e2e test readiness.
#
# Three phases:
#   1. E2E env — swap .env.e2e → .env so the APK uses e2e-fletcher- room prefix
#   2. Backend — LiveKit server, voice agent, mobile token (ensure-backend-ready.sh)
#   3. Mobile  — emulator, APK, app process (ensure-mobile-ready.sh)
#
# If the e2e env swap or backend phase changed .env, the mobile phase is
# invoked with --force-build so the APK rebundles the new .env asset.
#
# Exit 0 if all stages pass or are fixed, 1 if any fail.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MOBILE_DIR="$PROJECT_ROOT/apps/mobile"

# ── Phase 0: E2E env swap ───────────────────────────────────────────
# Copy .env.e2e over .env so the APK gets E2E_TEST_MODE=true, which
# makes room names use the e2e-fletcher- prefix.  The voice agent
# detects this prefix and uses a minimal system prompt. (TASK-022)

env_swapped=false
if [ -f "$MOBILE_DIR/.env.e2e" ]; then
  if ! diff -q "$MOBILE_DIR/.env" "$MOBILE_DIR/.env.e2e" >/dev/null 2>&1; then
    cp "$MOBILE_DIR/.env" "$MOBILE_DIR/.env.bak"
    cp "$MOBILE_DIR/.env.e2e" "$MOBILE_DIR/.env"
    env_swapped=true
    echo "FIX   Swapped .env → .env.e2e for e2e test mode"
  else
    echo "OK    .env already matches .env.e2e"
  fi
else
  echo "WARN  No .env.e2e found — running without e2e room prefix"
fi

# ── Phase 1: Backend ─────────────────────────────────────────────────

"$PROJECT_ROOT/scripts/ensure-backend-ready.sh"
backend_rc=$?

if [ $backend_rc -eq 1 ]; then
  # Restore .env before exiting
  if [ "$env_swapped" = true ] && [ -f "$MOBILE_DIR/.env.bak" ]; then
    mv "$MOBILE_DIR/.env.bak" "$MOBILE_DIR/.env"
  fi
  echo "FAIL preconditions: backend setup failed" >&2
  exit 1
fi

# ── Phase 2: Mobile ──────────────────────────────────────────────────

extra_args=("$@")

# Force rebuild if token was regenerated (rc=2) or .env was swapped for e2e
if [ $backend_rc -eq 2 ] || [ "$env_swapped" = true ]; then
  extra_args+=(--force-build)
fi

"$PROJECT_ROOT/scripts/ensure-mobile-ready.sh" "${extra_args[@]}"
mobile_rc=$?

# ── Cleanup: restore .env ────────────────────────────────────────────
if [ "$env_swapped" = true ] && [ -f "$MOBILE_DIR/.env.bak" ]; then
  mv "$MOBILE_DIR/.env.bak" "$MOBILE_DIR/.env"
  echo "OK    Restored original .env"
fi

exit $mobile_rc
