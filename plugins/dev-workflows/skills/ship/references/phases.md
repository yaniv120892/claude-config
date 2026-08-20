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

## polish

**Agent type:** default (inherit) · **Purpose:** make the diff shippable and open the PR.

**REQUIRED SUB-SKILL:** `finalize-pr`, "Polish & ship" flow. You are the dispatched subagent for it — follow it directly, do not delegate further.

That skill covers `/code-review`, `/simplify`, rules alignment, the quality gate, and commit/push. In addition, before you push:

- **Strip redundant comments.** Delete any comment that restates what the line already says, narrates the change (`// added this`, `// fixed`), or repeats a name. Keep comments that explain *why* — a non-obvious constraint, a workaround, a decision someone would otherwise undo. When in doubt about a `why` comment, keep it.
- **Re-check against the plan.** Anything in `plan.md`'s `## Out of scope` that crept in gets removed.
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
