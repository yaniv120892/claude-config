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
  - *Delta:* the PR description's Proof of Work names a SHA (Step 3d writes it) that
    `git merge-base --is-ancestor <sha> HEAD` confirms, and HEAD has commits since. That SHA is
    `<from>`: classify `<from>..HEAD` alone, and review that range in Step 2. With no such SHA, or
    one a rebase orphaned, the PR is not Delta.
- **Lockfile churn:** a lockfile diff with no manifest change behind it is regenerated noise or a
  silent upgrade. Restore it from the base, or name the manifest line that explains it.

A blocker here gates the push, not the review: continue to Step 1b.

## Steps 1b–3c — Review and fix

Read `${CLAUDE_PLUGIN_ROOT}/references/review-and-fix.md` and run it in **full** mode, at the Step 1a
diff size (a *Delta* PR runs it in delta mode on the new commits), with the Step 1a gate result. It
syncs with base, reviews, fixes, audits the rules, prunes comments and reviews your own fixes; its step
numbers are the ones this skill refers to below.

## Step 3d — Pre-push sweeps

Reviewers keep flagging these four even where a written rule already covers them, so check them
mechanically on the diff before pushing. Fix each hit; a hit you keep gets one line in the report.

- **Stale references.** For every identifier, value, flag, env var or ticket key the diff removes or
  renames (`git diff origin/<base>...HEAD | grep '^-'`), `rg` the old string across the repo —
  `docs/`, `*.md`, docblocks, TODOs, skill files, env tables. Fix every hit the change made false.
  A TODO must not point at a ticket this PR closes.
- **Guards that don't bite.** For each new branch, filter, assertion or guard, delete or invert it
  locally, run the specs, and confirm a named one fails; restore. Add the missing spec, negative
  and empty-state cases included, when none fails.
- **Anonymous callbacks.** In the added lines, find inline callbacks with a block body that holds a
  branch or more than one statement (`=> {` passed as an argument or JSX prop). Where the repo's
  rules or the global `typescript.md` prefer named functions, extract them. When the repo's
  `AGENTS.md`, rules or lint config require named callbacks, also extract `map`/`flatMap`/`filter`
  callbacks that hold more than one expression: the global `map`/`filter` exemption yields to the
  repo's stricter rule. Also check added
  functions for missing explicit return types where the repo's rules require them.
- **Final-head proof.** Run the "before ready" steps in the repo's `AGENTS.md` (or `CLAUDE.md`) (evals, smoke runs) on
  `git rev-parse HEAD`, after the last fix, and name that SHA in the Proof of Work. A prompt,
  skill-description or tool-description change gets a before/after model run on the host-visible
  text, not only a fixture.

## Step 4 — Commit and push

- PR with several commits that are reviewed one by one: `git commit --fixup=<owning commit>`, then
  `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/<base>`, then `git push --force-with-lease`.
- Otherwise: a new commit.

Before every push, `git fetch origin <base>`; when the base moved, return to Step 1b. Then run the
full gate again and push only on green, as one `&&` chain: a fix made for one finding breaks a spec
elsewhere.

Commit messages are Conventional Commits and follow the repo's attribution rules. The PR title follows the title format in `creating-prs`.

After the push, align the PR description with the fixes as `/pr-workflows:address-pr-feedback` Step 5a
describes: re-read it against the full diff at the pushed head and change every line the fixes made
wrong. When a fix touches what the Proof of Work demonstrates, rerun that proof and update it too.
With no fix commit, the description stays as it is.

## Step 5 — CI

Run `gh pr checks <n> --watch --interval 30` in the background, for at most twice the repo's usual CI time (a shell
loop with a deadline; macOS has no `timeout`). Past that, report the check that is still running.
On red, follow the `steward` skill: root-cause, fix, push, watch again. Green counts only on the pushed head: compare `gh pr view <n> --json headRefOid`
with the local `HEAD` before reporting it.

When the repo has a size or performance budget check, report the measured value and the headroom.
Local and CI builds can measure differently; use the gap the repo documents, if any. When the headroom is
under that gap, flag it and say the CI build may measure more — never report "under the limit" from a
local build alone.

## Step 6 — Bot comments

After the last push, when Step 1a found a bot reviewer, apply `steward`'s Qodo gate against the last
reviewed head: it triggers `/agentic_review` only past its changed-lines threshold, and this is where the
accumulated delta gets checked. When it triggers, wait for Qodo's review comment naming the new head SHA
before deciding there is nothing new; otherwise read the existing review. Without a bot reviewer, go
straight to the threads. Then:

- Unanswered threads: run `/pr-workflows:address-pr-feedback`, which fixes, runs the shared review and
  fix pass (comment pruning included) on its fix commits, pushes, replies in each thread, and resolves
  each Qodo thread it fixed or answered. Return to Step 5 after the last push.
- None: say so.

## Report

Per tool, the rules audit and the fix review included, what was fixed and what was skipped and why; the CI result on the head SHA; the state of
each bot thread; open questions from an unattended run.
