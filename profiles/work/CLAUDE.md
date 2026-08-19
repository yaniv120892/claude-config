@~/.claude/shared-rules.md

# Work Context

Fill these in per employer; keep anything confidential out of this repo.

- Work email: <you@company.com>
- Commit scopes follow the issue-tracker key format (e.g. `ABC-123`). Check which
  commit types trigger your release pipeline — where `feat`/`fix` deploy and
  `chore`/`refactor`/`docs` do not, use `fix` for a shippable change that reads
  like `chore`.
- Subagent prompts reference sibling repos under `~/Develop/` — always anchor a
  subagent to the target repo path and have it read that repo's CLAUDE.md first.
- The forge CLI here is `glab`; see `~/.claude/references/forge-cli.md`.
