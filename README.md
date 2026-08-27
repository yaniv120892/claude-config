# claude-config

Portable Claude Code configuration that travels between machines. This repo is
**both a plugin marketplace and a small dotfiles install**, because Claude Code
splits configuration into two halves that install differently.

Everything here is **project-agnostic** — nothing is tied to a particular
employer, forge, or issue tracker — and **no secrets are tracked**.

## The two halves

| Half | Ships as | Why |
| --- | --- | --- |
| Skills, commands, hooks | **Plugins** (3) | Plugins are the supported mechanism: versioned, per-profile toggles, `/plugin update`, namespaced, and installing one never touches your existing skills |
| Global rules, settings, keybindings, statusline | **Symlinks** via `install.sh` | Plugins cannot provide always-loaded `CLAUDE.md` instructions, `paths:`-scoped `rules/*.md`, `settings.json`, or a statusline |

## Install on a new machine

```sh
git clone git@github.com:yaniv120892/claude-config.git ~/Develop/claude-config
cd ~/Develop/claude-config

# Half 1 — rules, settings, keybindings, statusline
./install.sh --dry-run      # see exactly what would change
./install.sh                # personal profile → ~/.claude

# Half 2 — skills, commands, hooks
claude
/plugin marketplace add yaniv120892/claude-config
/plugin install pr-workflows@yaniv-claude-config
/plugin install dev-workflows@yaniv-claude-config
/plugin install issue-tracker@yaniv-claude-config
/plugin install infra-workflows@yaniv-claude-config
/plugin install cmux@yaniv-claude-config
```

`install.sh` symlinks, so editing a file here takes effect immediately and
`git status` is the single source of truth for what you've changed. The exception
is `settings.json`, which is copied once and never overwritten, because Claude
Code writes machine-local state into it. Anything replaced is moved to
`~/.claude-config-backups/<timestamp>/` first.

Add `--profile work` or `--target ~/.claude-personal` for a second profile.

## The plugins

| Plugin | Skills | What it does |
| --- | --- | --- |
| `pr-workflows` | 14 | Forge-agnostic change-request workflow: create, review, inline comments, CI verification, thread resolution, conflict fixing, feedback harvesting, posting an MR to Slack. Ships `/pr-review`, `lib/forge.py`, and `references/forge-cli.md` |
| `dev-workflows` | 15 | Brainstorming, plan writing and execution, TDD, subagent-driven development, worktree isolation, Docker-based service runs, drip-feed recurring maintenance, and `syncing-claude-config`. Ships the pre-push quality-gate hook |
| `issue-tracker` | 3 | Jira ticket creation and status transitions, with a cached per-project transition map. Also files Linear issues against a fixed Why/Repro/Fix/Done-when/Signals template |
| `infra-workflows` | 2 | Helm env vars across GitOps registries, and AWS SSM SecureString provisioning with an account guard. Ships `provision_ssm.sh` |
| `cmux` | 5 | cmux terminal multiplexer control: topology, workspaces, browser surface, notifications |

Plugins that touch an employer's systems read their site-specific values — accounts,
project keys, Slack channels, repo paths — from a machine-local
`~/.claude/<plugin>.config.json`. Each ships a `config.example.json` showing the shape,
and never the values. Moving to a new employer is a config swap, not a skill rewrite.

Enable or disable a whole plugin per profile through `enabledPlugins` in
`settings.json` — that replaces maintaining a `skillOverrides` list of individual
skill names.

### Forge-agnostic by construction

The PR skills detect GitHub or GitLab from the origin remote and drive `gh` or
`glab` accordingly. Their scripts share `lib/forge.py`, which normalises the
parts the forges genuinely disagree on — inline-comment position payloads, thread
resolution (REST on GitLab, GraphQL on GitHub), and merge-base resolution — and
routes every API call through `gh api` / `glab api` so **no script ever reads a
token**.

```sh
# smoke-test the forge layer from inside any repo
python3 ~/.claude/plugins/.../pr-workflows/lib/forge.py
# → forge=github cli=gh repo=owner/name
```

Scripts resolve `${CLAUDE_PLUGIN_ROOT}` when installed and fall back to walking up
to the plugin root when run straight from a clone, so both work.

## Rules (the non-plugin half)

`shared-rules.md` loads on every prompt and holds only what is universal:
developer context, the rule-codification protocol, file-path convention,
conventional commits, and subagent conventions.

Everything else is **path-scoped** — each file in `rules/` has a `paths:`
frontmatter list and loads only when Claude reads a matching file, so a large
rule set costs nothing on unrelated prompts.

| File | Loads on | Covers |
| --- | --- | --- |
| `code.md` | ts, tsx, js, jsx, mjs, cjs, py, go, java, rb, sql, sh, bash | Language-agnostic craft: comments, naming, control flow, guards, error handling |
| `typescript.md` | ts, tsx | Typing, `as` casts, derived types, access modifiers, type placement |
| `python.md` | py | Type hints, Google docstrings, import order, tool-function error returns |
| `config.md` | env, tf, tfvars, settings.json, compose, values, CI yaml | Secret handling, environment-variable wiring |
| `authoring-docs.md` | md, mdx | How to write rules and docs |

Verify what actually loaded in a session with `/context`.

## Layout

```
.claude-plugin/marketplace.json   the marketplace manifest
plugins/<name>/                   one directory per plugin
  .claude-plugin/plugin.json      plugin manifest
  skills/ commands/ hooks/ lib/ references/
shared-rules.md                   → ~/.claude/shared-rules.md
rules/*.md                        → ~/.claude/rules/
rules-reference.md                → ~/.claude/rules-reference.md
profiles/<name>/CLAUDE.md         → <profile>/CLAUDE.md
settings/settings.json            → <profile>/settings.json (copied)
keybindings.json statusline-command.sh
install.sh                        installs the non-plugin half only
```

## Two profiles

Claude Code picks its config directory from `CLAUDE_CONFIG_DIR`:

```sh
alias claude-work='CLAUDE_CONFIG_DIR=~/.claude claude'
alias claude-personal='CLAUDE_CONFIG_DIR=~/.claude-personal claude'
```

Both profiles share `shared-rules.md`, `rules/`, and `rules-reference.md`, which
always install under `~/.claude` because `CLAUDE.md` imports them by absolute path
(`@~/.claude/shared-rules.md`). Only `CLAUDE.md`, `keybindings.json`, and
`settings.json` are profile-scoped — plus whichever plugins each profile enables.

The work profile carries no employer details. `profiles/work/CLAUDE.md` imports
`~/.claude/work-context.local.md`, which this repo never tracks — put the real
email, issue-key prefix, and repo names there. Without it the profile still
installs and reads as placeholders, so the repo stays publishable and a fresh
machine is one file away from being fully configured.

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

## Adding things

**A skill, command, or hook** → the matching plugin under `plugins/`, then bump
that plugin's `version` in its `plugin.json` so `/plugin update` picks it up.

**A rule** → decide scope first, per the protocol in `shared-rules.md`:
every session → `shared-rules.md`; a language or file type → `rules/*.md` (needs
`paths:`); one project → that repo's `.claude/rules/`. Add the long-form version
with worked examples to `rules-reference.md` either way.
