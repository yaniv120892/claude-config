# Implementation


Technical, and anchored on the files. **One bullet per implementation file** — or per tight group of files doing one job — naming the path and what it contributes to the feature, so a reviewer knows which file to open first and why.

**Length: 2–4 bullets, ~2 lines each.** List only the files carrying the implementation; tests, fixtures, snapshots and lockfiles are assumed and stay out. When the change spans more files than bullets, fold the supporting ones into the bullet of the file they serve ("…plus its two call sites in `x/` and `y/`").

- Lead with the path in backticks, then what it now does and how that serves the core of this PR.
- Say the decision that is not obvious from reading the file; skip the narration that is.
- A flat list is the form — `###` subsections here are almost always the length budget being dodged.

**Good example (small, focused PR):**
```markdown
## Implementation
- **`src/worker/init.ts`** — calls a new `configureSharp()` once at worker startup (`sharp.cache(false)` + `sharp.concurrency(1)`); this is what caps the resident memory the PR is about.
- Activity-side only — no workflow command changed, so there is no `patched()` concern.
```

**Good example (larger PR):**
```markdown
## Implementation
- **`src/wallet/route-wallet-by-method.ts`** — new, and the core of the PR: maps each `generationMethod` to its wallet operation, falling back to `unlimited_slow` on `INSUFFICIENT_BALANCE`.
- **`prisma/schema.prisma` + `src/generation/persist.ts`** — adds `effectiveMethod` next to `generationMethod` and writes both in one update, so a record shows what the client asked for vs what ran.
- **`src/metrics/index.ts`** — `wallet_route_downgrade_total`, labeled by reason, which is what makes that fallback visible in production.
```

**Bad examples:**
- ❌ "Modified controller.ts and workflow-types.ts" — names files with no link to the feature; the link is the whole point
- ❌ A bullet for a `.spec.ts`, fixture, or snapshot — never list tests
- ❌ Subsections with one bullet each — flatten
- ❌ Restating the Motivation, or narrating code the reviewer can read in the diff
