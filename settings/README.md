# Settings

`settings.json` is the profile-neutral baseline: permissions, model, effort,
statusline, and the pre-push quality-gate hook. It contains **no secrets** and no
employer-specific servers or plugins.

## What is deliberately not here

| Excluded | Why | How to restore |
| --- | --- | --- |
| `env` with API tokens | Secrets must never be tracked | Export them from your shell profile instead |
| Employer MCP servers | Company-specific | See `../mcp/mcp.json.example` |
| Employer plugin marketplaces | Company-specific | `/plugin marketplace add <url>` on the work machine |
| Corporate security hooks | Installed by the security agent itself | Reinstalls automatically |
| `skillOverrides` | Machine-specific taste; regenerate as you go | `/config` |

## Secrets

Anything secret goes in the environment, not in `settings.json`:

```sh
# ~/.zshrc — not tracked in this repo
export SOME_API_KEY="..."
```

Claude Code expands `${VAR}` inside `.mcp.json`, so a server can reference an env
var without the value ever landing in a file.
