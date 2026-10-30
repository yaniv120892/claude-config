#!/usr/bin/env bash
# Install the launchd job that starts the daily code-improvement run.
# If the Mac is asleep at the scheduled time, launchd runs it on wake.
# Idempotent. Safe to re-run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.yaniv.code-improvement"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.claude/state/code-improvement/logs"
HOUR="${CODE_IMPROVEMENT_HOUR:-6}"
MINUTE="${CODE_IMPROVEMENT_MINUTE:-43}"

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
		<string>$SCRIPT_DIR/run-daily.sh</string>
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

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: daily at $(printf '%02d:%02d' "$HOUR" "$MINUTE"). Run now with: launchctl kickstart gui/$(id -u)/$LABEL"
