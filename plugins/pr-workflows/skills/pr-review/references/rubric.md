# Review Rubric

Read by the per-PR review subagent. Follow it in order.

Be rigorous and skeptical. Verify with evidence — never assert something passes
without inspecting it. If you cannot verify something, say so and say why.

## 1. Review the actual head, not the local branch

```bash
gh pr view <n> --repo <slug> --json title,author,state,headRefName,baseRefName,headRefOid
gh pr diff <n> --repo <slug>
```

`headRefOid` is the HEAD SHA. You do not need a base SHA to review — only the
posting step does, and it reads that itself.

Skip the `gh pr view` call if the caller already handed you the head SHA.

For exact line numbers — needed for inline comments — read files **at HEAD**,
not from your working tree, which is usually a different commit.

With a local clone of the repo (faster, and the default when one exists):

```bash
git fetch origin pull/<n>/head && git show 'FETCH_HEAD:<PATH>' | cat -n
```

**Single-quote the whole `FETCH_HEAD:<PATH>` argument.** Next.js and Hono route
folders like `src/api/[tenant]/mcp/route.ts` are a shell glob — unquoted, zsh
expands it to nothing and the command silently no-ops instead of erroring.

Without one:

```bash
gh api "repos/<slug>/contents/<PATH>?ref=<HEAD_SHA>" --jq .content | base64 -d | cat -n
```

## 2. Read real context, not just hunks

For every changed file, open the surrounding module, its callers, and any
co-located tests. A hunk in isolation hides the contract, lifecycle, and
concurrency problems that matter most.

**The read budget does not bind evidence for a HIGH finding.** When the
behaviour in question belongs to a dependency — what a library actually does
with a drained stream, whether a framework re-reads a body — read that
dependency's source in `node_modules`. Spending four extra calls to confirm a
HIGH is right; asserting one you could not verify is not. Stay inside the budget
for everything else.

## 3. Rules (highest priority, reported separately)

Read the repo's own `CLAUDE.md` and `.claude/rules/*`, and apply the global
rules in `~/.claude/shared-rules.md` and `~/.claude/rules/*`. Cite `file:line`.
Keep these in a section **separate** from correctness findings.

The ones that recur most:

- **Always use braces** for control flow — no braceless guards or early returns.
- **No `as` casts** — narrow via type guards. (`as unknown as T` only to bridge genuinely incompatible types.)
- **Explicit class access modifiers** on every member.
- **`T[]` not `Array<T>`**; **no abbreviated identifiers** (`cfg`, `ctx`, `acc`, `res`…); **`switch` over `else if` chains** on one value.
- **Self-documenting code** — comments only for genuinely non-obvious *why*; extract well-named helpers instead.
- **Public-first method ordering**, unless the repo's lint enforces `no-use-before-define`, which wins for free functions.
- **Avoid `Pick<T,'one'>`** for 1–3 static fields — inline `{ field: T }` or a named type.
- **Types**: exported/shared types in a `types` file; file-local types at the top of the file.
- **Fix lint, don't suppress** — no `eslint-disable` unless genuinely unavoidable.
- **Conventional commit title.** Where `feat`/`fix` trigger a release and `chore` does not, a shippable change titled `chore` is a bug — it should be `fix`.

## 4. Correctness — ranked HIGH / MEDIUM / LOW

Be adversarial: hunt for the case that breaks. Apply the sections matching the
stack you actually found; skip the rest rather than padding the report.

### Always

- **Fail fast, don't propagate.** Invalid or unexpected state is guarded at the boundary and thrown immediately — not passed downstream to fail somewhere confusing, nor silently swallowed. Flag catch-and-continue, sentinel/`null` returns that defer a failure, and `?? <fallback>` masking a state that should throw.
- **Assertion helpers over inline throw-guards.** `assertExists(x)` over a raw `if (!x) { throw }` — it encapsulates the check and narrows the type.
- **Error handling**: user-facing errors surfaced with actionable messages, not swallowed.
- **Security**: no secrets in code or client bundles, input validated at the boundary, no injection via string-built queries or commands.

### Frontend (React / Next.js)

- Hooks rules; **dependency arrays** complete and honest — no silenced `exhaustive-deps`.
- **Stale closures** over props/state captured in effects, callbacks, timers, async handlers.
- Re-renders: inline object/array/function props to memoized children; `useMemo`/`useCallback` where it actually changes referential identity, not cargo-culted.
- **`key`** stable and unique — never an array index for reorderable lists.
- **Effect cleanup**: subscriptions, timers, aborts, listeners torn down; no setState-after-unmount.
- Server/client boundary: `"use client"` placement, no server-only code or secrets reaching the client.
- Data fetching: correct query keys, **cache invalidation** after mutations, loading/error/empty states, optimistic updates that roll back, requests cancelled on unmount or arg change.
- Accessibility: labels tied to inputs, semantic roles, keyboard operability, focus management in modals.

### Backend / services

- Transaction boundaries and partial-failure behaviour; retries idempotent.
- N+1 queries, missing indexes, unbounded result sets.
- Concurrency: races on shared state, missing locks, non-atomic read-modify-write.
- Backwards compatibility of API and schema changes; migration safety on a live table.
- **Shared resolver / mapper / formatter edits.** A PR scoped to one provider can silently re-map every other caller through a function they share. Establish the full caller set before accepting the change, and name that set in the finding.
- **Renamed emitted identifier values** — metric labels, log field values, event names, enum strings crossing a process boundary. Nothing fails to compile; the dashboard, alert rule, or downstream query just stops matching after deploy. Treat renaming an existing series as a breaking change needing its own migration.

### Test gap (do this explicitly)

Does a test exercise the behaviour this diff *changes*, or only assert what was
already true? A change that could be reverted with every test still green is a
**HIGH** finding.

### CI & container hygiene

Review the pipeline config and `Dockerfile`, not just app code — a green
pipeline hides most of these:

- **Wait/readiness loops must fail fast** — a loop that `break`s on success but falls through on timeout runs the job against a dead dependency. Require an explicit non-zero `exit` when it exhausts.
- **Health gates must assert ready, not merely reachable** — a 200 from `/health` can precede the service actually serving.
- **`.dockerignore` vs `COPY . .`** — verify `.git`, `.env*`, `coverage`, test assets, and build caches are excluded. A newly added `.env*` silently ships into the image; flag it on the file that introduces it, since the diff won't touch `.dockerignore`.
- **No copy-pasted CI setup** — duplicated `before_script` blocks drift; prefer anchors or a shared job.

## 5. Simplification

Redundant or dead guards, duplicated predicates, collapsible conditions. Dead
config: a directive the surrounding settings make inert. Footguns for the next
change: parallel helpers that must be kept in sync, missing single source of
truth, hardcoded values that should be derived.

These have **no section of their own** — file them into section A at LOW unless
the dead code hides a real bug, which makes it a correctness finding at its
real severity.

## 6. Documentation drift

Run the check in `docs-alignment.md` and carry its output into section C below.

## 7. CI is the authority

```bash
gh pr checks <n> --repo <slug>
```

Confirm the lint/test/build jobs are green **and** that they ran on the head
commit. A local build usually needs scaffolding a reviewer doesn't have, so CI
decides. If CI is red or stale, say so; never vouch for what CI has not run.

`gh pr checks` does not print the SHA it inspected — it reports the current
head. Confirming that `headRefOid` from step 1 equals the head you reviewed **is**
sufficient; say so in section D and move on. Don't hunt for a stronger proof.

## Comment contract

Every finding is written as the comment that will be posted. Reviewers skim.

- **Two sentences, maximum.** Problem, then fix.
- **Lead with the consequence**, not a restatement of the diff.
- **Where the fix is code, emit a GitHub suggestion block** so the author commits it in one click. Anchor the comment to the exact line the block replaces.
- **No preamble, no praise, no hedging.** Not "Consider possibly…", not "Great work, but…".

````
Unbounded — `findMany` with no `take` scans the whole table as tenants grow.

```suggestion
    const bookings = await this.dal.booking.findMany({ where, take: 100 });
```
````

A suggestion block that deletes a line is an **empty** ` ```suggestion ` block —
that is correct GitHub syntax, not a mistake.

If you cannot state a concrete fix, the finding is a question, not a comment —
put it under Questions instead.

## Output contract

Return exactly the sections below, nothing else. No summary of the PR's
purpose, no restatement of what the diff does.

A fenced block cannot live inside a table cell — it renders as literal `\n` and
`<br>`. So the table carries the prose sentence only, and any finding with a
code fix gets an `A1`, `A2`… tag whose suggestion block follows **below** the
table. Tag only the findings that have one.

````markdown
### A. Correctness — <owner/repo>#<n>
| tag | severity | file:line | comment (comment-contract form) |
| A1 | HIGH | src/x.ts:42 | Unbounded — `findMany` with no `take` scans the whole table as tenants grow. |

**A1** — src/x.ts:42
```suggestion
    const bookings = await this.dal.booking.findMany({ where, take: 100 });
```

### B. Rule violations — <owner/repo>#<n>
| rule | file:line | comment |

### C. Docs alignment — <owner/repo>#<n>
| Notion page + URL | what the diff contradicts | what to update |

### D. CI — <owner/repo>#<n>
<job names, head SHA, pass/fail — or why you could not verify>

### E. Verdict
<one line>

### F. Questions
<only findings with no concrete fix; omit the section if empty>
````

Empty section → write `None`. Never pad a section to look thorough.
