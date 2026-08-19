---
name: cmux-workspace
user-invocable: false
description: Use when automating inside the current cmux workspace without disrupting the user — scoping commands to caller context, building helper panes, avoiding focus changes, or working non-disruptively alongside the user.
---

# cmux Workspace — Non-Disruptive Automation

> Assumes the cmux basics (refs, `--json`, `identify`) from the **cmux** skill. This skill is the canonical reference for the `--focus false` non-disruptive convention.

Scope every action to the **caller workspace** unless the user explicitly requests a different target. An agent can run in workspace:3 while the user looks at workspace:1 — respect that.

## Read Caller Context First

```bash
# Read env vars (fastest — set automatically in cmux terminals)
printf 'workspace=%s\nsurface=%s\n' "${CMUX_WORKSPACE_ID:-}" "${CMUX_SURFACE_ID:-}"

# Fallback if env vars missing
cmux identify --json
```

Use `CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID` as anchors. If missing, use `cmux identify --json` output and be explicit you're using the focused context.

## Non-Disruptive Rules

Never call these without an **explicit user request**:

| Forbidden (without ask) | Why |
|-------------------------|-----|
| `select-workspace` | Switches the visible tab |
| `focus-pane` / `focus-panel` | Yanks pane focus |
| `tab-action` with focus | Steals user attention |

Pass `--focus false` on every command that supports it:

```bash
cmux new-pane --workspace "${CMUX_WORKSPACE_ID}" --type terminal --direction right --focus false
cmux move-surface --surface surface:7 --pane pane:2 --focus false
cmux new-surface --pane pane:3 --type browser --url http://localhost:3000 --focus false
```

Build layout in **one shot** — avoid create-then-move-then-focus chains.

## Right-Side Helper Pane Pattern

When opening auxiliary output (preview, logs, browser, TUI), keep the workspace clean:

```bash
# 1. Inspect existing panes
cmux identify --json
cmux list-panes --workspace "${CMUX_WORKSPACE_ID:-}" --json
cmux list-pane-surfaces --workspace "${CMUX_WORKSPACE_ID:-}" --pane pane:N --json

# 2a. Non-caller pane exists? Add a surface to it (don't create another split)
cmux new-surface --workspace "${CMUX_WORKSPACE_ID:-}" --pane pane:<helper> --type terminal --focus false

# 2b. No helper pane? Create exactly one to the right
cmux new-pane --workspace "${CMUX_WORKSPACE_ID:-}" --type terminal --direction right --focus false

# 3. Send work to the helper surface by explicit ref — never focus it
cmux send --surface surface:N "npm run dev\n"
```

Repeated "open it" calls → new tabs in the existing helper pane, not new splits.

## Send & Read

```bash
# Send text (append \n to simulate Enter)
cmux send --workspace "${CMUX_WORKSPACE_ID}" --surface surface:N "make build\n"
cmux send-key --surface surface:N "ctrl-c"

# Read terminal output
cmux read-screen --surface surface:N --lines 50
cmux read-screen --surface surface:N --scrollback --lines 200
```

## Common Mistakes

- **Creating a new pane when a helper already exists**: Check `list-panes` first.
- **Skipping `--focus false`**: Always pass it; omitting it silently steals focus.
- **Assuming focused workspace == caller workspace**: Always use `CMUX_WORKSPACE_ID` or `cmux identify`.
