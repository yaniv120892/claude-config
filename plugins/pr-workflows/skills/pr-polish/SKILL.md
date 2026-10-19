---
name: pr-polish
description: Use to run the full review battery on a pull request you authored, fix everything it finds, then drive it to green CI and handle bot review comments. Triggers on "run the full battery on my PR", "simplify, code-review, pr-review, prune-comments and fix all issues", "polish PR <n>", "fix all issues then wait for CI and Qodo".
---

# Polish My PR

One pass over a PR you own: review it four ways, fix every finding, push, wait for CI, then answer
the bots. It ends at a green PR with every thread answered. Merging and pinging reviewers stay
with the user.

**Announce at start:** "I'm using the pr-polish skill."

## Step 1 — Target

A PR number or URL. With none, run `gh pr view --json number,url,headRefName`, name the PR it finds,
and ask one question to confirm. Resolve `owner/repo`, the worktree path, and the head SHA.

## Step 2 — Review

1. Launch `/code-review` and `/pr-workflows:pr-review` for the PR, and `/simplify` for the diff, in one
   message. Both reviews only read; `/simplify` edits.
2. Run `/prune-comments` on the diff once `/simplify` has finished, so the two never edit the same file
   at once.

`/pr-workflows:pr-review` ends by offering to post its findings as PR comments. Skip that step: these are
your own changes, so fix the findings instead of commenting on them.

## Step 3 — Fix all issues

Dedupe the findings across the four tools, then fix each real one. Skip a finding only when it is a
false positive, sits outside the diff, or would change intended behaviour, and say which in the report.
A skipped finding gets one line of reasoning, not an argument.

## Step 4 — Commit and push

- PR with several commits that are reviewed one by one: `git commit --fixup=<owning commit>`, then
  `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/<base>`, then `git push --force-with-lease`.
- Otherwise: a new commit.

Messages are Conventional Commits and follow the repo's attribution rules. When a fix touches what the PR
body's Proof of Work demonstrates, rerun that proof and update the body.

## Step 5 — CI

Run `gh pr checks <n> --watch`. On red, follow the `steward` skill: root-cause, fix, push, watch again.

## Step 6 — Bot comments

Qodo reviews each push a few minutes after it lands. Wait until it has commented on, or reported a check
for, the new head SHA before deciding there is nothing new. Then:

- Unanswered threads: run `/pr-workflows:address-pr-feedback`, which fixes, pushes, and replies in each
  thread. Return to Step 5 after its push.
- None: say so.

## Report

Per tool, what was fixed and what was skipped and why; the CI result on the head SHA; the state of
each bot thread.
