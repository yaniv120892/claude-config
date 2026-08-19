# claude-config

Portable Claude Code configuration — rules, skills, commands, hooks, and settings.
Clone it on a new machine, run `./install.sh`, and the setup is back.

Everything here is **project-agnostic**. Nothing is tied to a particular employer,
forge, or issue tracker, and **no secrets are tracked** — see [Secrets](#secrets).

## Install

```sh
git clone git@github.com:<you>/claude-config.git ~/Develop/claude-config
cd ~/Develop/claude-config
./install.sh --dry-run          # see exactly what would change
./install.sh                    # personal profile → ~/.claude
```

Other profiles and targets:

```sh
./install.sh --profile work                          # work profile → ~/.claude
./install.sh --target ~/.claude-personal             # a second profile dir
```

Files are **symlinked**, so editing one here takes effect immediately and
`git status` is the single source of truth for what you've changed. The exception
is `settings.json`, which is copied once and never overwritten, because Claude
Code writes machine-local state into it.

Anything replaced is moved to `~/.claude-config-backups/<timestamp>/` first.

> ⚠️ `install.sh` links the **whole** `skills/` directory. On a machine that also
> has skills not tracked here (employer-specific ones), those are moved into the
> backup directory rather than deleted. Move them back afterwards, or keep them in
> a separate profile directory.

## Two profiles

Claude Code picks its config directory from `CLAUDE_CONFIG_DIR`, so you can run
separate personal and work setups on one machine:

```sh
alias claude-work='CLAUDE_CONFIG_DIR=~/.claude claude'
alias claude-personal='CLAUDE_CONFIG_DIR=~/.claude-personal claude'
```

Both profiles share `shared-rules.md`, `rules/`, `references/`, and `lib/`, which
always install under `~/.claude` because `CLAUDE.md` imports them by absolute path
(`@~/.claude/shared-rules.md`). Only `CLAUDE.md`, `skills/`, `commands/`,
`keybindings.json`, and `settings.json` are profile-scoped.

## Layout

| Path | Installs to | What it is |
| --- | --- | --- |
| `shared-rules.md` | `~/.claude/shared-rules.md` | Always-loaded global rules |
| `rules/*.md` | `~/.claude/rules/` | Path-scoped rules — load only when a matching file is read |
| `rules-reference.md` | `~/.claude/rules-reference.md` | Long-form rationale; read on demand, never inlined |
| `references/forge-cli.md` | `~/.claude/references/` | GitHub ↔ GitLab command mapping |
| `lib/forge.py` | `~/.claude/lib/` | Forge-agnostic PR/MR helper used by the skill scripts |
| `skills/` | `<profile>/skills/` | 29 skills |
| `commands/` | `<profile>/commands/` | Slash commands |
| `hooks/` | `~/.claude/hooks/` | `pre-push-quality-gate.sh` |
| `profiles/<name>/CLAUDE.md` | `<profile>/CLAUDE.md` | Profile context, imports the shared rules |
| `settings/settings.json` | `<profile>/settings.json` | Baseline settings (copied, not linked) |
| `mcp/mcp.json.example` | — | Template for `.mcp.json` |
| `statusline-command.sh` | `~/.claude/` | Status line: dir, branch, model, context % |

## Rules

`shared-rules.md` loads on every prompt and holds only what is universal:
developer context, the memory/rule-codification protocol, file-path convention,
conventional commits, and subagent conventions.

Everything else is **path-scoped** — each file in `rules/` has a `paths:` frontmatter
list and loads only when Claude reads a matching file, so a large rule set costs
nothing on unrelated prompts.

| File | Loads on | Covers |
| --- | --- | --- |
| `code.md` | ts, tsx, js, jsx, mjs, cjs, py, go, java, rb, sql, sh, bash | Language-agnostic craft: comments, naming, control flow, guards, error handling |
| `typescript.md` | ts, tsx | Typing, `as` casts, derived types, access modifiers, type placement |
| `python.md` | py | Type hints, Google docstrings, import order, tool-function error returns |
| `config.md` | env, tf, tfvars, settings.json, compose, values, CI yaml | Secret handling, environment-variable wiring |
| `authoring-docs.md` | md, mdx | How to write rules and docs |

Verify what actually loaded in a session with `/context`.

## Skills

Read `REVIEW.md` for what each skill is, why it survived, and what was dropped.

The PR/MR skills are **forge-agnostic**: they detect GitHub or GitLab from the
origin remote and use `gh` or `glab` accordingly. Their scripts share
`lib/forge.py`, which normalises the parts the two forges genuinely disagree on —
inline-comment position payloads, thread resolution (REST on GitLab, GraphQL on
GitHub), and merge-base resolution.

```sh
# smoke-test the forge layer from inside any repo
python3 ~/.claude/lib/forge.py
# → forge=github cli=gh repo=owner/name
```

## Secrets

**Nothing secret is tracked here, and nothing secret should ever be added.**
`.mcp.json`, `settings.local.json`, and `.env*` are gitignored.

Put credentials in your shell profile and reference them:

```sh
# ~/.zshrc — not tracked
export ATLASSIAN_API_TOKEN="..."
```

Claude Code expands `${VAR}` inside `.mcp.json`, so a server config can reference
an env var without the value landing in a file. See `mcp/mcp.json.example`.

If a secret ever does get committed, rotate it — deleting the line is not enough.

## Adding a rule

Follow the protocol in `shared-rules.md`: decide the scope first.

- Applies to every session → `shared-rules.md`
- Applies to a language or file type → the matching `rules/*.md` (needs `paths:`)
- Applies to one project → that repo's `.claude/rules/` (also needs `paths:`)

Add the long-form version with worked examples to `rules-reference.md` either way.
