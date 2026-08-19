---
name: cmux-agents
user-invocable: false
description: Use when setting up, managing, or troubleshooting cmux agent hook integrations — installing hooks for Claude Code, Codex, Gemini, OpenCode, or other agents, configuring Feed approvals, session restore, or understanding how the Feed bridge works.
---

# cmux Agent Integrations

> Assumes the cmux basics (refs, `--json`, `--focus false`, `identify`, `reload-config`) from the **cmux** skill.

cmux hooks give agents session restore, Feed approval cards, and lifecycle notifications. Claude Code is handled automatically via the cmux wrapper when Claude integration is enabled in Settings. All other agents are installed via `cmux hooks`.

## Install Hooks

```bash
# Install all agents found on PATH
cmux hooks setup

# Install one specific agent
cmux hooks setup --agent codex
cmux hooks setup opencode
cmux hooks setup gemini

# Project-local OpenCode Feed plugin (writes to .opencode/plugins/)
cmux hooks opencode install --project

# Uninstall
cmux hooks uninstall --agent codex
cmux hooks <agent> uninstall
```

## Supported Agents

| Agent | Binary | Feed trigger | Session restore |
|-------|--------|-------------|-----------------|
| Claude Code | `claude` (wrapper) | PermissionRequest | `claude --resume <id>` |
| Codex | `codex` | PermissionRequest | `codex resume <id>` |
| Gemini | `gemini` | PreToolUse | `gemini --resume <id>` |
| OpenCode | `opencode` | plugin event bus | `opencode --session <id>` |
| Grok | `grok` | PreToolUse | `grok -r <id>` |
| Cursor CLI | `cursor-agent` | beforeShellExecution | `cursor-agent --resume <id>` |
| Copilot | `copilot` | PreToolUse | `copilot --resume <id>` |
| Amp | `amp` | — (lifecycle only) | `amp threads continue <id>` |
| Pi | `pi` | — (lifecycle only) | `pi --session <id>` |
| Rovo Dev | `acli` | — (lifecycle only) | `acli rovodev run --restore <id>` |

## Feed: Inline Approvals

Feed surfaces agent permission requests, plan-mode decisions, and questions in the cmux right sidebar (`Ctrl-4`). No more digging into terminals — approve or deny from the sidebar.

```bash
# Launch Feed TUI
cmux feed tui

# View recent Feed activity
cmux events --category feed --category agent --reconnect

# Clear Feed history
cmux feed clear --yes
```

**Permission modes:** Once / Always / All tools / Bypass / Deny  
**Plan modes:** Ultraplan (refine with stronger model) / Manual / Auto / Deny  
**Timeout:** 120s — hook emits `{}` (no decision) if unanswered; agent falls back to its own TUI prompt.

## Session Restore

Sessions are saved to `~/.cmuxterm/<agent>-hook-sessions.json`. On cmux relaunch, each workspace is rebuilt and the agent resumes from its saved session ID.

To disable auto-resume (restore layout but not agent sessions):
```json
// ~/.config/cmux/cmux.json
{ "terminal": { "autoResumeAgentSessions": false } }
```

```bash
cmux reload-config    # apply after editing cmux.json
```

## Custom Surface Resume

Attach a resume command to the current terminal surface:
```bash
cmux surface resume set "my-command --resume-flag"
cmux surface resume show
cmux surface resume clear
```

## Disable Hooks for One Process

```bash
CMUX_CLAUDE_HOOKS_DISABLED=1 claude     # Claude Code
CMUX_CODEX_HOOKS_DISABLED=1 codex       # Codex
CMUX_GEMINI_HOOKS_DISABLED=1 gemini     # Gemini
CMUX_OPENCODE_HOOKS_DISABLED=1 opencode # OpenCode
```

## Troubleshoot

```bash
# Reinstall one integration cleanly
cmux hooks <agent> install --yes

# Check saved sessions
cat ~/.cmuxterm/<agent>-hook-sessions.json

# Confirm Feed bridge is active
cmux events --category feed --limit 5

# Verify hook file exists
cat ~/.codex/hooks.json           # Codex
cat ~/.gemini/settings.json       # Gemini
cat ~/.config/opencode/plugins/cmux-feed.js  # OpenCode
```

**Feed shows nothing?** Confirm `CMUX_SURFACE_ID` is set in the terminal and the hook file contains `cmux hooks feed --source <agent>`.

**Session not restoring?** Check `~/.cmuxterm/<agent>-hook-sessions.json` for the saved session and verify the agent's resume command works standalone outside cmux.
