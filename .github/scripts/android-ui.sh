#!/usr/bin/env bash
set -euo pipefail

adb wait-for-device
for attempt in $(seq 1 60); do
  if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && adb shell pm path android >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then exit 1; fi
  sleep 2
done
sleep 10
adb install apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
for attempt in 1 2; do
  if MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true "$HOME/.maestro/bin/maestro" test apps/mobile/.maestro/smoke.yaml; then
    break
  fi
  if [ "$attempt" -eq 2 ]; then exit 1; fi
  adb shell input keyevent 4
  sleep 10
done
adb shell pm clear dev.zotstop.app
adb shell pm grant dev.zotstop.app android.permission.ACCESS_FINE_LOCATION
adb shell pm revoke dev.zotstop.app android.permission.ACCESS_COARSE_LOCATION
adb emu geo fix -117.8425 33.6456
MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true "$HOME/.maestro/bin/maestro" test apps/mobile/.maestro/precise-only.yaml
