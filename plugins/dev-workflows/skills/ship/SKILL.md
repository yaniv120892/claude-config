---
name: ship
disable-model-invocation: true
description: Full delivery pipeline for a feature or bug — worktree, scoping questions, plan approval, TDD implementation, proof of work, mutation-based test verification, simplify/review/rules polish, PR description, blind QA regression pass, stopping at "ready to merge". Use when the user types /ship. Works in any repo.
---

# /ship — deliver a feature or bug end to end

```
/ship <what to build or fix>   start a new run
/ship status                   where the current run stands
/ship resume                   continue after a context reset or interruption
/ship qa                       re-run the blind QA pass only
/ship verify                   verify the merged change on dev/prod
/ship abort                    stop and report what exists
```

## Anti-recursion guard

If your own task prompt identifies you as a `/ship` phase subagent, **you are not the conductor.** Read your phase brief in `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/phases.md`, do that phase, report back. Do not invoke `/ship` and do not dispatch further subagents unless your brief says to.

## Your role: conductor, not implementer

You hold the human approval gates. Every gate is at the *end* of the run, so if you burn context early you cannot reach them. Therefore:

**Hard rules — no exceptions:**

- **Never read, grep, glob, or edit a source file.** Not once, not "just to check."
- Files you may read: `.claude/ship/state.json`, `.claude/ship/plan.md`, `.claude/ship/reports/*.md`, `.claude/ship.json`, `.claude/ship/proof-of-work.md`.
- Bash you may run: `git` / `gh` / `glab` metadata (status, log, remote, pr view), `mkdir`, `jq`, `cat` on the files above. Never a test run, build, grep sweep, or dev server.
- Every phase that touches code is a subagent. If you catch yourself about to inspect the code to answer something — dispatch instead, or ask the user.
- Relay each subagent's report as it came back. It is already capped at 20 lines. Do not expand, re-derive, or verify it yourself.

A healthy run leaves the conductor under ~40k tokens with all gates still reachable.

## State lives on disk, never in this conversation

Everything durable goes in the worktree at `.claude/ship/`:

```
.claude/ship/
  state.json         phase pointer, branch, PR, the original request verbatim
  scope.md           scout findings + the user's answers to scoping questions
  plan.md            the approved plan — the contract every later phase reads
  proof-of-work.md   evidence the thing actually works
  reports/<phase>.md full detail from each phase (subagents write these)
```

`state.json`:

```json
{
  "slug": "price-alerts",
  "type": "feature",
  "request": "<the user's original ask, verbatim, never paraphrased>",
  "repo": "/abs/path/to/repo",
  "worktree": "/abs/path/to/worktree",
  "branch": "feat/price-alerts",
  "base": "main",
  "pr": null,
  "phase": "scope",
  "history": []
}
```

`phase` is one of: `scope` → `plan` → `plan-approved` → `implement` → `verify-tests` → `polish` → `qa` → `ready-to-merge` → `merged` → `verified`.

Append one entry to `history` per completed phase, as an object: `{"phase": "<the completed phase>", "at": "<UTC ISO-8601 timestamp>", "note": "<one line, optional>"}`. `request` is written once in the worktree phase and is **immutable** — it is the independent source of truth the QA agent is judged against.

## Per-repo configuration

Read `<repo>/.claude/ship.json` if it exists; otherwise use defaults. Schema and defaults: `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/config.md`. Pass the path to subagents — never inline its contents.

If it does not exist, run the pipeline on defaults and mention once at the end that creating one would make future runs sharper. Do not block on it.

## The pipeline

| # | Phase | Who | Gate |
|---|---|---|---|
| 0 | Worktree + state | you, inline | — |
| 1 | Scout the codebase | subagent | — |
| 2 | Scoping questions | **you + user** | ✋ answers required |
| 3 | Plan | subagent → `plan.md` | — |
| 4 | Approve plan | **you + user** | ✋ approval required |
| 5 | TDD implement + proof of work | subagent | — |
| 6 | Verify the tests: mutate + trace to spec | subagent | — |
| 7 | Simplify / review / rules / PR | subagent | — |
| 8 | Blind QA regression pass | subagent | — |
| 9 | Hand off: ready to merge | **you + user** | ✋ **stop here** |
| 10 | Verify on dev/prod | subagent, on `/ship verify` | — |

**The hand-off phase is a hard stop.** Never run `gh pr merge`, `glab mr merge`, approve a PR, or merge a branch. Present the PR link and the QA verdict and stop. Merging is the user's call, every time.

**One run is one branch, one PR.** Never split a run into a stack of PRs, and never open a second PR to finish something the first one started — if the plan is too big for one PR, say so at the plan-approval gate and let the user split the *request*, rather than splitting the delivery behind their back.

Within that branch, each phase commits its own work as it completes. That keeps a phase's changes recoverable if a later phase goes wrong, and lets `git log` on the branch show where a regression entered. None of it reaches the base branch — the squash at merge collapses the whole branch into the single commit named by the PR title, which is why that title has to be right.

### Worktree and state (inline)

Derive a short kebab slug from the request. Then:

1. `EnterWorktree` with `name: <slug>`. If it fails, continue in place and say so.
2. `mkdir -p .claude/ship/reports`
3. Write `state.json` with the request **verbatim** and `phase: "scope"`.
4. Add `.claude/ship/` to the worktree's `.git/info/exclude` — this is scaffolding, it must never land in the PR.

### Dispatching a subagent phase — every row above whose *Who* is "subagent"

One template for all of them. The subagent reads its own brief; you never inline it.

```
Agent({
  description: "<phase> for <slug>",
  subagent_type: "<see phases.md>",
  model: "<from ship.json, else omit to inherit>",
  prompt: `You are the /ship "<phase>" phase subagent. You are NOT the conductor.

Read ${CLAUDE_PLUGIN_ROOT}/skills/ship/references/phases.md and follow the "<phase>" section exactly.

Repo:      <repo abs path>
Worktree:  <worktree abs path>
State:     <worktree>/.claude/ship/state.json
Config:    <repo>/.claude/ship.json (may not exist — use the defaults in the brief)

Read that repo's CLAUDE.md and .claude/rules/ before touching anything, and use
that repo's own build/test/lint scripts.

Write your full output to <worktree>/.claude/ship/reports/<phase>.md.
Return at most 20 lines: what you did, what you found, and anything blocking.
Your returned text is a report to a conductor, not a message to a human.`
})
```

After it returns: relay the report, update `phase` and `history` in `state.json`, move on.

If a subagent reports a blocker it cannot resolve, stop the pipeline, relay the blocker, and ask the user. Do not investigate it yourself.

### Scoping questions (inline)

The scout wrote `scope.md` with its findings and the ambiguities worth resolving. Read it. Ask the user the **2–4 questions that would change the implementation** via `AskUserQuestion` — not everything the scout listed. Skip a question entirely if a sensible default exists; state the default instead.

Append the answers to `scope.md`. Set `phase: "plan"`.

### Approve the plan (inline)

Read `plan.md`. Present to the user, in your own text:

- the approach in 3–5 lines
- files that will change, and roughly how
- the test list the TDD phase will write first
- anything the plan explicitly leaves out

Then ask for approval. On changes requested, re-dispatch the plan phase with their feedback appended to `scope.md` — do not edit `plan.md` yourself. On approval set `phase: "plan-approved"` and continue.

### Hand off (inline)

Present:

- PR link and title
- the QA verdict, verbatim — **including any failure**
- the test-verification verdict: mutants survived vs killed, and anything still under `## Escalate`
- what the polish phase changed after implementation
- one line: the proof of work, and where to see it
- explicitly: anything the run could not verify

Then hand over the exact command, so merging is one paste rather than a decision. On GitHub:

```
gh pr merge <n> --squash --delete-branch
```

On GitLab, or if you are unsure of the flags, read the `pr-workflows` plugin's `references/forge-cli.md` rather than guessing.

Squash always — the base branch keeps one commit per PR, not the run's internal steps. If the user asks *you* to merge, that is the command you run; it is the only circumstance in which this pipeline merges anything.

Set `phase: "ready-to-merge"`. Stop. Tell the user that after they merge, `/ship verify` checks it on dev/prod.

## Resume

`/ship resume`: find the worktree, read `state.json`, and re-enter at the phase it names. A phase interrupted mid-flight re-runs from its start — phases are idempotent by design. Never guess at state; if `state.json` is missing or unreadable, say so and ask.

`/ship status`: read `state.json` and `history`, report in five lines or fewer. Read nothing else.

## Red flags — the run is wrong if

- You read a source file. Any source file.
- The QA agent was given `plan.md`, any `reports/*.md`, or any description of *how* the change was built.
- The verify-tests phase returned a non-`BLOCKED` verdict without naming a single mutant it applied.
- You merged, approved, or auto-closed anything.
- You reported "QA passed" without the QA subagent's actual verdict in front of you.
- A phase report exceeded 20 lines and you relayed all of it.
- `.claude/ship/` shows up in the PR diff.
