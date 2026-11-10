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

A change that spans several repos has one PR per repo: run every step per PR, each from its own
worktree, and give one report.

**Unattended runs:** as a subagent or scheduled run, there is no user to ask. Take the recommended
answer wherever a step says to ask, and list each such decision under "Open questions" in the report.
Run every review agent in the foreground, or block on each one's result, and hand back only after
all of them have reported: a result that arrives after the hand-back is lost.

**Branch held by another worktree:** work in the worktree that has the branch checked out. When that
worktree belongs to a live session, stop and report it.

## Step 1a — Preflight

Before any review agent starts, check what would stall the run later and report each result in one line:

- **Draft:** Qodo skips draft PRs, so Step 6 would wait forever. Say so and offer `gh pr ready <n>`.
- **Unpublished internal packages:** for each `@bazak/*` version the PR's `package.json` changes,
  `pnpm view <name>@<version> version` must print it. When one is missing, the pre-push build fails:
  name the release that unblocks it and hold the push until it lands, instead of retrying.
- **Git-tag dependencies:** for each dependency the PR pins as `github:<owner>/<repo>#<tag>`, the tag
  must exist (`git ls-remote --tags`) and the lockfile's `resolved` commit must be the tag's commit.
- **Workflow scope:** when the diff touches `.github/workflows/`, `gh auth status` must list the
  `workflow` scope; otherwise hand the user `gh auth refresh -s workflow`.
- **Bot reviewer:** read the comments on the repo's five most recent PRs. When no review bot (Qodo)
  has commented on any of them, the repo has none: record that, and Step 6 skips the trigger and wait.
  A repo with no earlier PRs has none.
- **Gate:** run the repo's quality gate exactly as its CI workflow does, flags included (a shared gate
  may lint with `--max-warnings 0` where the local script does not). Fix a red gate before Step 2: a
  review of code that fails its own gate misses the real failure. A test that fails here and passes
  alone on rerun is a flake: report it by name and continue.
- **Diff size:** classify the diff, since Step 2 scales to it.
  - *Dependency-only:* manifests and lockfiles, plus call sites a bump forced.
  - *Small:* under about 50 changed lines outside generated files.
  - *Full:* everything else.
  - *Delta:* the PR already had a full pass and has new commits since. Classify the new commits'
    diff alone, and review that range in Step 2.
- **Lockfile churn:** a lockfile diff with no manifest change behind it is regenerated noise or a
  silent upgrade. Restore it from the base, or name the manifest line that explains it.

A blocker here gates the push, not the review: continue to Step 1b.

## Step 1b — Sync with base

Run `git fetch origin <base>`. When the head is behind `origin/<base>`, bring the base in before reviewing,
so every review sees the code that will merge: a merge commit, as `steward` resolves conflicts — or, for a
PR whose commits are reviewed one by one, a rebase onto `origin/<base>` with `git push --force-with-lease`,
since Step 4's autosquash rebase would flatten a merge commit anyway. Resolve conflicts, regenerate
lockfiles and generated files with the repo's own tooling, run its build and tests, and push.
Where the repo's rules allow no force push, merge.

For each other open PR in the repo that touches a file this one touches
(`gh pr list --json number,files`), run `git merge-tree --write-tree HEAD origin/<its branch>`.
Report each conflict with the PR number and the merge order that avoids it.

After the merge, grep the merged tree for every secret name, env var, config key, URL and number the PR
description names: a base-branch change can rename them. Fix the description before pushing.

## Step 2 — Review

Scale the review to the Step 1a diff size:

- **Dependency-only:** no review agents. Check the advisory or outdated report before and after, read
  the changelog of every major bump against the call sites, and rely on the Step 1a gate. Skip Steps
  3a and 3b.
- **Small:** `/pr-workflows:pr-review` alone; apply the `/simplify` angles yourself while fixing.
- **Full:** `/pr-workflows:pr-review` for the PR, then `/simplify` for the diff. A skill loads one per
  turn, so they run in that order. Give `/simplify` the `origin/<base>...HEAD` range: its default,
  the diff against upstream, is empty after a push.

A repo that ships its own `pr-review` skill uses that one in place of the plugin's.

`/pr-workflows:pr-review` only reads; `/simplify` edits. Do not also run `/code-review`:
`/pr-workflows:pr-review` already runs it as one of its subagents.

Run every tool from the PR's worktree and pass the worktree path and `origin/<base>...HEAD` range
explicitly. When the PR names a ticket, pass the ticket id too, so the review checks the diff against
the ticket's "Done when" list. Keep the worktree still until every review agent has reported: a
revert-and-fail proof run meanwhile shows them a broken guard. Tell review agents to take test results from the Step 1a gate and to leave local state as
they found it: databases, containers, generated files.

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

After the Step 3 fixes are in, launch one read-only `general-purpose` subagent to audit the PR diff
against the rules alone, not correctness. Running after the fixes means it also catches violations the
fixes introduced. Pass it paths, never file contents:

- the worktree path and `git diff origin/<base>...HEAD` as the diff to audit;
- the rule sources: section 3 of `<PLUGIN_ROOT>/skills/pr-review/references/rubric.md` lists them —
  the repo's `CLAUDE.md`/`AGENTS.md` chain and `.claude/rules/*`, plus `~/.claude/CLAUDE.md` with its
  `@` imports followed recursively and `~/.claude/rules/*`. It reads each file itself, not from memory;
- only lines this PR's own commits add or change are in scope, never lines a base merge brought in;
- where two rules contradict, the repo's own rule wins, then the more specific one;
- output: one row per violation — rule name, rule `file:line`, code `file:line`, the fix — or "none".

Fix every violation it reports, applying the same skip criteria as Step 3.

## Step 3b — Prune comments

Only after every fix in Steps 3 and 3a is in, run `/prune-comments` on the diff. Running it last means it sees
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

## Step 4 — Commit and push

- PR with several commits that are reviewed one by one: `git commit --fixup=<owning commit>`, then
  `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/<base>`, then `git push --force-with-lease`.
- Otherwise: a new commit.

Before every push, run the full gate again and push only on green, as one `&&` chain: a fix made for
one finding breaks a spec elsewhere. Then `git fetch origin <base>`; when the base moved, return to
Step 1b.

Commit messages are Conventional Commits and follow the repo's attribution rules. The PR title follows the title format in `creating-prs`.

After the push, align the PR description with the fixes as `/pr-workflows:address-pr-feedback` Step 5a
describes: re-read it against the full diff at the pushed head and change every line the fixes made
wrong. When a fix touches what the Proof of Work demonstrates, rerun that proof and update it too.
With no fix commit, the description stays as it is.

## Step 5 — CI

Run `gh pr checks <n> --watch` in the background, for at most twice the repo's usual CI time (a shell
loop with a deadline; macOS has no `timeout`). Past that, report the check that is still running. On red, follow the `steward` skill: root-cause, fix,
push, watch again. Green counts only on the pushed head: compare `gh pr view <n> --json headRefOid`
with the local `HEAD` before reporting it.

When the repo has a size or performance budget check, report the measured value and the headroom.
Local and CI builds can measure differently; use the gap the repo documents, if any. When the headroom is
under that gap, flag it and say the CI build may measure more — never report "under the limit" from a
local build alone.

## Step 6 — Bot comments

After the last push, when Step 1a found a bot reviewer, trigger Qodo and wait for it as `steward`
describes (`/agentic_review`, then its review comment naming the new head SHA) before deciding there
is nothing new. Without one, go straight to the threads. Then:

- Unanswered threads: run `/pr-workflows:address-pr-feedback`, which fixes, pushes, and replies in each
  thread. Then run `/prune-comments` on the diff again, since those fixes can add comments; commit and
  push anything it changes. Return to Step 5 after the last push.
- None: say so.

## Report

Per tool, the rules audit and the fix review included, what was fixed and what was skipped and why; the CI result on the head SHA; the state of
each bot thread; open questions from an unattended run.
