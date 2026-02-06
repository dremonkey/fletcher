#!/usr/bin/env bash
set -euo pipefail

# Configuration
AVD_NAME="${AVD_NAME:-pixel_9}"
DEVICE_ID="${DEVICE_ID:-emulator-5554}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-120}"
GPU_MODE="${GPU_MODE:-host}"  # host, swiftshader_indirect, or auto

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MOBILE_DIR="$PROJECT_ROOT/apps/mobile"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[run-mobile]${NC} $1"; }
warn() { echo -e "${YELLOW}[run-mobile]${NC} $1"; }
error() { echo -e "${RED}[run-mobile]${NC} $1" >&2; }

# Check if emulator is already running
emulator_running() {
    adb devices 2>/dev/null | grep -q "$DEVICE_ID"
}

# Wait for emulator to fully boot
wait_for_boot() {
    log "Waiting for emulator to boot..."
    local elapsed=0
    while [ $elapsed -lt $BOOT_TIMEOUT ]; do
        local boot_completed
        boot_completed=$(adb -s "$DEVICE_ID" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo "")
        if [ "$boot_completed" = "1" ]; then
            log "Emulator booted successfully"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        printf "."
    done
    echo ""
    error "Emulator failed to boot within ${BOOT_TIMEOUT}s"
    return 1
}

# Start emulator in background
start_emulator() {
    if emulator_running; then
        log "Emulator already running on $DEVICE_ID"
        return 0
    fi

    log "Starting emulator: $AVD_NAME (gpu: $GPU_MODE)"
    emulator -avd "$AVD_NAME" -no-snapshot-load -gpu "$GPU_MODE" &
    EMULATOR_PID=$!

    # Wait for device to appear
    local elapsed=0
    while ! emulator_running && [ $elapsed -lt 30 ]; do
        sleep 1
        elapsed=$((elapsed + 1))
    done

    if ! emulator_running; then
        error "Emulator failed to start"
        return 1
    fi

    wait_for_boot
}

# Cleanup on exit
cleanup() {
    if [ -n "${EMULATOR_PID:-}" ]; then
        warn "Shutting down emulator (PID: $EMULATOR_PID)"
        kill "$EMULATOR_PID" 2>/dev/null || true
    fi
}

main() {
    trap cleanup EXIT

    log "Starting Fletcher mobile development environment"

    # Generate fresh LiveKit token
    log "Generating LiveKit token..."
    bun run --cwd "$PROJECT_ROOT" token:generate

    start_emulator

    log "Launching Flutter app..."
    cd "$MOBILE_DIR"
    flutter run -d "$DEVICE_ID" "$@"
}

main "$@"
