---
name: cmux
user-invocable: false
description: Use when controlling cmux topology — windows, workspaces, panes, surfaces, splits, focus, moves, reorders, flashes, settings, or config reloads. Also use when needing to identify the current cmux context or navigate between surfaces.
---

# cmux Core Control

Controls non-browser cmux topology: windows → workspaces → panes → surfaces.

## Hierarchy

| Unit | Description |
|------|-------------|
| **Window** | Top-level macOS cmux window |
| **Workspace** | Tab-like group inside a window |
| **Pane** | Split container inside a workspace |
| **Surface** | A terminal or browser tab within a pane |

Refs default to short form: `window:1`, `workspace:2`, `pane:3`, `surface:4`. UUIDs accepted on input; request with `--id-format uuids` only when needed.

## Fast Start

```bash
# Identify current caller context
cmux identify --json

# List topology
cmux tree --workspace workspace:2
cmux list-workspaces
cmux list-panes --workspace workspace:2
cmux list-pane-surfaces --pane pane:3

# Create
cmux new-workspace --name "feature" --cwd ~/projects/foo
cmux new-split right --workspace workspace:2
cmux new-pane --type terminal --direction right --workspace workspace:2 --focus false
cmux new-surface --type browser --pane pane:3 --url https://localhost:3000 --focus false

# Move & reorder
cmux move-surface --surface surface:7 --pane pane:2 --focus false
cmux split-off --surface surface:7 right --focus false
cmux reorder-surface --surface surface:7 --before surface:3

# Focus (only on explicit user request — see cmux-workspace)
cmux focus-pane --pane pane:3
cmux select-workspace --workspace workspace:2

# Close
cmux close-surface --surface surface:7
cmux close-workspace --workspace workspace:2

# Attention cue
cmux trigger-flash --surface surface:7
```

## Settings & Config

```bash
cmux docs settings              # print paths, schema URL, reload command
cmux settings path              # print cmux.json path
cmux settings cmux-json         # open cmux.json in UI
cmux reload-config              # reload cmux.json + Ghostty config, no restart needed
cmux config doctor              # validate config
```

cmux settings live in `~/.config/cmux/cmux.json`. Terminal rendering (font, theme, opacity, blur) belongs in `~/.config/ghostty/config`. Always back up `cmux.json` to a timestamped `.bak` before editing.

## Rename & Window Ops

```bash
cmux rename-workspace workspace:2 "My Feature"
cmux rename-tab --surface surface:5 "API tests"
cmux new-window
cmux move-workspace-to-window --workspace workspace:2 --window window:2
```

## Quick Checks

```bash
cmux ping                       # confirm socket alive
cmux version
cmux capabilities
cmux surface-health             # check surface state in workspace
```

## Common Mistakes

- **Focus-jacking**: Never call `select-workspace`, `focus-pane`, or `tab-action` with focus unless the user explicitly asked. See `cmux-workspace` skill for non-disruptive automation rules.
- **UUIDs by default**: Stick to short refs (`surface:N`). Only use `--id-format uuids` when the downstream consumer requires UUIDs.
- **Editing settings without backup**: Always `cp ~/.config/cmux/cmux.json ~/.config/cmux/cmux.json.bak.$(date +%s)` before editing.
