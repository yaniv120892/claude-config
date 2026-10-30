#!/usr/bin/env bash
# The daily code-improvement run. Runs inside the "Code Improvement" cmux workspace:
# one unattended Claude run per repo in repos.txt, in order, then one notification
# round for the PRs that were opened.
#
# Repos run one at a time on purpose: each run starts dev servers for its sanity test,
# and two at once would fight over ports.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$HOME/.claude/state/code-improvement"
LOG_DIR="$STATE_DIR/logs"
PID_FILE="$STATE_DIR/run.pid"
RUN_DATE="$(date +%F)"
export CMUX_QUIET=1

mkdir -p "$LOG_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "A code-improvement run is still active (pid $(cat "$PID_FILE")). Skipping today."
  exit 0
fi
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"; command -v cmux >/dev/null && cmux clear-status code-improvement >/dev/null 2>&1' EXIT

set_status() {
  command -v cmux >/dev/null && cmux set-status code-improvement "$1" --icon gear --color "#f59e0b" >/dev/null 2>&1
}

notify() {
  local title="$1" body="$2"
  command -v cmux >/dev/null && cmux notify --title "$title" --body "$body" >/dev/null 2>&1
  osascript -e "display notification \"${body//\"/\\\"}\" with title \"${title//\"/\\\"}\"" >/dev/null 2>&1
}

results=()
while IFS= read -r repo; do
  case "$repo" in '' | \#*) continue ;; esac
  name="$(basename "$repo")"
  log="$LOG_DIR/$RUN_DATE-$name.log"
  set_status "$name"
  printf '\n━━━ %s ━━━\n' "$name"
  claude -p --permission-mode auto --name "code-improvement $name $RUN_DATE" \
    "Use the dev-workflows:code-improvement skill on $repo in unattended mode." 2>&1 | tee "$log"
  line="$(grep -E '^RESULT ' "$log" | tail -1)"
  results+=("${line:-RESULT $name error no RESULT line, see $log}")
done < "$SCRIPT_DIR/repos.txt"

summary="$(printf '%s\n' "${results[@]}" | sed 's/^RESULT //')"
opened="$(printf '%s\n' "${results[@]}" | grep -c ' opened ' || true)"
printf '\n━━━ Summary %s ━━━\n%s\n' "$RUN_DATE" "$summary" | tee "$LOG_DIR/$RUN_DATE-summary.log"

if [ "$opened" -gt 0 ]; then
  notify "Code improvement: $opened new PR(s)" "$(printf '%s\n' "${results[@]}" | grep ' opened ' | sed 's/^RESULT //' | head -5)"
  recipient="$(git config --global user.email)"
  claude -p --permission-mode auto --allowedTools mcp__claude_ai_Gmail__send_message \
    "Send one email with the Gmail connector to $recipient. Subject: \"Code improvement $RUN_DATE: $opened new PR(s)\". Body: a short plain-text list of the opened PRs (title and URL), then the other repos' status lines, from this run summary:
$summary" >> "$LOG_DIR/$RUN_DATE-email.log" 2>&1 \
    || notify "Code improvement" "Email notification failed; see $LOG_DIR/$RUN_DATE-email.log"
else
  notify "Code improvement: no new PRs" "$(printf '%s\n' "$summary" | head -5)"
fi
