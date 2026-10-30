---
name: code-improvement
description: Find and ship ONE behaviour-preserving code improvement in a repo — duplication, architecture, type safety, dead code, performance, rule conformance — as a small polished PR, but only once the repo's previous improvement PR is merged and deployed. Use for "improve the code in <repo>", "find a refactor worth doing", "run the daily code improvement", or any scheduled continuous-refactoring run. Not for features or dependency bumps.
---

# Code Improvement

Continuous refactoring, one PR at a time per repo. Each run either opens exactly one
improvement PR, or explains why it waited. It never merges.

**Announce at start:** "I'm using the code-improvement skill on `<repo>`."

What counts as an improvement — categories, exclusions, scoring, required evidence — is in
`references/improvement-definition.md`. Read it before Step 4; it is the contract for every
decision below.

## Inputs

- **Repo** — absolute path to a local checkout. Resolve `owner/repo` and the default branch
  (`gh repo view --json nameWithOwner,defaultBranchRef`).
- **`unattended`** — set when a scheduler runs this. Every question that would go to the user is
  answered by the conservative choice instead and listed under **Needs your call** in the PR
  body and the report.

## Step 1 — Gate on the previous PR

Improvement PRs carry the `auto-improve` label. Create it once per repo if missing:
`gh label create auto-improve --color 0E8A16 --description "Automated code improvement"`.

1. **Open PR in flight** — `gh pr list --repo <owner/repo> --label auto-improve --state open --json number,url,isDraft,statusCheckRollup`.
   If one exists, this run's work is to steward it, not to start another: if its CI is red or it
   has unanswered review threads, run `pr-workflows:steward` on it once. Then report
   `waiting <url>` and stop.
2. **Last merged PR deployed** — take the newest merged `auto-improve` PR and its merge commit
   SHA. It counts as deployed when any of these holds:
   - a GitHub deployment for that SHA (or a later commit on the default branch) with
     `environment` `Production` has latest status `success` —
     `gh api "repos/<owner/repo>/deployments?environment=Production&per_page=20"`, then
     `.../deployments/<id>/statuses`;
   - the repo has no GitHub deployment records but deploys on Vercel (`vercel.json`, or a
     linked project): the Vercel MCP `list_deployments` for the project shows a production
     deployment in `READY` whose `meta.githubCommitSha` is that SHA or a descendant of it;
   - the repo has no deploy target (a library or package): merged is enough.

   Not yet deployed → report `waiting-deploy <url>` and stop. A failed production deploy →
   report `deploy-failed <url>` and stop; that needs the user, not another refactor.

A run that correctly waits is a success.

## Step 2 — Worktree from the default branch

```bash
git -C <repo> fetch origin <default>
git -C <repo> worktree add .claude/worktrees/auto-improve-<yyyymmdd> -b auto-improve/<yyyymmdd>-<slug> origin/<default>
```

Pick `<slug>` after Step 5; create the worktree with a temporary name and rename the branch
then if that is simpler. Install dependencies with the repo's own lockfile command.

Read the repo's `CLAUDE.md`/`AGENTS.md` chain and `.claude/rules/`, plus `~/.claude/rules/*`.
The repo's established style wins where they differ.

## Step 3 — Backlog

State lives outside the repo, at `~/.claude/state/code-improvement/<owner>-<repo>.md`: a table of
candidates with category, files, score, evidence, the default-branch SHA it was found at, and a
status (`open`, `done #<pr>`, `rejected: <why>`, `out-of-scope: <why>`).

- Backlog has `open` candidates found within the last 14 days → skip to Step 5 with them.
- Otherwise → Step 4, then rewrite the backlog.

Closed-unmerged `auto-improve` PRs are signals: mark that candidate `rejected` with the
user's closing comment, and do not re-propose it.

## Step 4 — Scan

Run the cheap deterministic detectors first, in the worktree, and keep their raw output as
evidence:

- dead code: `npx --yes knip --no-progress` (JS/TS) or `vulture` (Python);
- duplication: `npx --yes jscpd --min-lines 8 --reporters console --ignore "**/node_modules/**,**/.next/**,**/dist/**" src`;
- type holes: the repo's typecheck plus a grep for `: any`, ` as `, and non-null `!`;
- churn: `git log --since=60.days --name-only --format= | sort | uniq -c | sort -rn | head -30`.

Then read the high-churn modules against every category in the definition, including the
ones no tool measures (architecture, performance, error handling, rule conformance). For a
repo with more than ~150 source files, fan this out: one `Explore` subagent per category group,
each given the worktree path and the definition's path, each returning candidates with
`file:line` evidence.

Score every candidate per the definition. Out-of-scope findings go in the backlog with their
reason — a security finding is also surfaced in the report.

## Step 5 — Select exactly one

Highest score at or above 1.0. Re-verify it still holds on the current `origin/<default>` —
backlog entries go stale. If nothing qualifies, report `none <reason>`, clean up the worktree,
and stop.

## Step 6 — Make the change

1. **Pin behaviour first.** If the code being changed has no test covering the behaviour you
   are preserving, add characterization tests and see them pass on the unchanged code. Commit
   them as their own commit.
2. **Refactor in small steps**, running the tests between steps.
3. **Count the call sites.** N occurrences before means N updated after; say the number in the PR.
4. **Clean up what the change orphans** — imports, helpers, exports, config, dependencies.
5. Stay inside the diff budget in the definition. Over it → shrink the scope to one module and
   leave the rest as a backlog candidate.

## Step 7 — Verify: no regressions

1. **Quality gate** — `dev-workflows:pre-push-quality-gate`: the repo's format, lint, typecheck,
   build and test scripts, all green.
2. **Sanity test the touched area**:
   - **App** — start it the way the repo documents (`run` skill; `run-service-in-docker` when
     there is a Dockerfile). For every route or API endpoint whose code path the diff reaches,
     drive it with Playwright or `curl`: expected status, key content renders, no new console or
     server errors. Run the repo's existing e2e specs that cover those routes.
   - **Library** — build, run its tests, and typecheck one consumer against the built output
     when a consumer checkout is available.
   - **Performance changes** — measure the before/after number the definition names; a
     "faster" claim without a number is not evidence.
3. Any regression → fix it or shrink the change. Never ship with a red check.

## Step 8 — Open the PR

- Title as a conventional commit — it becomes the squash message: `refactor(<area>): …`,
  `perf(<area>): …`. Follow the repo's release convention; if the repo bumps its version on
  every change (its `CLAUDE.md` says so), bump it.
- Body via `pr-workflows:writing-pr-description`, plus the definition's required evidence:
  category, the before/after signal, call-site count, how behaviour preservation was verified,
  and **Needs your call** when unattended mode deferred anything.
- `gh pr create --draft --label auto-improve`.

## Step 9 — Polish

Run `pr-workflows:pr-polish` on the PR. In unattended mode, a finding whose fix would change
behaviour is resolved by keeping today's behaviour and listing it under **Needs your call**.
When polish ends green, `gh pr ready <n>`. Do not merge.

## Step 10 — Record and report

Update the backlog: the shipped candidate → `done #<pr>`. Remove the worktree only when the PR
is ready; keep it if polish could not reach green, so the next run can steward it.

End with exactly one result line, which the daily runner parses:

```
RESULT <owner/repo> opened <url> — <title>
RESULT <owner/repo> waiting <url>
RESULT <owner/repo> waiting-deploy <url>
RESULT <owner/repo> deploy-failed <url>
RESULT <owner/repo> none <reason>
RESULT <owner/repo> error <what failed>
```

Then the open backlog count and any security findings, one line each.
