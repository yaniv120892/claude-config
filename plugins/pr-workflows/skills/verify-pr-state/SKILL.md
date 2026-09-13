---
name: verify-pr-state
description: Monitor a pull request's CI and act on the outcome — enable auto-merge when it passes, report and fix the failure when it doesn't. Use when checking a PR's CI status, setting it to merge automatically once green, or asking whether it is ready to merge.
---

# Verify Pull Request State & Auto-Merge

## Overview

Monitors a pull request's CI and takes action based on the outcome:
- **CI passing** → enable auto-merge (merge when CI succeeds, or merge immediately if it already passed).
- **CI failing** → inspect the failure, attempt a fix (lint, type errors, etc.), push the fix, and re-check.

**Announce at start:** "I'm using the verify-pr-state skill."

## Inputs

The user provides a pull request URL or a bare number.

`https://github.com/<owner>/<repo>/pull/2452` — repo slug is `<owner>/<repo>`,
number is the trailing integer. Given a bare number, the slug comes from
`git remote get-url origin`.

## Step 1 — Get CI state

The shared helper collapses every check run into one state word:

```bash
python3 ../verify-resolve-pr-comments/pr_review_comments.py ci --pr <NUMBER> [--repo <slug>]
```

It prints `{"state": "success|failed|running|unknown", "web_url": ...}`. Prefer
it over `gh pr checks`, whose output has to be read check-by-check rather than
as a single verdict.

Drop to `gh` itself only when you need detail the state word does not carry,
such as which specific job failed (Step 3 does exactly that).

## Step 2 — Branch on state

### unknown → stop, do not treat as green

The commit reported no check runs at all. That is a repo whose CI posts through
the legacy commit-status API (Jenkins, CircleCI classic), or the gap before the
first check registers — never evidence that CI passed. Say the state is unknown
and why, check `gh pr checks <NUMBER> --repo <slug>` for statuses the check-runs
API does not carry, and **never enable auto-merge from here**.

### running / pending

Schedule a wakeup in **5 minutes** using `ScheduleWakeup` with the original /loop prompt, passing the pull request URL as context. Narrate: "CI still running — rechecking in 5 min."

### success → enable auto-merge

```bash
gh pr merge <NUMBER> --auto --squash
```

If the branch is already merged, report it and stop. After enabling auto-merge,
schedule a final status check in **10 minutes** to confirm it closed.

### failed → investigate and fix

**Delegate the diagnose-and-fix work to a Sonnet subagent.** Reading CI logs, categorizing the failure, and applying lint/type fixes is well-specified enough to not need this session's model tier — keep only the pipeline-check/loop-scheduling logic (ScheduleWakeup) in this conversation.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched subagent for this fix, skip delegation and follow steps 1–4 directly.

```
Agent({
  description: "Diagnose and fix failing CI",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the verify-pr-state fix subagent for pull request <NUMBER> in <repo-path>,
    run <RUN_ID>. Do not delegate further. Identify the failing job(s), read
    the failure log, categorize per the failure-type table, apply the fix in the
    worktree at .claude/worktrees/, run the pre-push-quality-gate checklist, and commit
    + push. Report back: what failed, what you changed, and whether the fix pushed
    successfully."
})
```

After the subagent reports back, loop to Step 1 within 5 minutes as before.

1. **Identify failing jobs:**
   ```bash
   gh run view <RUN_ID> --repo "<repo-path>"
   ```
   Look for jobs in `failed` state.

2. **Read the failure log** for each failing job:
   ```bash
   gh run view <RUN_ID> --repo "<repo-path>" --log-failed | tail -100
   ```

3. **Categorise the failure:**
   | Failure type | Action |
   |---|---|
   | Lint / prettier | Run `npm run lint` and `npm run prettier` in the worktree, fix violations, commit and push |
   | TypeScript / build | Run `npx tsc --noEmit` in the worktree, fix errors, commit and push |
   | Test failures | Read the failing test output, assess if it's a flaky test or a real regression |
   | Infra / unrelated | Report to user — this is outside the scope of the fix |

4. After pushing the fix, loop back to Step 1 within **5 minutes**.

### canceled

Report to user and ask whether to re-trigger.

## Step 3 — Post-merge confirmation

After auto-merge is enabled:
- Check back in 10 min: `gh pr view <NUMBER>` — look for a merged state.
- If merged: report success with the pull request URL.
- If still open: report the current state and checks, ask user if they want to wait longer.

## Notes

- Never force-push. Never skip hooks. Never use `--no-verify`.
- When fixing lint/prettier failures: run the `pre-push-quality-gate` checklist before committing the fix — that skill owns the step list.
- The worktree for this repo is under `.claude/worktrees/` — all fixes should be committed from there.
- If two consecutive runs fail on the same job and the fix isn't obvious from the log, escalate to the user rather than looping endlessly.
