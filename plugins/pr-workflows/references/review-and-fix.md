# Review and Fix

Read by `pr-polish` (full mode) and `address-pr-feedback` (delta mode). This file never invokes a
skill that reads it: its steps call only `/pr-workflows:pr-review`, `/simplify`, `/prune-comments`
and `/code-review`, none of which reads this file or invokes a skill that does. A step added here
keeps to that list, so no reader can loop back into itself.

The caller hands in:

- **mode:** *full* reviews the whole PR, `origin/<base>...HEAD`, at the size the caller's preflight
  classified. *Delta* reviews only a given commit range, `<from>..HEAD`; classify that range's diff by
  the same sizes (dependency-only, small, full).
- the worktree path, the gate result the caller just ran, and the ticket id when the PR names one.

Below, **the range** is `origin/<base>...HEAD` in full mode and `<from>..HEAD` in delta mode. The
caller commits, pushes and replies afterwards; nothing here pushes except Step 1b.

## Step 1b — Sync with base

Delta mode skips this step: the caller synced before making the commits under review.

Run `git fetch origin <base>`. When the head is behind `origin/<base>`, bring the base in before reviewing,
so every review sees the code that will merge: a merge commit, as `steward` resolves conflicts — or, for a
PR whose commits are reviewed one by one, a rebase onto `origin/<base>` with `git push --force-with-lease`,
since the autosquash rebase before push would flatten a merge commit anyway. Resolve conflicts, regenerate
lockfiles and generated files with the repo's own tooling, run its build and tests, and push.
Where the repo's rules allow no force push, merge.

For each other open PR in the repo that touches a file this one touches
(`gh pr list --json number,files`), run `git merge-tree --write-tree HEAD origin/<its branch>`.
Report each conflict with the PR number and the merge order that avoids it.

After the merge, grep the merged tree for every secret name, env var, config key, URL and number the PR
description names: a base-branch change can rename them. Fix the description before pushing.

## Step 2 — Review

Scale the review to the diff size:

- **Dependency-only:** no review agents. Check the advisory or outdated report before and after, read
  the changelog of every major bump against the call sites, and rely on the caller's gate. Skip Steps
  3a and 3b.
- **Small:** `/pr-workflows:pr-review` alone; apply the `/simplify` angles yourself while fixing.
- **Full:** `/pr-workflows:pr-review` for the PR, then `/simplify` for the diff. A skill loads one per
  turn, so they run in that order. Give `/simplify` the range explicitly: its default,
  the diff against upstream, is empty after a push.

A repo that ships its own `pr-review` skill uses that one in place of the plugin's.

`/pr-workflows:pr-review` only reads; `/simplify` edits. Do not also run `/code-review`:
`/pr-workflows:pr-review` already runs it as one of its subagents.

Run every tool from the PR's worktree and pass the worktree path and the range
explicitly. When the PR names a ticket, pass the ticket id too, so the review checks the diff against
the ticket's "Done when" list. Keep the worktree still until every review agent has reported: a
revert-and-fail proof run meanwhile shows them a broken guard. Tell review agents to take test
results from the caller's gate and to leave local state as they found it: databases, containers,
generated files.

`/pr-workflows:pr-review` ends by offering to post its findings as PR comments. Skip that step: these are
your own changes, so fix the findings instead of commenting on them.

## Step 3 — Fix all issues

Wait for both tools to finish. Dedupe their findings, then fix each real one. Skip a finding only
when it is a false positive or sits outside the diff, and say which in the report. A skipped finding gets
one line of reasoning, not an argument.

Reviewers overlap and sometimes disagree. A duplicate takes the highest severity given. A factual
claim two reviewers contradict is settled by reading the source — the package's files, the code —
before acting on either. When two findings pull in opposite directions, correctness beats
simplification and the repo's own `CLAUDE.md` beats a global rule. After applying a suggested fix,
rerun the check the finding was about: a fix that leaves it red is replaced, not shipped.

A finding whose fix would change intended behaviour is the user's call, not a skip: whether the
behaviour is intended is exactly what the finding questions. Collect every such finding and ask once,
in one `AskUserQuestion` batch — per finding, the behaviour today, the behaviour after the fix, and your
recommendation first. Apply the answers, and report each one as fixed or kept by the user's choice.
Unattended, keep today's behaviour and report the finding as an open question.

## Step 3a — Rules audit

After the Step 3 fixes are in, launch one read-only `general-purpose` subagent to audit the diff
against the rules alone, not correctness. Running after the fixes means it also catches violations the
fixes introduced. Pass it paths, never file contents:

- the worktree path and `git diff <the range>` as the diff to audit;
- the rule sources: section 3 of `<PLUGIN_ROOT>/skills/pr-review/references/rubric.md` lists them —
  the repo's `CLAUDE.md`/`AGENTS.md` chain and `.claude/rules/*`, plus `~/.claude/CLAUDE.md` with its
  `@` imports followed recursively and `~/.claude/rules/*`. It reads each file itself, not from memory;
- only lines the range's own commits add or change are in scope, never lines a base merge brought in;
- where two rules contradict, the repo's own rule wins, then the more specific one;
- output: one row per violation — rule name, rule `file:line`, code `file:line`, the fix — or "none".

Fix every violation it reports, applying the same skip criteria as Step 3.

## Step 3b — Prune comments

Only after every fix in Steps 3 and 3a is in, run `/prune-comments` on the range. Running it last means it sees
the comments the fixes added or made stale, and it never edits a file another tool is still changing.
With fewer than about ten added comment lines, prune by hand. The repo's documented comment style
wins over the skill's defaults.

## Step 3c — Review your own fixes

Step 2's review ran before the fixes, so they would otherwise ship unreviewed. Whenever a fix
changes code (not a rename, format or comment), run one correctness pass (`/code-review`) over just
the fix commits' diff before pushing, and fix what it finds. This pass is not optional: fixes made
under review pressure carry more defects than the original diff. Give it one extra question: what did
the replaced mechanism cover that the new one does not?

A revert-and-fail proof removes the guard's logic. A spec that reads the same constant as the code
still passes when only the constant changes.
