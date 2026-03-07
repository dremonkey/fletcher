#!/usr/bin/env bash
# grant-permissions.sh — Grant all runtime permissions needed by the Fletcher app.
#
# Usage: e2e/helpers/grant-permissions.sh
#
# Call after `pm clear` or `am force-stop` to avoid permission dialogs
# during automated e2e tests. Safe to call repeatedly (grants are idempotent).

DEVICE="${DEVICE_ID:-emulator-5554}"
PKG="com.fletcher.fletcher"

adb -s "$DEVICE" shell pm grant "$PKG" android.permission.RECORD_AUDIO
adb -s "$DEVICE" shell pm grant "$PKG" android.permission.BLUETOOTH_CONNECT
adb -s "$DEVICE" shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
adb -s "$DEVICE" shell pm grant "$PKG" android.permission.NEARBY_WIFI_DEVICES
