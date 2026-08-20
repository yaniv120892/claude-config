@~/.claude/shared-rules.md
@~/.claude/work-context.local.md

# Work Context

Employer-specific values — the real email, the real issue-key prefix, the actual
repo names — go in `~/.claude/work-context.local.md`, which this file imports and
this repo never tracks. That keeps confidential details off GitHub while letting
`install.sh` symlink this file like every other profile. The import is harmless
when the local file is absent, so a fresh machine still installs cleanly; create
it from the placeholders below.

- Work email: <you@company.com>
- Commit scopes follow the issue-tracker key format (e.g. `ABC-123`). Check which
  commit types trigger your release pipeline — where `feat`/`fix` deploy and
  `chore`/`refactor`/`docs` do not, use `fix` for a shippable change that reads
  like `chore`.
- Subagent prompts reference sibling repos under `~/Develop/` — always anchor a
  subagent to the target repo path and have it read that repo's CLAUDE.md first.
- The forge CLI here is `glab`; see the `pr-workflows` plugin (`references/forge-cli.md`).
