# /ship phase briefs

You were dispatched as one phase of a `/ship` run. Find your phase below and follow it.

**Universal rules for every phase:**

- Read the target repo's `CLAUDE.md` and `.claude/rules/` before touching anything. Use that repo's own scripts.
- Work inside the worktree path you were given. Never touch the main checkout.
- Write your full output to `<worktree>/.claude/ship/reports/<phase>.md`. Return **at most 20 lines**.
- Your returned text is data for a conductor, not prose for a human. No preamble, no sign-off.
- If you hit something that blocks you, say so in the first line of your return. Do not improvise past it.
- Never merge, approve, or close a PR. Never force-push. Never push to the base branch.
- `.claude/ship/` is run scaffolding — never commit it.

---

## scout

**Agent type:** `Explore` · **Purpose:** map the ground so nobody downstream has to re-derive it.

Read `state.json` for the request. Then, searching **medium-to-thorough**:

1. Locate the code the request touches — entry points, the modules that own the behavior, existing tests covering it.
2. Find the closest existing pattern for what's being asked. Whatever this change becomes, it should look like its neighbors.
3. For a bug: find the actual failing path. Name the file and line where it goes wrong if you can. Do not fix it.
4. Identify what's genuinely ambiguous about the request — decisions where two reasonable readings lead to different code.

Write `<worktree>/.claude/ship/scope.md`:

```markdown
## Relevant code
<file:line — what it does, why it matters here. 5-12 entries.>

## Existing pattern to follow
<the closest precedent in this repo, with a path>

## Root cause            (bugs only)
<file:line and the mechanism>

## Test surface
<existing tests that cover this area, and the command that runs them>

## Open questions
<2-5 ambiguities. For each: the question, the options, and which you'd default to
 and why. The conductor will ask the user only the ones that change the code.>

## Risks
<what could break elsewhere — this seeds the QA pass>
```

Do not write code. Do not write a plan. Do not create files outside `.claude/ship/`.

---

## plan

**Agent type:** `Plan` · **Purpose:** produce the contract the implementer is held to.

Read `state.json`, `scope.md` (including the user's answers appended under `## Answers`), and the repo's rules. If `scope.md` has a `## Feedback` section, a previous plan was rejected — address it directly.

Write `<worktree>/.claude/ship/plan.md`:

```markdown
## Goal
<one paragraph — what is true after this ships that isn't true now>

## Approach
<3-6 sentences. The design decision and why, not a task list.>

## Tests to write first
<Ordered. Each: name, what it asserts, and the observable behavior it pins down.
 These get written before implementation and must fail first. Be specific enough
 that the implementer writes the same test you're imagining.>

## Changes
<per file: path, what changes, why. Include new files.>

## Out of scope
<what this deliberately does not do — the implementer must not drift into these>

## Verification
<how a human confirms this works, by hand. Feeds the proof-of-work phase.>

## Risk
<what could regress, and which existing tests cover it>
```

Rules: prefer extending an existing pattern over introducing a new one; say so explicitly when you do introduce one, with the justification. Keep the change as small as the goal allows. If the request cannot be done sensibly as asked, write the plan for what *should* happen and put the objection at the top under `## Concern` — do not silently substitute your own scope.

Return: approach in 3 lines, file count, test count, anything you flagged as a concern.

---

## implement

**Agent type:** default (inherit) · **Purpose:** build exactly the approved plan, test-first.

Read `plan.md`. It is a contract — build what it says. If you discover it is wrong, stop and report why in your first line rather than quietly building something else.

**REQUIRED SUB-SKILL:** `test-driven-development`. The loop, per item in `## Tests to write first`:

1. Write the test. Run it. **Watch it fail, for the right reason.** A test that passes before the implementation exists is testing nothing — fix the test.
2. Write the minimum implementation that passes it.
3. Run the full suite. Keep it green.

Do not write implementation ahead of its test. Do not batch all tests then all code.

When the plan's test list is green, run the repo's full suite plus build and lint. Then produce proof that it works for a human, not just for the runner.

Write `<worktree>/.claude/ship/proof-of-work.md`:

```markdown
## What was built
<2-3 lines>

## Tests
<command run, and the result line showing the counts>

## Proof it works
<Actual evidence, from the real app — not a description of evidence.
 Whatever this repo supports: terminal output of the real path running,
 a request/response pair, a screenshot path, a before/after.
 For a bug: the failing case reproduced first, then the same case passing.>

## Not covered
<what the tests don't reach, honestly>
```

If the repo has a `run` skill or a Dockerfile, use it — evidence from the real app beats evidence from a unit test. If you genuinely cannot produce runtime proof, say exactly why under `## Proof it works`. Never describe a verification you did not run.

Commit your work in the worktree (conventional commit, `feat`/`fix` for anything shippable). Do not push — the polish phase pushes once.

Return: what you built, the test counts, the proof type, and anything the plan got wrong.

---

## verify-tests

**Agent type:** default (inherit) · **Purpose:** prove the tests would actually catch a bug, and that what shipped is what was planned.

The same agent wrote the code and the tests. That is the problem this phase exists for: a test written alongside its implementation drifts toward asserting what the code *does* rather than what the request asked for, and it passes either way. You are here to falsify, then to fix what falsifies.

You may read `plan.md`, `proof-of-work.md`, `reports/implement.md`, and `state.json`. The blind QA agent runs after you and may not — never hand it your report.

### 0. Baseline

Run the repo's full suite. It must be green before you start; a red baseline makes every mutation result meaningless. If it is red, stop and say so in your first line — do not "fix it while you're here."

Record the exact test command and the pass count. `git rev-parse HEAD` — that commit is what every production file must still match when you finish.

### 1. Traceability — three reads

**a. `plan.md` `## Tests to write first` → the tests that exist.**
For each planned test, find the real test that asserts that behavior and name it `file:line`. A matching *name* is not a match — read the body. A test that pins down something narrower than the plan described is a finding, not a pass.

**b. `plan.md` `## Goal` / `## Changes` → the diff.**
Both directions: what the plan said would change and did not (silently dropped), and what changed that the plan never mentioned (undeclared scope). Anything from `## Out of scope` appearing in the diff is a finding, not a judgment call.

**c. `state.json` `request` → the tests.**
Derive acceptance criteria from the user's verbatim request **before you open a test file** — write them down first, or you will only be describing the tests back to yourself. Then map each criterion to a test that would fail if that criterion were violated. A criterion with no such test is a gap even when the plan never listed it: the plan can misread the request, and this read is the only thing that catches it.

### 2. Mutation pass

Coverage tells you a line ran. This tells you the line is *guarded*. For each mutant: make the production code wrong, run the tests, expect red. Green means nothing is watching that line.

**Scope:** only lines this branch added or changed in production source — `git diff <base>...<branch>`. Never mutate test files, generated code, migrations, fixtures, or config, plus anything in `verifyTests.exclude`.

**Budget:** at most `verifyTests.maxMutants` (default 12). Spend them on the logic carrying the behavior the request asked for, not on plumbing. Name in your report whatever the budget did not reach.

**Operators — use the ones the changed line admits:**

| Mutation | Example |
|---|---|
| boundary | `<` ↔ `<=`, `>` ↔ `>=` |
| negate condition | `if (x)` → `if (!x)` |
| short-circuit | `&&` ↔ `\|\|` |
| force a branch | condition → `true`, then → `false` |
| delete a guard | remove an early return, throw, or validation |
| off-by-one | `i + 1` → `i`, `n` → `n - 1` |
| swap arithmetic | `+` ↔ `-`, `*` ↔ `/` |
| constant return | replace a return with `null` / `0` / `[]` |
| drop an effect | delete a call whose whole point is the side effect (`await repo.save(x)`) |
| swap arguments | `f(a, b)` → `f(b, a)`, where the types allow it |

**The loop, one mutant at a time:**

1. Apply the mutant to the working tree.
2. Run the tests that plausibly cover that file. Red → killed. Revert, next.
3. Green → re-run the **full** suite before calling it a survivor; the killing test may live elsewhere. Still green → survivor. Record `file:line`, the mutation, and which test *should* have caught it.
4. `git checkout -- <file>` before the next mutant. Always. Never two live mutants at once.

A mutant that will not compile or type-check is not a result — discard it and pick another operator on the same line.

**Equivalent mutants:** where the mutation genuinely changes no observable behavior — a log string, a redundant re-assignment, an unreachable defensive branch — record it as equivalent and move on. Do not invent a test to kill it. Be strict with yourself here: "probably equivalent" without the reasoning is how this phase turns into theatre.

### 3. Tautology check

While you are in the test files, invert anything that smells: flip an assertion to its opposite and re-run. Still passing means it asserts nothing. Flag also, per `test-driven-development`'s `testing-anti-patterns.md`:

- a mock assertion as the *only* assertion — `expect(mock).toHaveBeenCalled()` and nothing about the result
- snapshot or echo assertions that restate whatever the implementation produced
- happy path only, where the request or the plan implies an error path
- a test whose setup dwarfs everything it asserts

### 4. Fix what you found

You fix in place — this phase strengthens tests, it does not just grade them.

- **Strengthen the test:** tighten a loose assertion, assert the value rather than the shape, add the missing case. Write the missing test for an uncovered request criterion.
- **Never weaken production code to make a mutant killable**, and never add a test-only method to a production class. `testing-anti-patterns.md` is binding here.
- **Prove each fix the way you found the problem:** re-apply the mutant, watch the new assertion go **red**, revert the mutant, run the full suite **green**. A fix you did not re-mutate is not verified — say so rather than claiming it.
- A survivor that can only be killed by changing behavior the plan deliberately chose is not yours to change. Record it under `## Escalate` and leave the code alone.

### 5. Finish

**Before you write your report, prove no mutant reached the branch.** `git status` and `git diff` must show test changes only, and every production file you touched must be byte-identical to the baseline commit from step 0 (`git diff <baseline> -- <file>` empty). A mutant surviving into the PR is the one unrecoverable failure of this phase — check, do not assume.

Commit the test work on its own (`test: ...`, or the repo's convention). Do not push; polish pushes once.

Write `<worktree>/.claude/ship/reports/verify-tests.md`:

```markdown
## Verdict
SOLID | STRENGTHENED | GAPS REMAIN | BLOCKED

## Mutation
<applied / killed / survived / equivalent, and the test command used>

| file:line | mutation | result | test that kills it now |
|---|---|---|---|

## Traceability
### Planned tests -> real tests
<per plan item: the test at file:line, or MISSING>
### Plan -> diff
<dropped from the plan; shipped without the plan naming it>
### Request criteria -> tests
<per criterion derived from the request: the test, or GAP>

## Weak tests found
<file:line — what it asserted before, what it asserts now>

## Escalate
<survivors needing a behavior decision rather than a test>

## Not reached
<diff regions the budget did not cover, and why>
```

Return at most 20 lines: verdict first, then survivors still alive, then traceability gaps, then what you strengthened.

---

## polish

**Agent type:** default (inherit) · **Purpose:** make the diff shippable and open the PR.

**REQUIRED SUB-SKILL:** `finalize-pr`, "Polish & ship" flow. You are the dispatched subagent for it — follow it directly, do not delegate further.

That skill covers `/code-review`, `/simplify`, rules alignment, the quality gate, and commit/push. In addition, before you push:

- **Strip redundant comments. REQUIRED SUB-SKILL:** `prune-comments`, scoped to this branch's diff. It goes further than deleting noise — where a comment is propping up a bad name, the fix is the rename, not the deletion. Do not widen it beyond the diff.
- **Re-check against the plan.** Anything in `plan.md`'s `## Out of scope` that crept in gets removed.
- **Leave the verified tests alone.** `reports/verify-tests.md` lists assertions that were tightened because a mutant survived them. `/simplify` will read some of those as redundant — they are not. Do not loosen or collapse an assertion that report names; if one genuinely must change, re-check it the way that phase did rather than trusting the suite still being green.
- **Update the repo's `CLAUDE.md`.** You read it at the start of this phase. Re-read the final diff against it and fix anything it now states wrongly — architecture notes, invariants, commands, routes, crons, models. Record the rule the code now follows, not the story of the change; git log holds that. If this branch merged the base branch, check the file against the merged tree rather than your own diff alone — a doc goes stale from commits your PR never touched. Fix what is cheaply and factually wrong; anything larger goes in your report for the handoff instead of growing this PR. If the repo has no `CLAUDE.md`, or nothing the file claims has changed, say so in your report and move on — do not create one, and do not pad it with a summary of this PR.
- Confirm `.claude/ship/` is not staged.

Then open or update the PR. **REQUIRED SUB-SKILL:** `creating-prs` — it is forge-agnostic and already handles the GitHub/GitLab split. Do not branch on the forge yourself; the command mapping lives in the `pr-workflows` plugin's `references/forge-cli.md`. Push to the feature branch only.

**The PR title must be a valid conventional commit** (`<type>(<scope>): <description>`). These PRs are squash-merged, so the title — not any commit on the branch — becomes the permanent base-branch history. Use `feat`/`fix` for anything that ships; `chore` does not trigger a release pipeline. Commit as granularly as you like on the branch; the squash is what reconciles a useful working history with a readable base branch.

**PR description: REQUIRED SUB-SKILL:** `writing-pr-description`. Write it against the **final** diff, after simplify — not the original plan. Pull the Proof of Work section from `proof-of-work.md`. If a description already exists, rewrite it rather than appending.

Return: PR number and URL, quality-gate result per check, what review/simplify actually changed, how many comments you removed, and whether `CLAUDE.md` needed updating.

---

## qa

**Agent type:** `general-purpose` · **Purpose:** independent verification.

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/qa-agent.md` — that is your complete brief, and it replaces this file for you. Do not read this section's neighbours, `plan.md`, `proof-of-work.md`, or any other phase report.

---

## verify

**Agent type:** `general-purpose` · **Purpose:** confirm the merged change is live and working on dev/prod.

Read `state.json` and `ship.json`'s `dev` / `prod` blocks. Then:

1. Confirm the merge commit is actually deployed — compare the deployed build/commit to `main`'s HEAD. If the deploy hasn't landed yet, say so and stop; do not report a stale environment as verified.
2. Run the environment's `verify` steps. If `ship.json` has none, exercise the feature the way `proof-of-work.md`'s `## Proof it works` did, against the deployed URL.
3. Check for new errors: application logs, and the browser console if it's a web path.

Report per environment: deployed commit, whether the change is present and working, and any new errors. If you could not reach an environment, say that — do not infer it from the code.

Never modify anything in a deployed environment beyond what the feature itself does in normal use. If verifying would write real data, stop and describe what a human should click instead.
