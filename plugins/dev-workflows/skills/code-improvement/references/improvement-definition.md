# What Counts as an Improvement

An improvement is a **behaviour-preserving** change that makes the next feature cheaper to
build. Every observable behaviour — responses, rendered UI, stored data, logs a dashboard
depends on — is identical before and after. One PR carries one theme, backed by evidence a
reviewer can re-measure.

## In scope, highest priority first

| # | Category | Signals to look for | Typical change |
|---|----------|---------------------|----------------|
| 1 | **Duplication and reuse** | The same logic in 2+ places; a local helper that reinvents one the repo (or a shared package such as a design-system or dev-config package it already depends on) provides; copy-pasted UI across apps that share a package | Extract a function/module/component; switch call sites to the existing helper; move cross-app code into the shared package |
| 2 | **Architecture and design** | Layer violations (UI or route handler talking to the DB directly, domain code importing framework code); circular imports; low-cohesion "god" modules; functions mixing several concerns; high coupling; a missing seam that makes a module untestable | Extract module, move function, introduce a repository/service boundary, split by responsibility, invert a dependency |
| 3 | **Type safety** | `any`, unchecked `as` casts, non-null `!`, untyped JSON, external input (request body, env, third-party API) used without a schema | Proper types, narrowing, a schema at the boundary, discriminated unions |
| 4 | **Dead code** | Unused exports, files, dependencies, stale feature flags, unreachable branches — found by the skill's dead-code detector, each confirmed by a search | Delete it and everything the deletion orphans |
| 5 | **Performance** | Sequential `await`s on independent work; N+1 queries; `'use client'` higher in the tree than needed; barrel imports pulling whole libraries into the client bundle; repeated identical fetches without dedupe/caching; work on the request path that could run after the response | `Promise.all`, batched queries, pushing the client boundary down, direct imports, `React.cache`/memoisation, `after()` |
| 6 | **Global-rule conformance** | Violations of `~/.claude/rules/*.md` and the repo's own `CLAUDE.md`/`AGENTS.md`/`.claude/rules/` — **the repo's established style wins** where they disagree | Bring one rule into line across one module |
| 7 | **Error handling and observability** | Swallowed errors, `catch` that loses the cause, inconsistent logging that bypasses the repo's shared logger, missing context on errors | Propagate or log with context through the existing logger |

## Out of scope — record in the backlog instead

- New features, new endpoints, new UI.
- Visual or copy changes; any change a user could see.
- API contract changes: request/response shapes, status codes, route paths, exported
  package APIs (for a shared package, a breaking export change is a feature, not a cleanup).
- Database migrations and schema changes — an index suggestion goes in the backlog as a note.
- Auth, authorisation, session, or secret-handling semantics. A security issue goes in the
  backlog marked **security** and in the run report, for the user to act on.
- Major dependency bumps — `pr-workflows:dependency-bump` owns those.
- Formatting-only churn, or renames with no design payoff.
- Generated, vendored, or migration files.
- A diff over ~400 changed lines (tests excluded). Split it, or pick something smaller.

## Scoring

For each candidate estimate, on 1–3:

- **Impact** — how much it lowers the cost of future change: 3 = touches a hot path many
  features go through or removes a whole class of duplication; 1 = local tidy.
- **Confidence** — how sure it is behaviour-preserving: 3 = covered by existing tests or a
  mechanical transformation; 1 = depends on runtime behaviour no test pins.
- **Risk** — blast radius: 3 = shared infrastructure, money/data paths, many callers;
  1 = one leaf module.

Score = impact × confidence ÷ risk. Break ties by category priority above. Below a score of
1.0 it is not worth a PR this run.

Prefer areas with recent churn (`git log --since=60.days --name-only`): an improvement in code
that changes often pays back soonest; a perfect cleanup of code nobody touches pays back never.

## Evidence a PR must carry

- The measured signal before and after: duplicate count, knip output, `any` count, query
  count, sequential-await chain, bundle size — whichever the category uses.
- The call sites changed, so a reviewer can check the count matches.
- How behaviour preservation was verified: which tests (existing and new), which sanity run.
