#!/usr/bin/env bash
set -uo pipefail

# check-preconditions.sh — Ensure e2e test readiness.
#
# Delegates to the shared ensure-mobile-ready.sh script which will
# auto-fix issues (start emulator, build/install APK, launch app).
# Exit 0 if all stages pass or are fixed, 1 if any fail.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec "$PROJECT_ROOT/scripts/ensure-mobile-ready.sh" "$@"
