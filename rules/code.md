---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
  - "**/*.rb"
  - "**/*.sql"
  - "**/*.sh"
  - "**/*.bash"
description: Language-agnostic craft rules: comments, naming, control flow, error handling, guards.
---

# Writing Code — Craft Rules

Language-agnostic. TypeScript specifics are in `typescript.md`, Python in `python.md`.


**Self-Documenting Code Over Comments** — the most-repeated review comment; the bar is high
> Pattern: Comment only for a genuine hack, a non-obvious invariant, a workaround for a
> specific external bug, or behaviour that would actively surprise an experienced reader. If
> a competent developer would understand it without the comment in under 5 seconds, delete it.
> Prefer extracting a well-named function over explaining a block in prose.
> Avoid: Restating what a type, decorator, zod schema, or field name already says; ticket
> references (`// ABC-123`); narrating *what* rather than *why*.
> Applies to **config as much as code** — Helm values, `.env`, CI YAML, Terraform. Config has
> no types or functions to extract to, so the urge to narrate is strongest where the payoff is
> lowest. Comment only what the file cannot show: hidden behaviour of the consuming tool, a key
> that's inert unless mirrored elsewhere, an upstream-bug workaround.

**Always Use Braces for Control Flow** — including single-statement guards and early returns
> Pattern: `if (!x) { return null; }` — never `if (!x) return null;`

**Prefer `switch` Over `else if` Chains** — when branching one value against several literals
> Pattern: `switch` with an explicit `default`.

**No Abbreviated Identifiers** — names self-explanatory without surrounding context
> Pattern: Full words. `connectionConfig`, `FingerprintAccumulator`.
> Avoid: `cfg`, `ctx`, `mgr`, `svc`, `evt`, `res`, `req`, `msg`, `acc`; single letters outside
> loop indices (`i`, `j`) and sort comparators (`a`, `b`).

**Name Opaque Tokens Once, In the Module That Owns Them** — a literal the compiler cannot
check (`'P2025'`, `'yyyy-MM-dd'`, a header name, a model id) means something only to a reader
who has memorized the protocol, and a typo in a pasted copy compiles clean and fails at runtime
> Pattern: Define the token as a named constant in the module that owns the protocol
> (`PRISMA_ERROR_CODES.RECORD_NOT_FOUND`, `DAY_FORMAT`) and import it everywhere else — the
> name carries the meaning, the value carries the wire format, and the comment the raw literal
> would have needed disappears. Repetition makes this mandatory; even a single use earns a
> name when the token is opaque enough to need explaining. Tests that pin the protocol itself
> keep the raw literal — asserting against the constant would let the value drift unnoticed.
> Avoid: The same raw token pasted across call sites; also the opposite failure — wrapping
> compiler-checked literals (union members like `'APPROVED'`, enum values, CSS/`sx` keywords)
> in constants, where the type system already rejects typos and a constant only adds
> indirection.

**Public-First Method Ordering** — top-down readability
> Pattern: Public/exported members at the top, private helpers at the bottom.

**Prefer async/await Over Promise Chains** — linear control flow
> Pattern: `async`/`await` with `try`/`catch`, including fire-and-forget background work — still
> an `async` function with internal `try`/`catch`, invoked as `void doWork();`.
> Avoid: `.then()`/`.catch()` chains.

**Actionable Error Messages** — a log line should be self-sufficient
> Pattern: Interpolate the actual failing values: `` `videoFileUrl or videoFileKey must be
> provided (videoFileUrl: ${input.videoFileUrl}, videoFileKey: ${input.videoFileKey})` ``.
> Avoid: `'invalid input'`. Exception: never interpolate detail that leaks provider/vendor
> identity into a client-visible message — log it, return neutral.

**Non-Critical Side Effects Must Not Fail the Primary Operation** — a cache invalidation or
analytics call must not turn a successful DB write into a 500
> Pattern: Wrap in try/catch, log a warning, emit a metric, continue.
> Avoid: A bare unguarded `await` on a side effect after the primary operation succeeded.

**Extract Compound Boolean Guards to Named Variables** — double negations obscure intent
> Pattern: `const shouldSkipAcquire = !isCredits && !unlimitedPackage; if (shouldSkipAcquire)`.
> Avoid: `if (!isCredits && !unlimitedPackage)`.

**Extract Multi-Branch Inline Expressions to Private Methods** — ternaries in argument lists
resist reading and testing
> Pattern: `concurrencyCap: this.getConcurrencyCap(isCredits, unlimitedPackage)`. The call site
> reads like a sentence; the mechanics live in the method.

**Dedicated Validator Class for 2+ Assertions** — keeps guard-rail logic testable and out of
service bodies
> Pattern: Once an operation needs 2+ independent pre-flight checks (existence, lifecycle,
> uniqueness, ownership), extract them into a validator with one public method per guarded
> operation, throwing typed domain errors. It depends on the data-access layer, never the raw
> ORM. A single guard can stay inline.

**A Shared Helper Asserts Its Precondition Instead of Quietly Honouring It** — when a constraint
is encoded both as a loud boundary guard and a defensive compare inside a reusable helper, the
helper's copy can only fire for the caller that skipped the guard — exactly the one that needs
telling — and it silently swallows that caller's intent
> Pattern: Express the constraint once as a named predicate. Call it at the boundary for the
> user-facing error; have the helper `throw` on the same predicate with identifiers interpolated.
> Test it as an expect-throw.
> Avoid: A `if (value !== null && value !== current)` clause in a shared builder that silently
> drops a field the caller asked to clear.

**A Guard Must Be Reachable From Every Path That Writes What It Guards** — a check wired into
the endpoint that motivated it looks complete in review; the sibling endpoint that can write the
same field silently skips it, and every test of the guarded path still passes
> Pattern: Before adding a pre-flight check, enumerate the write paths for that field (grep the
> data-access method's callers, not just the route you're in) and put the check in the shared
> validator all of them already route through. A dedicated status/patch endpoint is rarely the
> only writer — a generic update usually accepts the same field.
> Avoid: A guard in one controller action, or a service method that only the "primary" entry
> point calls, while a generic update spreads the same field straight into the write.

**Every New Env Var Has a Default** — a var that throws when unset makes deploying the code and
configuring it a single atomic step nobody can sequence; the first request after deploy 500s
> Pattern: Read new vars through the optional accessor so unset resolves to a defined value
> (`optionalEnv(name)` → `''`), and pass an explicit fallback when the useful default is not
> empty (`optionalEnv('X_TIMEOUT_MS', '5000')`). Pick a default that makes the feature inert,
> not broken. List the var in `.env.example` with its default so "unset" is a documented state.
> Avoid: `requireEnv('NEW_FLAG')` on a request path; a feature that 500s because an optional
> integration URL has not been pasted into the dashboard yet.
> Exception: config the process genuinely cannot run without (DB URL, JWT secret) is required —
> but assert it at boot next to the others, never on first use.
