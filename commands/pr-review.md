---
description: Strict senior-level review of a pull/merge request against your global rules plus the repo's own conventions, with CI verification and an optional inline-comment pass. Works on GitHub and GitLab.
argument-hint: <PR/MR number or URL> (required)
allowed-tools: Bash(gh:*), Bash(glab:*), Bash(git:*), Bash(python3:*), Read, Grep, Glob, Skill
model: claude-sonnet-5
---

You are doing a senior-level code review of the change request in `$ARGUMENTS`.

Be rigorous and skeptical. Verify claims with evidence — never assert something
passes without inspecting it. Report faithfully: if you cannot verify something
locally, say so and explain why.

## 0. Require an explicit target

`$ARGUMENTS` MUST contain a number (e.g. `412`) or a full URL — extract the
number. If it is empty, **stop and ask**; do NOT fall back to the current branch,
which is frequently not the change under review (different ticket, stale, or
stacked).

## 1. Detect the forge, then review the ACTUAL head

Read `~/.claude/references/forge-cli.md` for the command mapping.

```bash
git remote get-url origin   # github.com → gh,  gitlab → glab
~/.claude/skills/creating-prs/pr-meta.sh <number>   # FORGE, SHAs, branches
```

Drive off the change request itself, not the local branch:

```bash
gh pr view <n> --json title,author,state,headRefName,baseRefName,headRefOid   # GitHub
gh pr diff <n>

glab mr view <n> --output json    # GitLab
glab mr diff <n>
```

For exact line numbers (needed for inline comments), read files at HEAD:

```bash
gh api "repos/<slug>/contents/<PATH>?ref=<HEAD>" --jq .content | base64 -d | cat -n
glab api "projects/<id>/repository/files/<URL-ENCODED-PATH>?ref=<HEAD>" \
  | python3 -c "import sys,json,base64;print(base64.b64decode(json.load(sys.stdin)['content']).decode())" | cat -n
```

## 2. Read real context, not just hunks

For every changed file, open the surrounding module, its callers, and any
co-located tests. A diff hunk in isolation hides the contract, lifecycle, and
concurrency issues that matter most.

## 3. Check against the rules (highest priority)

Read the repo's own `CLAUDE.md` and `.claude/rules/*` if present, AND apply the
global rules in `~/.claude/shared-rules.md` and `~/.claude/rules/*`. Flag concrete
violations citing `file:line`, but keep them in a section **separate** from
correctness findings — a style violation is not a bug, and conflating them buries
the bugs.

The global rules that recur most:

- **Always use braces** for control flow — no braceless guards or early returns.
- **No `as` casts** — narrow via type guards. (`as unknown as T` only to bridge genuinely incompatible types.)
- **Explicit class access modifiers** on every member.
- **`T[]` not `Array<T>`**; **no abbreviated identifiers** (`cfg`, `ctx`, `acc`, `res`…); **`switch` over `else if` chains** on one value.
- **Self-documenting code** — comments only for genuinely non-obvious *why*; extract well-named helpers instead.
- **Public-first method ordering**, unless the repo's lint enforces `no-use-before-define`, in which case that wins for free functions.
- **Avoid `Pick<T,'one'>`** for 1–3 static fields — inline `{ field: T }` or a named type.
- **Types**: exported/shared types in a `types` file; file-local types at the top of the file.
- **Fix lint, don't suppress** — no `eslint-disable` unless genuinely unavoidable.
- **Conventional commit title**. Where `feat`/`fix` trigger a release pipeline and `chore` does not, a shippable change titled `chore` is a bug — it should be `fix`.

## 4. Review — strict, ranked by severity

Rank findings **HIGH / MEDIUM / LOW**, each with a `file:line` and a concrete fix.
Be adversarial: hunt for the case that breaks. Apply the sections that match the
stack you actually found — skip the rest rather than padding the report.

### Always

- **Fail fast, don't propagate.** Invalid or unexpected state must be guarded at the boundary and thrown immediately — not passed downstream to fail somewhere confusing, nor silently swallowed. Flag catch-and-continue, sentinel/`null` returns that defer a failure, and `?? <fallback>` that masks a state which should throw.
- **Assertion helpers over inline throw-guards.** Prefer `assertExists(x)` over a raw `if (!x) { throw }` — it encapsulates the check and narrows the type.
- **Error handling**: user-facing errors surfaced, not swallowed; actionable messages.
- **Security**: no secrets in code or client bundles, input validated at the boundary, no injection via string-built queries or commands.

### Frontend (React / Next.js)

- Hooks rules; **dependency arrays** complete and honest — no silenced `exhaustive-deps`.
- **Stale closures** over props/state captured in effects, callbacks, timers, async handlers.
- Unnecessary re-renders: inline object/array/function props to memoized children; `useMemo`/`useCallback` where it actually changes referential identity, not cargo-culted.
- **`key`** stable and unique — never an array index for reorderable lists.
- **Effect cleanup**: subscriptions, timers, aborts, listeners torn down; no setState-after-unmount.
- Server/client boundary: `"use client"` placement, no server-only code or secrets leaking to the client.
- Data fetching: correct query keys, **cache invalidation** after mutations, loading/error/empty states handled, optimistic updates roll back, requests cancelled on unmount or arg change.
- Accessibility: labels tied to inputs, semantic roles, keyboard operability, focus management in modals.

### Backend / services

- Transaction boundaries and partial-failure behaviour; retries idempotent.
- N+1 queries, missing indexes, unbounded result sets.
- Concurrency: races on shared state, missing locks, non-atomic read-modify-write.
- Backwards compatibility of API and schema changes; migration safety on a live table.

### Test gap check (do this explicitly)

Does a test actually exercise the behaviour this diff *changes*, or only assert
things already true? A change whose behaviour could be reverted with all tests
still green is a **HIGH** finding.

### CI & container hygiene

Review the pipeline config and `Dockerfile`, not just app code — a green pipeline
hides most of these:

- **Wait/readiness loops must fail fast** — a loop that `break`s on success but falls through on timeout runs the job against a dead dependency; require an explicit non-zero `exit` when it exhausts.
- **Health gates must assert ready, not merely reachable** — a 200 from `/health` can precede the service actually serving.
- **`.dockerignore` vs `COPY . .`** — verify `.git`, `.env*`, `coverage`, test assets, and build caches are excluded. A newly added `.env*` silently ships into the image; flag it on the file that introduces it, since the diff won't touch `.dockerignore`.
- **No copy-pasted CI setup** — duplicated `before_script` blocks drift; prefer anchors or a shared job.

## 5. Simplification & extendability

Redundant or dead guards, duplicated predicates, collapsible conditions. Footguns
for the next change: parallel helpers that must be kept in sync, missing single
source of truth, hardcoded values that should be derived.

## 6. Verify via CI (authority)

Treat CI for the change request head as the source of truth rather than a local
build, which often needs scaffolding the reviewer doesn't have:

```bash
gh pr checks <n>                      # GitHub
glab ci status --branch <source_branch>   # GitLab
```

Confirm the lint/test/build jobs are green **and** that the latest commit is
included. On GitLab, a merged-results pipeline SHA is a synthetic
`refs/merge-requests/<n>/merge` commit rather than the head — that is expected.
If CI is red or stale, say so; do not vouch for what CI has not run.

## 7. Report, then gate on confirmation

Give a one-line verdict, then findings as a severity table
(`file:line | severity | issue | fix`), HIGH → nits, with rule violations kept
separate from correctness. State exactly what you verified and how — which jobs,
which commit.

**Then ask** whether to post the findings as inline comments. Only on an explicit
yes, invoke the `post-pr-inline-comments` skill (inline diff notes pinned to
lines — never general notes).

## Gotchas

- Approving can return **401** on GitLab even with a valid token when the project requires interactive re-auth (password/SAML) — direct the user to the web UI.
- `gh pr review --approve` cannot approve your own pull request.
- After switching the base branch, reinstall dependencies before trusting any local test run; stale worktree tests otherwise produce false failures.
