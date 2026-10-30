# Settings and helpers shared by the code-improvement scripts. Sourced, never run.
# The run time lives here, not in the caller's environment: cmux starts the loop's tab
# with a fresh environment, so a variable set where start.sh ran never reaches loop.sh.

CODE_IMPROVEMENT_STATE_DIR="${CODE_IMPROVEMENT_STATE_DIR:-$HOME/.claude/state/code-improvement}"
CODE_IMPROVEMENT_RUN_AT="${CODE_IMPROVEMENT_RUN_AT:-06:43}"
CODE_IMPROVEMENT_LOG_DIR="$CODE_IMPROVEMENT_STATE_DIR/logs"
CODE_IMPROVEMENT_LOOP_LOCK="$CODE_IMPROVEMENT_STATE_DIR/loop.lock"
CODE_IMPROVEMENT_LAST_RUN_FILE="$CODE_IMPROVEMENT_STATE_DIR/last-run-date"
CODE_IMPROVEMENT_CMUX="$(command -v cmux || echo /Applications/cmux.app/Contents/Resources/bin/cmux)"

mkdir -p "$CODE_IMPROVEMENT_LOG_DIR"

# CODE_IMPROVEMENT_NOW (HH:MM) and CODE_IMPROVEMENT_TODAY (YYYY-MM-DD) pin the clock in tests.
today() {
  echo "${CODE_IMPROVEMENT_TODAY:-$(date +%F)}"
}

minutes_of_day() {
  local hours="${1%:*}" minutes="${1#*:}"
  echo $((10#$hours * 60 + 10#$minutes))
}

run_at_is_valid() {
  [[ "$CODE_IMPROVEMENT_RUN_AT" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]
}

minutes_past_run_time() {
  local now="${CODE_IMPROVEMENT_NOW:-$(date +%H:%M)}"
  echo $(($(minutes_of_day "$now") - $(minutes_of_day "$CODE_IMPROVEMENT_RUN_AT")))
}

ran_today() {
  [ "$(cat "$CODE_IMPROVEMENT_LAST_RUN_FILE" 2>/dev/null)" = "$(today)" ]
}

lock_holder_is_live() {
  local lock_dir="$1" script_name="$2"
  ps -p "$(cat "$lock_dir/pid" 2>/dev/null)" -o command= 2>/dev/null | grep -qE "/$script_name( |$)"
}

# Atomic: two callers racing for a stale lock cannot both win, because only one mkdir succeeds.
take_lock() {
  local lock_dir="$1" script_name="$2"
  if ! mkdir "$lock_dir" 2>/dev/null; then
    lock_holder_is_live "$lock_dir" "$script_name" && return 1
    rm -rf "$lock_dir"
    mkdir "$lock_dir" 2>/dev/null || return 1
  fi
  echo $$ > "$lock_dir/pid"
}

# Title and body travel as argv, never spliced into the script: bodies quote model output.
notify_macos() {
  osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title (item 1 of argv)' \
    -e 'end run' "$1" "$2" >/dev/null 2>&1
}
