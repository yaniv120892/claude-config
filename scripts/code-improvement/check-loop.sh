#!/usr/bin/env bash
# launchd watchdog: alert when the resident loop is not running, since nothing else would
# notice a day without a run.

STATE_DIR="${CODE_IMPROVEMENT_STATE_DIR:-$HOME/.claude/state/code-improvement}"
START_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start.sh"

if ps -p "$(cat "$STATE_DIR/loop.pid" 2>/dev/null)" -o command= 2>/dev/null | grep -q 'loop\.sh'; then
  exit 0
fi
/usr/bin/osascript -e 'on run argv' \
  -e 'display notification (item 1 of argv) with title "Code improvement loop is not running"' \
  -e 'end run' "Start it from a cmux terminal: bash $START_SCRIPT"
