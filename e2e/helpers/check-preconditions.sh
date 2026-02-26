#!/usr/bin/env bash
set -uo pipefail

# check-preconditions.sh — Verify e2e test readiness
#
# Usage: e2e/helpers/check-preconditions.sh
# Checks: emulator online, APK installed, app running
# Exit 0 if all pass, 1 if any fail.

DEVICE_ID="${DEVICE_ID:-emulator-5554}"
PACKAGE="com.fletcher.fletcher"
ADB="adb -s $DEVICE_ID"

FAILED=0

# Check 1: Emulator online
if adb devices 2>/dev/null | grep -q "^${DEVICE_ID}[[:space:]]*device$"; then
    echo "PASS emulator: ${DEVICE_ID} online"
else
    echo "FAIL emulator: ${DEVICE_ID} not found or offline"
    FAILED=1
fi

# Check 2: APK installed
if $ADB shell pm list packages 2>/dev/null | grep -q "$PACKAGE"; then
    echo "PASS apk: ${PACKAGE} installed"
else
    echo "FAIL apk: ${PACKAGE} not installed"
    FAILED=1
fi

# Check 3: App running
APP_PID=$($ADB shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r')
if [ -n "$APP_PID" ]; then
    echo "PASS app: running (pid ${APP_PID})"
else
    echo "FAIL app: not running"
    FAILED=1
fi

exit $FAILED
