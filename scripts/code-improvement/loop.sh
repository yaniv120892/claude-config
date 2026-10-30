#!/usr/bin/env bash
# Resident scheduler for the daily run, living in a cmux tab so session.sh can drive cmux.
# It polls instead of sleeping until the run time: `sleep` stops counting while the Mac
# sleeps, and polling also catches a run time missed during sleep.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${CODE_IMPROVEMENT_STATE_DIR:-$HOME/.claude/state/code-improvement}"
SESSION="${CODE_IMPROVEMENT_SESSION:-$SCRIPT_DIR/session.sh}"
RUN_AT="${CODE_IMPROVEMENT_RUN_AT:-06:43}"
POLL_SECONDS="${CODE_IMPROVEMENT_POLL_SECONDS:-60}"
MAX_POLLS="${CODE_IMPROVEMENT_MAX_POLLS:-0}"
PID_FILE="$STATE_DIR/loop.pid"
LAST_RUN_FILE="$STATE_DIR/last-run-date"

mkdir -p "$STATE_DIR"

if ps -p "$(cat "$PID_FILE" 2>/dev/null)" -o command= 2>/dev/null | grep -q 'loop\.sh'; then
  echo "Another code-improvement loop is running (pid $(cat "$PID_FILE"))."
  exit 0
fi
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

past_run_time() {
  [ ! "$(date +%H:%M)" \< "$RUN_AT" ]
}

ran_today() {
  [ "$(cat "$LAST_RUN_FILE" 2>/dev/null)" = "$(date +%F)" ]
}

# A first start after today's run time waits for tomorrow rather than firing at once.
if [ ! -f "$LAST_RUN_FILE" ] && past_run_time; then
  date +%F > "$LAST_RUN_FILE"
fi

echo "Code-improvement loop: runs daily at $RUN_AT. Leave this tab open."
polls=0
while [ "$MAX_POLLS" -eq 0 ] || [ "$polls" -lt "$MAX_POLLS" ]; do
  polls=$((polls + 1))
  if past_run_time && ! ran_today; then
    date +%F > "$LAST_RUN_FILE"
    bash "$SESSION"
  fi
  sleep "$POLL_SECONDS"
done
