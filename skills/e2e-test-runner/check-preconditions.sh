#!/usr/bin/env bash
set -uo pipefail

# check-preconditions.sh — Ensure e2e test readiness.
#
# Two phases:
#   1. Backend  — LiveKit server, voice agent, mobile token (ensure-backend-ready.sh)
#   2. Mobile   — emulator, APK, app process (ensure-mobile-ready.sh)
#
# If the backend phase regenerated the token (exit code 2), the mobile phase
# is invoked with --force-build so the APK rebundles the new .env asset.
#
# Exit 0 if all stages pass or are fixed, 1 if any fail.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Phase 1: Backend ─────────────────────────────────────────────────

"$PROJECT_ROOT/scripts/ensure-backend-ready.sh"
backend_rc=$?

if [ $backend_rc -eq 1 ]; then
  echo "FAIL preconditions: backend setup failed" >&2
  exit 1
fi

# ── Phase 2: Mobile ──────────────────────────────────────────────────

extra_args=("$@")

# If token was regenerated (rc=2), force APK rebuild so the new .env is bundled
if [ $backend_rc -eq 2 ]; then
  extra_args+=(--force-build)
fi

exec "$PROJECT_ROOT/scripts/ensure-mobile-ready.sh" "${extra_args[@]}"
