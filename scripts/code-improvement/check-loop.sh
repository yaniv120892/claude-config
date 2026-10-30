#!/usr/bin/env bash
# launchd watchdog, run hourly: nothing else notices a day without a run. Alerts when the
# loop is down, or when today's run has not started well after the run time — which also
# catches a loop that is alive but stuck. Each alert fires at most once a day.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
GRACE_MINUTES=30

alert_once_today() {
  local kind="$1" body="$2" marker
  marker="$CODE_IMPROVEMENT_STATE_DIR/alerted-$kind-$(today)"
  [ -f "$marker" ] && return
  touch "$marker"
  notify_macos "Code improvement" "$body"
}

if ! lock_holder_is_live "$CODE_IMPROVEMENT_LOOP_LOCK" loop.sh; then
  alert_once_today loop-down "The daily loop is not running. Start it from a cmux terminal: bash $SCRIPT_DIR/start.sh"
elif ! ran_today && [ "$(minutes_past_run_time)" -ge "$GRACE_MINUTES" ]; then
  alert_once_today run-missing "Today's run has not started. Check the Code Improvement tab in cmux."
fi
find "$CODE_IMPROVEMENT_STATE_DIR" -maxdepth 1 -name 'alerted-*' -mtime +7 -delete 2>/dev/null
exit 0
