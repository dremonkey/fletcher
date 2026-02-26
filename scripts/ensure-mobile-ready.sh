#!/usr/bin/env bash
set -uo pipefail

# ensure-mobile-ready.sh — Ensure the mobile environment is fully operational.
#
# Three stages, each idempotent:
#   1. Emulator — verify device is online, start AVD if needed
#   2. APK     — verify package installed, build & install if needed
#   3. App     — verify app process running, launch if needed
#
# Structured output on stdout (PASS / FIX / FAIL), progress on stderr.
#
# Usage:
#   ./scripts/ensure-mobile-ready.sh [OPTIONS]
#
# Options:
#   --device-id <ID>   Target device (default: $DEVICE_ID or emulator-5554)
#   --avd-name <NAME>  AVD to start if emulator offline (default: $AVD_NAME or pixel_9)
#   --skip-build       Don't build/install APK even if missing
#   --skip-launch      Don't launch the app even if not running

# ── Configuration (env vars with defaults, overridable by flags) ──────

DEVICE_ID="${DEVICE_ID:-emulator-5554}"
AVD_NAME="${AVD_NAME:-pixel_9}"
GPU_MODE="${GPU_MODE:-host}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-120}"
PACKAGE="com.fletcher.fletcher"

SKIP_BUILD=false
SKIP_LAUNCH=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MOBILE_DIR="$PROJECT_ROOT/apps/mobile"

# ── Parse flags ───────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-id)  DEVICE_ID="$2"; shift 2 ;;
    --avd-name)   AVD_NAME="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-launch) SKIP_LAUNCH=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

ADB="adb -s $DEVICE_ID"

# ── Helpers ───────────────────────────────────────────────────────────

progress() { echo "$*" >&2; }

emulator_running() {
  adb devices 2>/dev/null | grep -q "^${DEVICE_ID}[[:space:]]*device$"
}

wait_for_boot() {
  progress "Waiting for emulator to boot..."
  local elapsed=0
  while [ $elapsed -lt "$BOOT_TIMEOUT" ]; do
    local boot_completed
    boot_completed=$($ADB shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo "")
    if [ "$boot_completed" = "1" ]; then
      progress "Emulator booted successfully"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  progress "Emulator failed to boot within ${BOOT_TIMEOUT}s"
  return 1
}

start_emulator() {
  progress "Starting emulator: $AVD_NAME (gpu: $GPU_MODE)"
  emulator -avd "$AVD_NAME" -no-snapshot-load -gpu "$GPU_MODE" </dev/null >/dev/null 2>&1 &

  # Wait for device to appear in adb
  local elapsed=0
  while ! adb devices 2>/dev/null | grep -q "$DEVICE_ID" && [ $elapsed -lt 30 ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done

  if ! adb devices 2>/dev/null | grep -q "$DEVICE_ID"; then
    return 1
  fi

  wait_for_boot
}

# ── Stage 1: Emulator ────────────────────────────────────────────────

FAILED=0

if emulator_running; then
  echo "PASS emulator: ${DEVICE_ID} online"
elif [[ "$DEVICE_ID" == emulator-* ]]; then
  # It's an emulator — try to start it
  if start_emulator; then
    echo "FIX  emulator: started ${AVD_NAME} on ${DEVICE_ID}"
  else
    echo "FAIL emulator: could not start ${AVD_NAME}"
    FAILED=1
  fi
else
  # Physical device — can't auto-fix, just report
  echo "FAIL emulator: ${DEVICE_ID} not found or offline"
  FAILED=1
fi

# Bail early if no device
if [ $FAILED -ne 0 ]; then
  exit 1
fi

# ── Stage 2: APK ─────────────────────────────────────────────────────

if $ADB shell pm list packages 2>/dev/null | grep -q "$PACKAGE"; then
  echo "PASS apk: ${PACKAGE} installed"
elif [ "$SKIP_BUILD" = true ]; then
  echo "FAIL apk: ${PACKAGE} not installed (--skip-build)"
  FAILED=1
else
  progress "Building debug APK..."
  if (cd "$MOBILE_DIR" && flutter build apk --debug) >&2 2>&1; then
    APK_PATH="$MOBILE_DIR/build/app/outputs/flutter-apk/app-debug.apk"
    progress "Installing APK to ${DEVICE_ID}..."
    if $ADB install -r "$APK_PATH" >&2 2>&1; then
      echo "FIX  apk: built and installed ${PACKAGE}"
    else
      echo "FAIL apk: built but install failed"
      FAILED=1
    fi
  else
    echo "FAIL apk: build failed"
    FAILED=1
  fi
fi

# ── Stage 3: App ─────────────────────────────────────────────────────

APP_PID=$($ADB shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r')

if [ -n "$APP_PID" ]; then
  echo "PASS app: running (pid ${APP_PID})"
elif [ "$SKIP_LAUNCH" = true ]; then
  echo "PASS app: not running (--skip-launch)"
elif [ $FAILED -ne 0 ]; then
  echo "FAIL app: skipped (prior stage failed)"
else
  progress "Launching ${PACKAGE}..."
  if $ADB shell am start -n "${PACKAGE}/.MainActivity" >&2 2>&1; then
    sleep 1
    APP_PID=$($ADB shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r')
    if [ -n "$APP_PID" ]; then
      echo "FIX  app: launched (pid ${APP_PID})"
    else
      echo "FAIL app: launched but not running"
      FAILED=1
    fi
  else
    echo "FAIL app: launch failed"
    FAILED=1
  fi
fi

exit $FAILED
