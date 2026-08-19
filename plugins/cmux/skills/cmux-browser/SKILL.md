---
name: cmux-browser
user-invocable: false
description: Use when automating a browser inside cmux — opening URLs, navigating, clicking, filling forms, waiting for page state, taking screenshots, extracting data, or managing browser surfaces and tabs within a cmux layout.
---

# cmux Browser Automation

> Assumes the cmux basics (refs, `--json`, `--focus false`, `identify`) from the **cmux** skill.

Drive browser surfaces embedded in cmux workspaces — open sites, interact with pages, extract data.

## Core Workflow

1. Open or target a browser surface
2. Verify URL with `get url` before acting
3. Snapshot (`--interactive`) to get fresh element refs (`e1`, `e2`, …)
4. Act with refs (`click`, `fill`, `type`, `select`, `press`)
5. Wait for state changes after navigation or mutations
6. Re-snapshot after DOM changes

```bash
# Open (routed to current workspace by default)
cmux --json browser open https://example.com
# → returns surface:N ref; use it for all subsequent commands

cmux browser surface:7 get url
cmux browser surface:7 wait --load-state complete --timeout-ms 15000
cmux browser surface:7 snapshot --interactive
cmux browser surface:7 fill e1 "hello@example.com"
cmux --json browser surface:7 click e2 --snapshot-after
```

## Surface Targeting

```bash
# Open in a specific workspace/pane/window
cmux --json browser open https://app.example.com \
  --workspace workspace:2 --pane pane:3 --focus false

# Target an existing surface
cmux browser surface:5 snapshot --interactive
```

## Wait Patterns

```bash
cmux browser surface:7 wait --selector "#ready" --timeout-ms 10000
cmux browser surface:7 wait --text "Success" --timeout-ms 10000
cmux browser surface:7 wait --url-contains "/dashboard" --timeout-ms 15000
cmux browser surface:7 wait --load-state complete --timeout-ms 15000
cmux browser surface:7 wait --function "document.readyState === 'complete'" --timeout-ms 10000
```

## Interaction

```bash
# Click / hover / focus
cmux browser surface:7 click e3 --snapshot-after
cmux browser surface:7 dblclick e3
cmux browser surface:7 hover e5

# Fill / clear
cmux browser surface:7 fill e1 "Jane Doe"
cmux browser surface:7 fill e11 ""           # empty string clears input

# Type / key
cmux browser surface:7 type e2 "hello"
cmux browser surface:7 press "Enter"
cmux browser surface:7 keydown "Shift"

# Select dropdown
cmux browser surface:7 select e4 "option-value"

# Scroll
cmux browser surface:7 scroll --dy 500
cmux browser surface:7 scroll --selector ".list" --dy 300
```

## Extract Data

```bash
cmux browser surface:7 get title
cmux browser surface:7 get url
cmux browser surface:7 get text e1
cmux browser surface:7 get html e1
cmux browser surface:7 get value e2
cmux browser surface:7 get attr e3 href
cmux browser surface:7 is visible e4
cmux browser surface:7 is checked e5
cmux browser surface:7 find role button --text "Submit"
```

## Screenshot & State

```bash
cmux browser surface:7 screenshot --out /tmp/page.png
cmux browser surface:7 snapshot --compact --max-depth 3
cmux browser surface:7 state save /tmp/browser-state.json
cmux browser surface:7 state load /tmp/browser-state.json
```

## Navigation

```bash
cmux browser surface:7 goto https://example.com/page
cmux browser surface:7 back
cmux browser surface:7 forward
cmux browser surface:7 reload
```

## Tabs & Frames

```bash
cmux browser surface:7 tab new
cmux browser surface:7 tab list
cmux browser surface:7 tab switch 2
cmux browser surface:7 tab close 1
cmux browser surface:7 frame "#nested-iframe"
cmux browser surface:7 frame main              # back to main frame
```

## Dialogs & Downloads

```bash
cmux browser surface:7 dialog accept
cmux browser surface:7 dialog dismiss "cancel"
cmux browser surface:7 download wait --path /tmp/file.csv --timeout-ms 30000
```

## Common Flows

### Form Submit
```bash
cmux --json browser open https://example.com/signup
cmux browser surface:7 wait --load-state complete --timeout-ms 15000
cmux browser surface:7 snapshot --interactive
cmux browser surface:7 fill e1 "Jane Doe"
cmux browser surface:7 fill e2 "jane@example.com"
cmux --json browser surface:7 click e3 --snapshot-after
cmux browser surface:7 wait --url-contains "/welcome" --timeout-ms 15000
```

### Scrape Table Data
```bash
cmux browser surface:7 wait --selector "table" --timeout-ms 10000
cmux browser surface:7 get text e1     # e1 = table from snapshot
```

## Common Mistakes

- **Acting before load**: Always `wait --load-state complete` before first snapshot.
- **Stale element refs**: Re-snapshot after any navigation or major DOM mutation.
- **Not scoping the surface**: Keep one `surface:N` ref per task; don't switch surfaces mid-flow without re-identifying.
- **Forgetting `--focus false`**: Pass it on `browser open` when you don't want to steal focus.
