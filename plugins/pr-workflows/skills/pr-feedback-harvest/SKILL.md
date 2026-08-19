---
name: pr-feedback-harvest
description: Use when reviewing recurring pull/merge request review feedback to turn it into rules/skills/hooks — e.g. a sprint/bi-weekly retro on PR comments, finding patterns reviewers repeat, or measuring whether a codified rule reduced a class of comments over time. Works across GitHub orgs and GitLab groups (subgroups included) for change requests you authored and merged.
---

# MR Feedback Harvest

## Delegate to a Sonnet subagent

**Do not run the harvest/bucketing inline.** This mines potentially many MRs' worth of comments into a large JSON blob and buckets it against a fixed taxonomy/mechanism table — well-specified enough to not need this session's model tier or its accumulated context.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched pr-feedback-harvest subagent, skip this section and go straight to **Overview** below.

Otherwise, spawn a subagent to run the full flow:

```
Agent({
  description: "Harvest MR feedback",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the pr-feedback-harvest subagent. Invoke the pr-feedback-harvest
    skill yourself and follow it directly end-to-end — you are the dispatched
    subagent, so do not delegate further. Groups: <groups>. Since-days: <window>.
    Out-dir: <path>. Return the bucketed themes with mechanism recommendations and
    the diff against the previous run."
})
```

Relay the subagent's report to the user.

## Overview

Mine review comments from your recently-merged MRs, bucket them into recurring themes, and map each theme to the cheapest prevention (rule / skill / hook). Re-run each sprint and diff against the last report to see whether codified rules are actually shrinking a theme's comment count. That diff IS the feedback loop.

## When to use

- "What feedback do I keep getting on PRs?" / sprint retro on review comments
- Deciding whether a recurring comment justifies a new rule/skill/hook
- Checking if a rule you added last sprint reduced the comments it targeted

Requires an authenticated `gh` or `glab` on PATH. The forge is detected from the repository's origin remote; override with `--forge`.

## Step 1 — Harvest

```bash
python3 scripts/harvest.py \
  --scope <github-org-or-gitlab-group> \
  --scope <another-scope> \
  --exclude-repo <repo-substring> \
  --since-days 14 \
  --out-dir ./retro
```

A `--scope` is a GitHub org/user or a GitLab group path (subgroups included) and
is repeatable. Writes `pr-feedback-<since-date>.json` and prints the
human/self/noise counts. `--author` defaults to the authenticated user.

On GitHub the search API refuses to page past 1000 results; the script warns when
it hits that ceiling rather than silently truncating the window.

## Step 2 — Read the buckets, not the counts

⚠️ **The #1 trap: raw comment counts are dominated by noise.** Release bots post an announcement per change request, and CI service accounts post more. The script already filters authors matching `service_account`, `_bot_`, `semantic-release`, `[bot]`, GitHub `Bot`-type users, and GitLab `system` notes. The real signal is two buckets:

- **`human`** — teammate reviewer comments (the prevention gold)
- **`self`** — your own self-review threads (review-style question + your answer/fix); these reveal what you catch manually and could automate

If a real source still leaks into `noise`, add its author substring to `NOISE_AUTHOR_SUBSTRINGS` in the script. Also scan **MR titles** for `AIP-0` (ticketless), `chore`/`docs` (may skip pipeline/release), `revert` (insufficient pre-merge check), and "cleanup/post-review" (issues that escaped review).

## Step 3 — Bucket into themes & map to a mechanism

For each cluster: count occurrences, collect permalinks, name the root cause, pick the **strongest fitting** mechanism.

| Mechanism | Use when | Example target |
|---|---|---|
| **Rule** | a written preference will steer the agent | `~/.claude/shared-rules.md`, `<repo>/.claude/rules/<topic>.md` |
| **Skill** | a repeatable procedure is needed | extend `writing-pr-description`, `creating-prs`, `pre-push-quality-gate` |
| **Hook** | mechanically enforceable (regex/validation) | PreToolUse Bash guard, commit-msg check |

Split findings into **General** (cross-repo / agent behavior) vs **Repo-specific**. Recurring themes seen in this codebase (seed taxonomy — extend over time): agent/worktree artifacts in diffs (`.claude/`, worktree `.eslintrc.js`), missing "why" rationale for removals, CLAUDE.md prefs not applied up front, commit-type pipeline effects, int-vs-float at API boundaries, Temporal error unwrapping, log-level discipline, MUI visual regressions.

## Step 4 — Diff against last run (the loop)

Compare this report's per-theme counts to the previous `pr-feedback-<date>.json`. **New** themes → candidate rules. Themes that **shrank** after a rule landed → the rule works. Themes that **persist** → the mechanism was too weak (promote rule → skill → hook).

## Common mistakes

- Trusting `user_notes_count` or skipping the noise filter → "lots of comments" that are all release bots.
- Treating `self` notes as worthless — they're your manual review loop and the best automation candidates.
- Codifying a one-off as a rule. Require a real cluster (judgment, not a hard threshold), and prefer the cheapest mechanism that fits.
