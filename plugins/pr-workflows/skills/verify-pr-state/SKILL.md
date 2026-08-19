---
name: verify-pr-state
description: Monitor a pull/merge request's CI and act on the outcome — enable auto-merge when it passes, report and fix the failure when it doesn't. Use when checking a PR/MR's CI status, setting it to merge automatically once green, or asking whether it is ready to merge. Works on GitHub and GitLab.
---

# Verify Change Request State & Auto-Merge

## Overview

Monitors a change request's CI and takes action based on the outcome:
- **CI passing** → enable auto-merge (merge when CI succeeds, or merge immediately if it already passed).
- **CI failing** → inspect the failure, attempt a fix (lint, type errors, etc.), push the fix, and re-check.

**Announce at start:** "I'm using the verify-pr-state skill."

## Inputs

The user provides a change request URL or a bare number.

- GitHub: `https://github.com/<owner>/<repo>/pull/2452` — repo slug is `<owner>/<repo>`, number is the trailing integer.
- GitLab: `https://gitlab.com/<group>/<repo>/-/merge_requests/2452` — repo path is the segment before `/-/merge_requests/`, IID is the trailing integer.

Detect the forge from the URL host, or from `git remote get-url origin` when
given a bare number. The command mapping is in `${CLAUDE_PLUGIN_ROOT}/references/forge-cli.md`.

## Step 1 — Get pipeline state

The shared helper normalises both forges to one state word:

```bash
python3 ../verify-resolve-pr-comments/pr_review_comments.py ci --pr <NUMBER> [--repo <slug>]
```

It prints `{"state": "success|failed|running|unknown", "web_url": ...}` — one
state word whichever forge you are on. Prefer it over `gh pr checks` /
`glab ci list`, which return different shapes and make the rest of this skill
branch on the forge.

Drop to the forge's own CLI only when you need detail the normalised state does
not carry, such as which specific job failed (Step 3 does exactly that).

## Step 2 — Branch on state

### running / pending

Schedule a wakeup in **5 minutes** using `ScheduleWakeup` with the original /loop prompt, passing the change request URL as context. Narrate: "CI still running — rechecking in 5 min."

### success → enable auto-merge

```bash
gh pr merge <NUMBER> --auto --squash                                  # GitHub
glab mr merge <IID> --repo "<repo-path>" --when-pipeline-succeeds --squash  # GitLab
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
  prompt: "You are the verify-pr-state fix subagent for change request <NUMBER> in <repo-path>,
    pipeline <PIPELINE_ID>. Do not delegate further. Identify the failing job(s), read
    the failure log, categorize per the failure-type table, apply the fix in the
    worktree at .claude/worktrees/, run the pre-push-quality-gate checklist, and commit
    + push. Report back: what failed, what you changed, and whether the fix pushed
    successfully."
})
```

After the subagent reports back, loop to Step 1 within 5 minutes as before.

1. **Identify failing jobs:**
   ```bash
   gh run view <RUN_ID> --repo "<repo-path>"                 # GitHub
   glab ci view <PIPELINE_ID> --repo "<repo-path>"           # GitLab
   ```
   Look for jobs in `failed` state.

2. **Read the failure log** for each failing job:
   ```bash
   gh run view <RUN_ID> --repo "<repo-path>" --log-failed | tail -100   # GitHub
   glab ci trace <JOB_ID> --repo "<repo-path>" | tail -100              # GitLab
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
- Check back in 10 min: `gh pr view <NUMBER>` / `glab mr view <IID> --repo "<repo-path>"` — look for a merged state.
- If merged: report success with the change request URL.
- If still open: report the current state and pipeline, ask user if they want to wait longer.

## Notes

- Never force-push. Never skip hooks. Never use `--no-verify`.
- When fixing lint/prettier failures: run the pre-push-quality-gate checklist (prettier → lint → build) before committing the fix.
- The worktree for this repo is under `.claude/worktrees/` — all fixes should be committed from there.
- If two consecutive pipeline runs fail on the same job and the fix isn't obvious from the log, escalate to the user rather than looping endlessly.
