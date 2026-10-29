---
name: pr-polish
description: Use to run the full review battery on a pull request you authored, fix everything it finds, then drive it to green CI and handle bot review comments. Triggers on "run the full battery on my PR", "simplify, code-review, pr-review, prune-comments and fix all issues", "polish PR <n>", "fix all issues then wait for CI and Qodo".
---

# Polish My PR

One pass over a PR you own: review and simplify it, fix every finding, audit the result against your rules, prune comments, push, wait for
CI, then answer the bots. It ends at a green PR with every thread answered. Merging and pinging reviewers stay
with the user.

**Announce at start:** "I'm using the pr-polish skill."

## Step 1 — Target

A PR number or URL. With none, run `gh pr view --json number,url,headRefName`, name the PR it finds,
and ask one question to confirm. Resolve `owner/repo`, the worktree path, and the head SHA.

## Step 1b — Sync with base

Run `git fetch origin <base>`. When the head is behind `origin/<base>`, bring the base in before reviewing,
so every review sees the code that will merge: a merge commit, as `steward` resolves conflicts — or, for a
PR whose commits are reviewed one by one, a rebase onto `origin/<base>` with `git push --force-with-lease`,
since Step 4's autosquash rebase would flatten a merge commit anyway. Resolve conflicts, regenerate
lockfiles and generated files with the repo's own tooling, run its build and tests, and push.

## Step 2 — Review

Launch `/pr-workflows:pr-review` for the PR and `/simplify` for the diff, in one message.
`/pr-workflows:pr-review` only reads; `/simplify` edits. Do not also run `/code-review`:
`/pr-workflows:pr-review` already runs it as one of its subagents.

`/pr-workflows:pr-review` ends by offering to post its findings as PR comments. Skip that step: these are
your own changes, so fix the findings instead of commenting on them.

## Step 3 — Fix all issues

Wait for both tools to finish. Dedupe their findings, then fix each real one. Skip a finding only
when it is a false positive or sits outside the diff, and say which in the report. A skipped finding gets
one line of reasoning, not an argument.

A finding whose fix would change intended behaviour is the user's call, not a skip: whether the
behaviour is intended is exactly what the finding questions. Collect every such finding and ask once,
in one `AskUserQuestion` batch — per finding, the behaviour today, the behaviour after the fix, and your
recommendation first. Apply the answers, and report each one as fixed or kept by the user's choice.

## Step 3a — Rules audit

After the Step 3 fixes are in, launch one read-only `general-purpose` subagent to audit the PR diff
against the rules alone, not correctness. Running after the fixes means it also catches violations the
fixes introduced. Pass it paths, never file contents:

- the worktree path and `git diff origin/<base>...HEAD` as the diff to audit;
- the rule sources: section 3 of `<PLUGIN_ROOT>/skills/pr-review/references/rubric.md` lists them —
  the repo's `CLAUDE.md`/`AGENTS.md` chain and `.claude/rules/*`, plus `~/.claude/CLAUDE.md` with its
  `@` imports followed recursively and `~/.claude/rules/*`. It reads each file itself, not from memory;
- only lines the diff adds or changes are in scope;
- output: one row per violation — rule name, rule `file:line`, code `file:line`, the fix — or "none".

Fix every violation it reports, applying the same skip criteria as Step 3.

## Step 3b — Prune comments

Only after every fix in Steps 3 and 3a is in, run `/prune-comments` on the diff. Running it last means it sees
the comments the fixes added or made stale, and it never edits a file another tool is still changing.

## Step 4 — Commit and push

- PR with several commits that are reviewed one by one: `git commit --fixup=<owning commit>`, then
  `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/<base>`, then `git push --force-with-lease`.
- Otherwise: a new commit.

Messages are Conventional Commits and follow the repo's attribution rules.

After the push, align the PR description with the fixes as `/pr-workflows:address-pr-feedback` Step 5a
describes: re-read it against the full diff at the pushed head and change every line the fixes made
wrong. When a fix touches what the Proof of Work demonstrates, rerun that proof and update it too.

## Step 5 — CI

Run `gh pr checks <n> --watch`. On red, follow the `steward` skill: root-cause, fix, push, watch again.

## Step 6 — Bot comments

Qodo reviews each push a few minutes after it lands. Wait until it has commented on, or reported a check
for, the new head SHA before deciding there is nothing new. Then:

- Unanswered threads: run `/pr-workflows:address-pr-feedback`, which fixes, pushes, and replies in each
  thread. Then run `/prune-comments` on the diff again, since those fixes can add comments; commit and
  push anything it changes. Return to Step 5 after the last push.
- None: say so.

## Report

Per tool, the rules audit included, what was fixed and what was skipped and why; the CI result on the head SHA; the state of
each bot thread.
