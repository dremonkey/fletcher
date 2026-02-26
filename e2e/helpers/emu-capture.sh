#!/usr/bin/env bash
set -euo pipefail

# emu-capture.sh — Capture emulator state (screenshot + UI dump + logcat)
#
# Usage: ./emu-capture.sh <label>
# Produces: e2e/captures/<label>.png, <label>.xml, <label>.log

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAPTURES_DIR="$SCRIPT_DIR/../captures"
DEVICE_ID="${DEVICE_ID:-emulator-5554}"
PACKAGE="com.fletcher.fletcher"

if [ $# -lt 1 ]; then
    echo "Usage: emu-capture.sh <label>" >&2
    exit 1
fi

LABEL="$1"
ADB="adb -s $DEVICE_ID"

mkdir -p "$CAPTURES_DIR"

# Screenshot
$ADB shell screencap -p /sdcard/emu-capture.png
$ADB pull /sdcard/emu-capture.png "$CAPTURES_DIR/${LABEL}.png" >/dev/null 2>&1
$ADB shell rm /sdcard/emu-capture.png

# UI dump (useful for system dialogs/overlays, not Flutter widgets)
$ADB shell uiautomator dump /sdcard/emu-capture.xml 2>/dev/null || true
$ADB pull /sdcard/emu-capture.xml "$CAPTURES_DIR/${LABEL}.xml" >/dev/null 2>&1 || true
$ADB shell rm -f /sdcard/emu-capture.xml

# Logcat — last 200 lines filtered by app PID
APP_PID=$($ADB shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || echo "")
if [ -n "$APP_PID" ]; then
    $ADB logcat -d --pid="$APP_PID" -t 200 > "$CAPTURES_DIR/${LABEL}.log" 2>/dev/null
else
    # App not running — grab last 200 lines unfiltered as fallback
    $ADB logcat -d -t 200 > "$CAPTURES_DIR/${LABEL}.log" 2>/dev/null
fi

echo "Captured: ${LABEL}.png, ${LABEL}.xml, ${LABEL}.log → $CAPTURES_DIR/"
