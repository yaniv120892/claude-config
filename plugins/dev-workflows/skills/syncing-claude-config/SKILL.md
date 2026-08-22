---
name: syncing-claude-config
disable-model-invocation: true
description: Audit ~/.claude for configuration that has drifted out of the claude-config repo — uncommitted edits, and skills/commands/agents that are local-only — then ship what the user approves via PR to main. Use when asked to "sync claude config", "ship my config", or after adding or editing a skill, command, agent, rule, or setting.
---

# Syncing claude-config

Find configuration that exists on this machine but not in the repo, then ship what the
user approves.

**Invoked explicitly, never automatically.** Config is often mid-improvement, and shipping
a half-finished experiment is worse than leaving it local for another hour. The user
decides when it's ready — that is why this is a command and not a hook.

## Why drift happens

`install.sh` **symlinks** the repo into `~/.claude` rather than copying. An edit therefore
takes effect immediately, which is exactly why nothing ever signals that it was never
pushed: the change works, so it feels finished. The feedback loop that would normally
catch an unfinished change is the very thing the symlink removes.

There are two distinct kinds of drift, and only one of them is visible to git:

| Kind | Where | Does `git status` see it? |
| --- | --- | --- |
| Edited a tracked file | anywhere in the repo | **Yes** |
| Created a skill/command/agent directly in `~/.claude` | `~/.claude/{skills,commands,agents}` | **No** — the installer leaves these alone by design, so they are neither symlinked nor tracked |

The second kind is invisible and unbounded. Check for it every run.

## Step 1 — Audit

Repo path is `~/Develop/claude-config` unless the user says otherwise.

```bash
git -C ~/Develop/claude-config status --porcelain          # tracked drift
git -C ~/Develop/claude-config log --oneline origin/main..main   # committed, unpushed
```

For local-only items, list anything under `~/.claude/skills`, `~/.claude/commands`, and
`~/.claude/agents` that is **not a symlink**:

```bash
find ~/.claude/skills ~/.claude/commands ~/.claude/agents \
     -maxdepth 1 -mindepth 1 ! -type l 2>/dev/null
```

For each local-only item, read its description and propose a destination:

- **Generic** → an existing plugin (`dev-workflows`, `pr-workflows`, `infra-workflows`,
  `issue-tracker`) or a new one, with employer-specific values pulled out into a
  machine-local `~/.claude/<name>.config.json` and a `config.example.json` committed
  alongside. This is what keeps a skill portable to the next employer.
- **Employer-specific** → a work plugin, or deliberately left local.
- **Superseded** → say what already covers it. Prefer retiring a near-duplicate over
  shipping a second copy that will drift from the first.

## Step 2 — Report, and let the user choose

Present the findings grouped by kind, each with its proposed destination and a one-line
reason. Then **stop and ask** what to ship: all, a subset, or nothing.

Do not skip this because the list looks obvious. Some of what is dirty is deliberately
unfinished, and only the user knows which.

## Step 3 — Ship what was approved

For each approved group, delegate to a subagent (the work is mechanical and doesn't need
the parent session's context):

```
Agent({
  description: "Ship claude-config change",
  prompt: "Repo: /Users/<user>/Develop/claude-config. Read its CLAUDE.md and
    shared-rules.md first. Move <items> to <destination>, update the plugin manifest and
    .claude-plugin/marketplace.json, then branch, commit, push, open a PR, squash-merge
    it, and fast-forward local main. Commit ONLY the paths for this change."
})
```

Rules that apply to every such change:

- **Commit only the paths this change touches.** The repo routinely carries unrelated
  dirty files from earlier sessions; `git stash push <paths>` them, commit yours, then
  pop. Sweeping someone's unfinished rule into your PR mislabels it as reviewed.
- **Branch → PR → squash-merge → `git pull --ff-only` on main.** Never commit straight to
  `main`, never force-push. The PR is what gives the change a title and a rationale worth
  reading later.
- **Moving a skill into a plugin is not just a `git mv`** — update the plugin's
  `plugin.json`, add the plugin to `.claude-plugin/marketplace.json` if it's new, and
  strip employer-specific values into config.

## Step 4 — Verify, then report

Confirm the repo is clean apart from anything deliberately left, and that `main` is level
with `origin/main`:

```bash
git -C ~/Develop/claude-config status --short
git -C ~/Develop/claude-config log --oneline -1
```

Report the PR URLs, what shipped, and — explicitly — what was left behind and why. An
item deliberately left local is a decision worth recording, not an omission to stay quiet
about.
