#!/usr/bin/env bash
# The daily code-improvement run. Runs inside the "Code Improvement" cmux workspace:
# for each repo in repos.txt, a model-free gate, then — only when the gate is clear —
# one unattended Claude run of the code-improvement skill. Ends with one notification
# round for the PRs that were opened.
#
# Repos run one at a time on purpose: each run starts dev servers for its sanity test,
# and two at once would fight over ports.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOS_FILE="${CODE_IMPROVEMENT_REPOS_FILE:-$SCRIPT_DIR/repos.txt}"
REPOS_ROOT="${CODE_IMPROVEMENT_REPOS_ROOT:-$HOME/Develop}"
STATE_DIR="${CODE_IMPROVEMENT_STATE_DIR:-$HOME/.claude/state/code-improvement}"
GATE="${CODE_IMPROVEMENT_GATE:-$SCRIPT_DIR/../../plugins/dev-workflows/skills/code-improvement/scripts/gate.sh}"
REPO_TIMEOUT_SECONDS="${CODE_IMPROVEMENT_REPO_TIMEOUT_SECONDS:-7200}"
LOG_DIR="$STATE_DIR/logs"
LOCK_DIR="$STATE_DIR/run.lock"
RUN_DATE="$(date +%F)"
CMUX="$(command -v cmux || echo /Applications/cmux.app/Contents/Resources/bin/cmux)"
export CMUX_QUIET=1

mkdir -p "$LOG_DIR"

lock_is_live() {
  local pid
  pid="$(cat "$LOCK_DIR/pid" 2>/dev/null)" || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -q 'session\.sh'
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if lock_is_live; then
    echo "A code-improvement run is still active (pid $(cat "$LOCK_DIR/pid")). Skipping today."
    exit 0
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo $$ > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"; "$CMUX" clear-status code-improvement >/dev/null 2>&1' EXIT

set_status() {
  "$CMUX" set-status code-improvement "$1" --icon gear --color "#f59e0b" >/dev/null 2>&1
}

# Title and body travel as argv, never spliced into the script: the body quotes model output.
notify() {
  "$CMUX" notify --title "$1" --body "$2" >/dev/null 2>&1
  osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title (item 1 of argv)' \
    -e 'end run' "$1" "$2" >/dev/null 2>&1
}

# macOS ships no `timeout`; an alarm set before exec survives into the child and kills it.
with_timeout() {
  perl -e 'alarm shift; exec @ARGV' "$@"
}

run_repo() {
  local repo="$1" name="$2" gate_flags="$3" gate_verdict result_file
  # Unquoted on purpose: each gate flag is its own word.
  if ! gate_verdict="$("$GATE" "$repo" $gate_flags 2>>"$LOG_DIR/$RUN_DATE-$name.log")"; then
    echo "${gate_verdict:-error gate failed, see $LOG_DIR/$RUN_DATE-$name.log}"
    return
  fi
  result_file="$STATE_DIR/$name.result"
  rm -f "$result_file"
  (cd "$repo" && with_timeout "$REPO_TIMEOUT_SECONDS" claude -p --permission-mode auto \
    --name "code-improvement $name $RUN_DATE" \
    "Use the dev-workflows:code-improvement skill on $repo in unattended mode. The gate already passed (flags: ${gate_flags:-none}). Result file: $result_file") \
    < /dev/null 2>&1 | tee -a "$LOG_DIR/$RUN_DATE-$name.log" >&2
  if [ -s "$result_file" ]; then
    head -1 "$result_file"
  else
    echo "error no result file (timed out or crashed), see $LOG_DIR/$RUN_DATE-$name.log"
  fi
}

results=()
while read -r name gate_flags <&3; do
  case "$name" in '' | \#*) continue ;; esac
  set_status "$name"
  printf '\n━━━ %s ━━━\n' "$name"
  results+=("$name $(run_repo "$REPOS_ROOT/$name" "$name" "$gate_flags")")
done 3< "$REPOS_FILE"

if [ ${#results[@]} -eq 0 ]; then
  notify "Code improvement" "No repos listed in $REPOS_FILE"
  exit 0
fi

summary="$(printf '%s\n' "${results[@]}")"
opened_lines="$(grep -E '^[^ ]+ opened https://' <<< "$summary" || true)"
error_lines="$(grep -E '^[^ ]+ (error|deploy-failed) ' <<< "$summary" || true)"
opened_count="$(grep -c . <<< "$opened_lines" || true)"
error_count="$(grep -c . <<< "$error_lines" || true)"
printf '\n━━━ Summary %s ━━━\n%s\n' "$RUN_DATE" "$summary" | tee "$LOG_DIR/$RUN_DATE-summary.log"

if [ "$error_count" -gt 0 ]; then
  notify "Code improvement: $error_count repo(s) need you" "$error_lines"
fi

if [ "$opened_count" -eq 0 ]; then
  [ "$error_count" -eq 0 ] && notify "Code improvement: no new PRs" "$summary"
  exit 0
fi

notify "Code improvement: $opened_count new PR(s)" "$opened_lines"

# Only status words and validated PR URLs reach the email model, so text a repo or a PR
# title supplies cannot steer what it sends or to whom.
recipient="$(git config --global user.email)"
email_body="$(grep -oE '^[^ ]+ [a-z-]+( https://github\.com/[A-Za-z0-9._/-]+/pull/[0-9]+)?' <<< "$summary")"
email_log="$LOG_DIR/$RUN_DATE-email.log"
if [ -z "$recipient" ]; then
  notify "Code improvement" "No email sent: git config user.email is empty"
  exit 0
fi
claude -p --model haiku --permission-mode auto --allowedTools mcp__claude_ai_Gmail__send_message \
  "Send exactly one email with the Gmail connector to $recipient, subject \"Code improvement $RUN_DATE: $opened_count new PR(s)\", with this plain-text body verbatim. After the send succeeds, print EMAIL_SENT on its own line.

$email_body" < /dev/null > "$email_log" 2>&1
grep -q '^EMAIL_SENT$' "$email_log" \
  || notify "Code improvement" "Email notification failed; see $email_log"
