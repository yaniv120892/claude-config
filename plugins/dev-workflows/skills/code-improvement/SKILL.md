---
name: code-improvement
description: Find and ship ONE behaviour-preserving code improvement in a repo — duplication, architecture, type safety, dead code, performance, rule conformance — as a small polished PR, but only once the repo's previous improvement PR is merged and deployed. Use for "improve the code in <repo>", "find a refactor worth doing", "run the daily code improvement", or any scheduled continuous-refactoring run. Not for features or dependency bumps.
---

# Code Improvement

Continuous refactoring, one PR at a time per repo. Each run either opens exactly one
improvement PR, or says why it waited. Merging stays with the user.

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
- **Result file** — optional path. When given, Step 10 writes the result line to it.

## Step 1 — Gate on the previous PR

Improvement PRs carry the `auto-improve` label. Run the gate — model-free, it checks for an
open `auto-improve` PR and whether the last merged one reached production:

```bash
<this skill's directory>/scripts/gate.sh <repo> [--no-deploy]
```

Pass `--no-deploy` only for a repo with no deploy target (a library). When the caller says the
gate already passed, skip this step. Any verdict other than `clear` is this run's result: go
to Step 10 with it. A run that correctly waits is a success.

Clear → create the label if the repo lacks it:
`gh label create auto-improve --color 0E8A16 --description "Automated code improvement"`.

## Step 2 — Worktree from the default branch

```bash
git -C <repo> fetch origin <default>
git -C <repo> worktree add --detach <repo>/.claude/worktrees/auto-improve-<yyyymmdd> origin/<default>
```

If `git -C <repo> check-ignore -q .claude/worktrees/x` fails, append `.claude/worktrees/` to
`<repo>/.git/info/exclude` — local, never committed. Copy the main checkout's untracked env
files (`.env`, `.env.local`, `.env.development.local` — whichever exist) into the worktree so
the app can start for Step 7. Install dependencies with the repo's own lockfile command.

Read the repo's `CLAUDE.md`/`AGENTS.md` chain and `.claude/rules/`, plus `~/.claude/rules/*`.
The repo's established style wins where they differ.

## Step 3 — Backlog

State lives outside the repo, at `~/.claude/state/code-improvement/<owner>-<repo>.md`: a table of
candidates with category, files, score, evidence, the default-branch SHA it was found at, and a
status (`open`, `done #<pr>`, `rejected: <why>`, `out-of-scope: <why>`).

- Backlog has `open` candidates found within the last 14 days → skip to Step 5 with them.
- Otherwise → Step 4, then merge its results into the backlog. Rows marked `done`, `rejected`
  or `out-of-scope` are permanent: a rescan finding the same thing leaves that row as it is.

A closed-unmerged `auto-improve` PR is the user's verdict: mark its candidate `rejected` with
their closing comment.

## Step 4 — Scan

When the backlog has a SHA from an earlier scan, scope the scan to files changed since it plus
the high-churn files; a first scan covers the whole repo.

Run the cheap deterministic detectors first, in the worktree, and keep their raw output as
evidence:

- dead code: `npx --yes knip --no-progress` (JS/TS) or `vulture` (Python);
- duplication: `npx --yes jscpd --min-lines 8 --reporters console --ignore "**/node_modules/**,**/.next/**,**/dist/**" <source dirs>`;
- type holes: the repo's typecheck plus a grep for `: any`, ` as `, and non-null `!`;
- churn: `git log --since=60.days --name-only --format= | sort | uniq -c | sort -rn | head -30`.

Then read the high-churn modules against every category in the definition, including the
ones no tool measures (architecture, performance, error handling, rule conformance). For a
repo with more than ~150 source files in scope, fan this out: one `Explore` subagent per
category group, each given the worktree path and the definition's path, told to read the
repo's `CLAUDE.md`/`AGENTS.md` and `.claude/rules/` first, and returning candidates with
`file:line` evidence.

A security finding is out of scope for a refactor; it goes in the backlog and in the report.

## Step 5 — Select exactly one

Highest score at or above the definition's threshold. Re-verify it still holds on the current
`origin/<default>` — backlog entries go stale. Nothing qualifies → result `none <reason>`;
remove the worktree and go to Step 10.

Then branch: `git -C <worktree> switch -c auto-improve/<yyyymmdd>-<slug>`.

## Step 6 — Make the change

1. **Pin behaviour first.** If no test covers the behaviour you are preserving, add
   characterization tests and see them pass on the unchanged code. Commit them as their own
   commit.
2. **Refactor in small steps.**
3. **Count the call sites.** N occurrences before means N updated after; say the number in the PR.
4. **Clean up what the change orphans** — imports, helpers, exports, config, dependencies.
5. Over the definition's diff budget → shrink the scope to one module and leave the rest as a
   backlog candidate.

## Step 7 — Verify: no regressions

1. **Quality gate** — `dev-workflows:pre-push-quality-gate`: the repo's format, lint, typecheck,
   build and test scripts, all green.
2. **Sanity test the touched area**:
   - **App** — start it the way the repo documents (`run` skill; `run-service-in-docker` when
     there is a Dockerfile). For every route or API endpoint whose code path the diff reaches,
     drive it with Playwright or `curl`: expected status, key content renders, no new console or
     server errors. Run the repo's existing e2e specs that cover those routes. If the app cannot
     start (a missing secret, an unreachable service), say so in the PR's Proof of Work and
     under **Needs your call** — never present build-and-test as a sanity run.
   - **Library** — build, run its tests, and typecheck one consumer against the built output
     when a consumer checkout is available.
   - **Performance changes** — measure the before/after number the definition names; a
     "faster" claim without a number is not evidence.
3. A regression → fix it or shrink the change until every check is green.

## Step 8 — Open the PR

- Title as a conventional commit — it becomes the squash message: `refactor(<scope>): …`,
  `perf(<scope>): …`. The scope is the ticket ID when the profile requires one — create the
  ticket first if none exists — else the area. Follow the repo's release convention; if the repo bumps its version on
  every change (its `CLAUDE.md` says so), bump it.
- Body via `pr-workflows:writing-pr-description`, carrying the definition's required evidence,
  plus **Needs your call** when unattended mode deferred anything.
- `gh pr create --draft --label auto-improve`.

## Step 9 — Polish

Run `pr-workflows:pr-polish` on the PR. In unattended mode, a finding whose fix would change
behaviour is resolved by keeping today's behaviour and listing it under **Needs your call**.
When polish ends green, `gh pr ready <n>`.

## Step 10 — Record and report

Update the backlog: the shipped candidate → `done #<pr>`. Remove the worktree once the PR is
ready; keep it if polish could not reach green, and say so.

The result is one line, `<status> <detail>`, with status one of:

```
opened <pr-url> <title>
waiting <pr-url>
waiting-deploy <pr-url>
deploy-failed <pr-url>
deploy-unknown <pr-url>
none <reason>
error <what failed>
```

Write it to the result file when one was given, then print it, followed by the open backlog
count and any security findings, one line each.
