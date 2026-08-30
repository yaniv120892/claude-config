---
name: ship
disable-model-invocation: true
argument-hint: "<what to build or fix> | status | resume | qa | redo <phase> | verify | abort"
description: Full delivery pipeline for a feature or bug — worktree, bug reproduction, scoping rounds, plan approval, TDD implementation, proof of work, mutation-based test verification, simplify/review/rules polish, PR description, blind QA regression pass, stopping at "ready to merge".
---

# /ship — deliver a feature or bug end to end

```
/ship <what to build or fix>   start a new run
/ship status                   where the current run stands
/ship resume                   continue after a context reset or interruption
/ship qa                       re-run the blind QA pass only
/ship redo <phase>             re-run a phase from its start, with optional feedback
/ship verify                   verify the merged change on dev/prod
/ship abort                    stop and report what exists
```

## Anti-recursion guard

If your own task prompt identifies you as a `/ship` phase subagent, **you are not the conductor.** Read your phase brief in `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/phases.md`, do that phase, report back. Do not invoke `/ship` and do not dispatch further subagents unless your brief says to.

## Your role: conductor, not implementer

You hold the human approval gates. Every gate is at the *end* of the run, so if you burn context early you cannot reach them. Therefore:

**Hard rules — no exceptions:**

- **Never read, grep, glob, or edit a source file.** Not once, not "just to check."
- Files you may read: `.claude/ship/state.json`, `.claude/ship/plan.md` (and `plan-<n>.md` candidates), `.claude/ship/reports/*.md`, `.claude/ship.json`, `.claude/ship/proof-of-work.md`.
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
  media/implement/   frames and traces backing the proof of work
  media/qa/          frames from the blind QA pass (QA reads no other media/)
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

`phase` is one of: `scope` → `reproduce` (bug runs only) → `plan` → `plan-approved` → `implement` → `polish` → `verify-tests` → `qa` → `ready-to-merge` → `merged` → `verified`.

Append one entry to `history` per completed phase, as an object: `{"phase": "<the completed phase>", "at": "<UTC ISO-8601 timestamp>", "note": "<one line, optional>"}`. `request` is written once in the worktree phase and is **immutable** — it is the independent source of truth the QA agent is judged against.

## Per-repo configuration

Read `<repo>/.claude/ship.json` if it exists; otherwise use defaults. Schema and defaults: `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/config.md`. Pass the path to subagents — never inline its contents.

If it does not exist, run the pipeline on defaults and mention once at the end that creating one would make future runs sharper. Do not block on it.

## The pipeline

| # | Phase | Who | Gate |
|---|---|---|---|
| 0 | Worktree + state | you, inline | — |
| 1 | Scout the codebase | subagent | — |
| 2 | Reproduce the bug (bug runs only) | subagent | — |
| 3 | Scoping questions | **you + user** | ✋ answers required |
| 4 | Plan | subagent → `plan.md` | — |
| 5 | Approve plan | **you + user** | ✋ approval required |
| 6 | TDD implement + proof of work | subagent | — |
| 7 | Simplify / review / rules / PR | subagent | — |
| 8 | Verify the tests: mutate + trace to spec | subagent | — |
| 9 | Blind QA regression pass | subagent | — |
| 10 | Hand off: ready to merge | **you + user** | ✋ **stop here** |
| 11 | Verify on dev/prod | subagent, on `/ship verify` | — |

**The hand-off phase is a hard stop.** Never run `gh pr merge`, `glab mr merge`, approve a PR, or merge a branch. Present the PR link and the QA verdict and stop. Merging is the user's call, every time.

**One run is one branch, one PR.** Never split a run into a stack of PRs, and never open a second PR to finish something the first one started — if the plan is too big for one PR, say so at the plan-approval gate and let the user split the *request*, rather than splitting the delivery behind their back.

Within that branch, each phase commits its own work as it completes. That keeps a phase's changes recoverable if a later phase goes wrong, and lets `git log` on the branch show where a regression entered. None of it reaches the base branch — the squash at merge collapses the whole branch into the single commit named by the PR title, which is why that title has to be right.

### Worktree and state (inline)

Derive a short kebab slug from the request. Then:

1. `EnterWorktree` with `name: <slug>`. If it fails, continue in place and say so.
2. `mkdir -p .claude/ship/reports`
3. Write `state.json` with the request **verbatim** and `phase: "scope"`.
4. Add `.claude/ship/` to `$(git rev-parse --git-path info/exclude)`, appending only if absent — this is scaffolding, it must never land in the PR. Use that command rather than a literal path: in a linked worktree `.git` is a file, and the exclude it resolves to is shared with the main clone, so drop the line again once the run is merged.

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

**Bug runs insert the reproduce phase here.** When the scout returns and `state.json`'s `type` is `"bug"`, set `phase: "reproduce"` and dispatch the reproduce subagent with the same template before any scoping questions. When it reports back, continue to the scoping questions as usual — unless its first line is `BLOCKED`, which stops the pipeline per the blocker rule above. Feature runs skip straight from scout to the scoping questions.

**Plan alternatives.** When `plan.alternatives` in `ship.json` is greater than 1, dispatch that many plan subagents **in parallel**, each writing `plan-<n>.md`, each given one design constraint in its prompt: (1) minimise the interface — fewest entry points, maximum leverage each; (2) optimise for the most common caller — the default case trivial; (3) maximise flexibility — extension over concision. At the approval gate present a short comparison — approach, files touched, test count, trade-offs per candidate — plus your own recommendation. The user picks; copy the chosen file to `plan.md`; the others stay in `.claude/ship/` unused.

### Scoping questions (inline)

The scout wrote `scope.md` with its findings and the open questions worth resolving, each marked **decision** or **fact**. Read it. Then grill in **rounds**:

- A round is up to 4 questions via `AskUserQuestion`, each with your recommended default as the first option, marked "(Recommended)". The **frontier** is every question whose prerequisites are settled — a question whose answer depends on one still open this round waits for the next round.
- Ask only **decisions** — questions where two reasonable readings lead to different code. If a candidate question is answerable by looking at the codebase, it is a **fact**: collect the round's facts and re-dispatch the scout once with all of them, instructing it to append the answers to `scope.md`, not rewrite it. Facts are the pipeline's job, never the user's.
- Skip a question entirely if a sensible default exists; state the default instead.
- If an answer opens a new decision or invalidates a scout finding, ask another round. Done when no unresolved decision remains that would change the implementation — not after one round by default, and not endlessly either: most runs finish in one.

Append all answers to `scope.md` under `## Answers`. Set `phase: "plan"`.

### Approve the plan (inline)

Read `plan.md`. Present to the user, in your own text:

- the approach in 3–5 lines
- files that will change, and roughly how
- the seams — where the tests will live, and whether each is existing or new
- the test list the TDD phase will write first
- anything the plan explicitly leaves out

Then ask for approval. On changes requested, re-dispatch the plan phase with their feedback appended to `scope.md` — do not edit `plan.md` yourself. On approval set `phase: "plan-approved"` and continue.

### Hand off (inline)

Present:

- PR link and title
- the QA verdict, verbatim — **including any failure**
- the test-verification verdict: mutants survived vs killed, and anything still under `## Escalate`
- what the polish phase changed after implementation, and anything verify-tests found that the PR description no longer matches
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

## Redo

`/ship redo <phase>` re-dispatches the named phase from its start. Valid targets are the subagent phases as the enum names them (`scope`, `reproduce`, `plan`, `implement`, `polish`, `verify-tests`, `qa`) — `scope` re-runs the scout. If trailing feedback follows the phase name (`/ship redo plan the seam is wrong, use the service layer`), append it to `scope.md` under `## Feedback` first. Set `phase` back to it; the pipeline re-runs everything after it in order, gates included.

## Red flags — the run is wrong if

- You read a source file. Any source file.
- The QA agent was given `plan.md`, any `reports/*.md`, or any description of *how* the change was built.
- The verify-tests phase returned a non-`BLOCKED` verdict without naming a single mutant it applied.
- You merged, approved, or auto-closed anything.
- You reported "QA passed" without the QA subagent's actual verdict in front of you.
- A phase report exceeded 20 lines and you relayed all of it.
- `.claude/ship/` shows up in the PR diff.
