@~/.claude/shared-rules.md

# Personal Context

- Personal projects are on GitHub and track work in Linear, team `YAN`. No Jira, no GitLab
  pipelines.
- `gh` is the CLI here; see the `pr-workflows` plugin.

**Every PR Names Its Linear Ticket** — the ID in the title links the PR to Linear, and the
squash merge carries it onto `main`, so every shipped change traces back to its ticket
> Pattern: Title the PR `<type>(YAN-123): <description>` — the ticket ID is the
> conventional-commit scope. Branch from the ticket's Linear git branch name, and end the
> body with `Fixes YAN-123` so the merge closes it (`Part of YAN-123` for one slice of it).
> With no ticket yet, create one in team `YAN` through the Linear MCP before opening the PR,
> unattended runs included.
> Avoid: An area slug where the ID belongs; `YAN-0` or a guessed number; opening the PR first
> and retitling it later.
