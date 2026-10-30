#!/usr/bin/env bash
# Install the launchd watchdog that alerts when the resident code-improvement loop is not
# running. The loop itself starts from a cmux terminal (start.sh), not from launchd.
# Idempotent. Safe to re-run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.yaniv.code-improvement"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.claude/state/code-improvement/logs"
HOUR="${CODE_IMPROVEMENT_HOUR:-6}"
MINUTE="${CODE_IMPROVEMENT_MINUTE:-30}"

mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$SCRIPT_DIR/check-loop.sh</string>
	</array>
	<key>StartCalendarInterval</key>
	<dict>
		<key>Hour</key>
		<integer>$HOUR</integer>
		<key>Minute</key>
		<integer>$MINUTE</integer>
	</dict>
	<key>StandardOutPath</key>
	<string>$LOG_DIR/launchd.out</string>
	<key>StandardErrorPath</key>
	<string>$LOG_DIR/launchd.err</string>
</dict>
</plist>
PLIST

# bootout returns before the job is fully gone, so an immediate bootstrap can fail with EIO.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
for attempt in 1 2 3 4 5; do
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break
  if [ "$attempt" -eq 5 ]; then
    echo "launchctl bootstrap failed for $PLIST" >&2
    exit 1
  fi
  sleep 1
done
echo "Installed $LABEL: checks the loop daily at $(printf '%02d:%02d' "$HOUR" "$MINUTE")."
