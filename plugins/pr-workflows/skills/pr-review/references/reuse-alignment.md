# Reuse & Alignment Check

Does the diff build something the codebase already has, or solve a problem a
different way than the flows next to it already solve it? Read-only.

Read the target repo's CLAUDE.md first; the layers, helpers and patterns it
names are the baseline every new flow is measured against.

## Searching the head, not the checkout

The local clone's working tree is usually another branch. Search the PR head
without touching it:

```bash
git -C <clone> fetch -q origin pull/<n>/head
git -C <clone> grep -n -E '<pattern>' <head-sha> -- '<pathspec>'
```

No local clone → `gh search code '<pattern>' --repo <slug>` covers the default
branch only; say so in the closing line.

## The three questions

### 1. Reuse — does this already exist?

For each new function, class, hook, component, type, constant, query, schema or
script in the diff, search for an existing one that does the same job. Search by
what it does, not only by its name: the verbs, the external call it wraps, the
table or endpoint it touches, a distinctive literal.

A finding needs the existing thing's `path:line` and evidence it fits the new
call site as-is or with a small change. Look in:

- the same repo, outside the changed files;
- shared packages it already depends on (`@<org>/*` in `package.json`,
  internal libs) — a helper published there beats a local copy;
- sibling repos under the repos directory `~/.claude/work-context.local.md`
  names, only when the diff copies code that visibly came from one.

### 2. Generalize — is the diff the second copy?

Flag when the diff duplicates logic that differs from an existing block only by
a value, a type, or one branch — including duplication *within* the diff. The
fix is to extend the existing one (a parameter, a generic, a strategy entry,
a config row), not a new abstraction layer. Ask for this only at the second
real copy; one use is not a pattern, and a speculative base class is its own
finding.

### 3. Align — does it follow the sibling flows?

Find the two or three closest existing flows — another domain, tenant, endpoint,
tool, job or page doing the same kind of thing — and compare how they handle:

- layering and file placement (where the logic, the I/O and the wiring live);
- error handling, retries, timeouts and validation at the boundary;
- config and secrets (env, tenant config, feature flags);
- data access (the repo's DAL/repository/client, not ad-hoc queries);
- naming, registration and wiring (how the flow gets discovered and mounted);
- test shape (fixtures, contract tests, where the specs live).

A divergence is a finding only when the sibling's way is the established one
(two or more flows do it) and the diff gives no reason for differing. Name the
sibling flow so the author can copy it.

## What does not count

- Two snippets that look alike but would change for different reasons.
- Code the PR's own description says it deliberately forks, with a reason.
- Trivial one-liners where a shared helper would cost more than it saves.
- Style already covered by lint or the rubric's rule section.

## Output

Return this section, nothing else:

````markdown
### H. Reuse & alignment — <owner/repo>#<n>
| tag | severity | file:line | comment |
| H1 | MEDIUM | src/domains/zap/zap.client.ts:30 | Re-implements `withRetry` from `src/common/http/retry.ts:12`; call it instead so zap gets the same backoff and logging as the other domains. |
````

Severity: MEDIUM when the copy will drift into a real bug (a fix applied in one
place, not the other) or the divergence breaks a shared contract; LOW otherwise.
Never HIGH — if the duplication already is a bug, it is a correctness finding
and belongs to the rubric. Same comment form as `rubric.md`'s comment contract;
a code fix goes in a `suggestion` block below the table, tagged `H1`, `H2`….

Close with one line naming the sibling flows compared and where you searched
(head SHA, shared packages, sibling repos), or `None` when nothing in the diff
has an existing counterpart.
