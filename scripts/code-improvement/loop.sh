#!/usr/bin/env bash
# Resident scheduler for the daily run, living in a cmux tab so session.sh can drive cmux.
# One run per day, at or after the run time; a day missed while the loop was down runs as
# soon as it is back. It polls instead of sleeping until the run time, because `sleep`
# stops counting while the Mac sleeps.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
SESSION="${CODE_IMPROVEMENT_SESSION:-$SCRIPT_DIR/session.sh}"
POLL_SECONDS="${CODE_IMPROVEMENT_POLL_SECONDS:-60}"
MAX_POLLS="${CODE_IMPROVEMENT_MAX_POLLS:-0}"

if ! run_at_is_valid; then
  echo "CODE_IMPROVEMENT_RUN_AT must be HH:MM, 24-hour, zero-padded (got '$CODE_IMPROVEMENT_RUN_AT')." >&2
  exit 1
fi
if ! take_lock "$CODE_IMPROVEMENT_LOOP_LOCK" loop.sh; then
  echo "Another code-improvement loop is running (pid $(cat "$CODE_IMPROVEMENT_LOOP_LOCK/pid"))."
  exit 0
fi
trap 'rm -rf "$CODE_IMPROVEMENT_LOOP_LOCK"' EXIT

echo "Code-improvement loop: runs daily at $CODE_IMPROVEMENT_RUN_AT. Leave this tab open."
polls=0
polls_remain() {
  [ "$MAX_POLLS" -eq 0 ] || [ "$polls" -lt "$MAX_POLLS" ]
}

while polls_remain; do
  polls=$((polls + 1))
  if run_is_due; then
    today > "$CODE_IMPROVEMENT_LAST_RUN_FILE"
    bash "$SESSION"
    session_status=$?
    echo "$(date '+%F %T') session.sh exited $session_status" >> "$CODE_IMPROVEMENT_LOG_DIR/loop.log"
    if [ "$session_status" -ne 0 ]; then
      notify_macos "Code improvement" "Today's run exited $session_status; see $CODE_IMPROVEMENT_LOG_DIR"
    fi
  fi
  sleep "$POLL_SECONDS"
done
