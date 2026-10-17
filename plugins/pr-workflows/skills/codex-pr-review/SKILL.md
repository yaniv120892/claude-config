---
name: codex-pr-review
description: Use when asked for a second-model review of one or more pull requests — "ask Codex to review the PRs", "another model's review", "get a GPT review", "cross-model review". Runs `codex review` locally on each PR's branch in parallel, then verifies every finding and either fixes and pushes it or records a push-back. Nothing is posted to GitHub. Needs the Codex CLI signed in; for a Claude review use pr-review.
---

# Codex PR Review — a second model's review, triaged

A different model misses different things. This runs the Codex CLI's own reviewer on each PR, then
treats its output the way `address-pr-feedback` treats a reviewer: **a suggestion to verify, not an
order.** Use `superpowers:receiving-code-review` for the judgment.

**Data boundary:** `codex review` sends the PR's diff and the files it reads to OpenAI. Confirm the
repo may go there before the first run in a new org.

## Step 1 — Resolve each target

Targets are PR numbers or URLs (`owner/repo#N`); with none given, ask which PRs. For each:

```bash
gh pr view <n> --repo <slug> --json headRefName,baseRefName,headRefOid,state
```

Skip merged/closed PRs and say so. Find a worktree already on the head branch
(`git -C <clone> worktree list`); otherwise add one at `<clone>/.claude/worktrees/codex-<n>` on the
branch. `git fetch origin <head> <base>` in it and make sure it sits at `headRefOid` with a clean tree.

## Step 2 — Run Codex on all PRs in parallel

Pin the model so every run is the same reviewer: read `model` and `model_reasoning_effort` from
`~/.codex/config.toml`, unless the user named one. One background Bash call per PR, all in one message:

```bash
cd <worktree> && codex review --base origin/<baseRefName> \
  -c model="<model>" -c review_model="<model>" -c model_reasoning_effort="<effort>" \
  > <scratchpad>/codex-<repo>-<n>.md 2>&1
```

`--base` must be the PR's own base: a stacked PR reviewed against `main` re-reviews the PR below it.
Codex reads the repo's `AGENTS.md`, so it reviews against the same rules. Runs take minutes; wait for
the completion notifications rather than polling.

## Step 3 — Triage, one subagent per PR

Dispatch one subagent per PR in a single message, with: the worktree path, the Codex output file, the
PR's ticket key, and these instructions — read the repo's `CLAUDE.md` first, then for each finding open
the code at its anchor and decide:

- **fix** — the concern is real here. Make the smallest change, add or adjust a test that would fail
  without it, run the repo's own typecheck/lint/tests for what changed.
- **push back** — wrong for this codebase, already handled, out of scope, or speculative. Record the
  evidence (file:line, the guard that already covers it, the SDK type).
- **duplicate** — already fixed or answered on the PR (check `gh api repos/<slug>/pulls/<n>/comments`).

Commit fixes on the PR's source branch as `fix(<ticket>): <what>` and push — never force-push, never a
new branch. Return a table: finding, file:line, verdict, action/reason, commit SHA.

**Stacked PRs:** triage the lowest PR first. After it pushes a fix, merge its branch into the PR above
(normal merge) before that one's subagent commits, so the stack stays consistent.

## Step 4 — Report

One table per PR: | Finding | file:line | Verdict | Action |. Then the totals (fixed / pushed back /
duplicate) and the pushed SHAs.

Nothing goes to GitHub by default. Offer, once, to post the push-backs as a single PR comment
("Codex review: N findings, fixed X in <sha>, declined Y because …") — post only on a yes.

## Common mistakes

| Mistake | Fix |
|---|---|
| Applying every Codex finding | Verify each against the code; most second-model findings are style or already guarded |
| `--base main` on a stacked PR | Use the PR's own `baseRefName` |
| Letting each run pick its own model | Pin `model` and `review_model` from the config |
| Running in a dirty or stale worktree | Fetch and confirm `headRefOid` first — Codex reviews what is on disk |
| Posting findings to the PR unasked | Local by default; one offer to post, at the end |
