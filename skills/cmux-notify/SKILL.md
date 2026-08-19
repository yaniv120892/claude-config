---
name: cmux-notify
user-invocable: false
description: Use when sending notifications, status badges, progress bars, or log entries from within a cmux terminal — signaling task state, completion, errors, or progress to the user via the cmux sidebar and macOS notifications.
---

# cmux Notifications, Status & Progress

> Assumes the cmux basics (refs, `--json`, `--focus false`, `identify`) from the **cmux** skill.

Keep users informed about long-running agent tasks through cmux's notification panel, status badges, and progress bars.

## Always Check Availability First

```bash
# Safe one-liner with macOS fallback
command -v cmux &>/dev/null && cmux notify --title "Done" --body "Task complete" \
  || osascript -e 'display notification "Task complete" with title "Done"'
```

## Notifications

```bash
# Simple
cmux notify --title "Build Complete"

# With subtitle and body
cmux notify --title "Claude Code" --subtitle "Done" --body "All tests passed"

# Targeted to a specific surface
cmux notify --title "Done" --workspace workspace:2 --surface surface:5

# List / manage
cmux list-notifications
cmux jump-to-unread              # Cmd+Shift+U equivalent
cmux mark-notification-read --all
cmux clear-notifications
```

## Status Badges (persistent key-value indicators)

Show persistent state in the workspace status bar — great for long-running tasks:

```bash
# Set
cmux set-status build "Running" --icon "gear" --color "#f59e0b" --priority 10
cmux set-status tests "Passed" --icon "checkmark" --color "#22c55e" --priority 5
cmux set-status agent "Idle" --workspace workspace:2

# Clear
cmux clear-status build
cmux clear-status tests

# List all
cmux list-status
cmux list-status --workspace workspace:2
```

**Recommended lifecycle pattern:**
```bash
cmux set-status task "Working" --color "#f59e0b"   # yellow = in progress
# ... do work ...
cmux set-status task "Done" --color "#22c55e"       # green = success
# or
cmux set-status task "Failed" --color "#ef4444"     # red = error
# cleanup when done
cmux clear-status task
```

## Progress Bar

Show a progress indicator for multi-step work:

```bash
cmux set-progress 0.0 --label "Starting..."
cmux set-progress 0.25 --label "Fetching data"
cmux set-progress 0.5 --label "Processing"
cmux set-progress 0.75 --label "Writing output"
cmux set-progress 1.0 --label "Complete"
cmux clear-progress                                  # remove bar when done
```

## Workspace Log

Append structured log entries to the workspace log panel:

```bash
cmux log "Starting build" --source "claude" --workspace workspace:2
cmux log "Error: file not found" --level error --source "claude"
cmux list-log --limit 20
cmux clear-log
```

## Agent Task Pattern (complete lifecycle)

```bash
WS="${CMUX_WORKSPACE_ID:-}"

notify() { command -v cmux &>/dev/null && cmux notify --title "Claude" --body "$1" --workspace "$WS" || osascript -e "display notification \"$1\" with title \"Claude\""; }

cmux set-status claude "Working" --color "#f59e0b" --workspace "$WS"
cmux set-progress 0.0 --label "Starting" --workspace "$WS"

# ... task work ...

cmux set-progress 1.0 --label "Done" --workspace "$WS"
cmux clear-progress --workspace "$WS"
cmux set-status claude "Done" --color "#22c55e" --workspace "$WS"
notify "Task complete"
```

## Common Mistakes

- **No fallback**: Always include `|| osascript` fallback for portability.
- **Leaving status badges dangling**: Always `cmux clear-status <key>` and `cmux clear-progress` when the task finishes.
- **Not scoping to workspace**: Pass `--workspace "${CMUX_WORKSPACE_ID}"` to target the right workspace.
