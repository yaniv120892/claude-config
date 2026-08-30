---
paths:
  - "**/*.ts"
  - "**/*.tsx"
description: TypeScript-specific typing, layout, and tooling rules.
---

# TypeScript

Read with `code.md`, which holds the language-agnostic rules.


**Array Type Syntax** — `T[]`, never `Array<T>`

**Avoid TypeScript `as` Casts** — casts suppress the checker and hide runtime mismatches
> Pattern: Narrow properly — a type guard, an `if (!x) { throw }` guard, or an annotated
> assignment. Reserve `as unknown as T` for a genuinely unexpressible bridge.

**Avoid `Pick` for Small Field Selections** — obscures intent for 1–3 static fields
> Pattern: Inline `{ priority: number }` or name a dedicated type. Reserve `Pick` for
> genuinely generic use.

**Name Derived Types, Never Inline Them in a Signature** — a composed type expression
(`Required<Pick<…>>`, `Omit<Exclude<…>>`) in a parameter or return position forces the reader to
evaluate type algebra before they can read what the function does
> Pattern: Bind the composition to a `type` alias with a domain name and a one-line comment saying
> what it represents, then use the alias in the signature: `type PackageAssignmentCreateData =
> Required<Pick<Prisma.…CreateManyInput, PackageAssignmentContentField | 'modelId'>>;` →
> `function build(…): PackageAssignmentCreateData`.
> Avoid: `function build(…): Required<Pick<Prisma.…CreateManyInput, CopiedField | 'modelId'>>`.
> Also avoid: exporting the raw field-union so each consumer re-composes `Required<Pick<…>>` its
> own way — export the finished alias instead, so every call site names the same thing.
> Keep the derivation: naming it is about the signature being readable, not about hand-writing the
> field list. A type derived from a schema/ORM model still fails to compile when a column is added,
> which is usually the whole point.

**Enum-Driven Allowlists Must Be Exhaustive** — a `Set` of a few members compiles forever and
silently omits members added later, falling through to the default branch
> Pattern: Object literal covering every member, `satisfies Record<TheEnum, boolean>`, so a new
> member fails to compile until someone decides about it.
> Avoid: `new Set([Enum.A, Enum.B]).has(value)` as the gate.

**Explicit Class Access Modifiers** — TypeScript's implicit-public default hides access level
> Pattern: Annotate every method and property `public`/`private`/`protected`. Logic tied to a
> class lives in it as a `private` method, not a module-level function beside it.

**Declare Shapes With `type`, Not `interface`** — one keyword removes a per-declaration
decision, and a duplicate `type` is a compile error where a duplicate `interface` silently merges
> Pattern: `type` for every object shape — DTOs, props, config, function signatures. It also
> covers unions, tuples and mapped types, so widening a shape later never means changing the
> declaration form.
> Avoid: `interface` for an ordinary shape. Interfaces are implicitly open, so an
> interface-typed value is not assignable to `Record<string, unknown>` and fails at logging,
> serialization, and ORM-filter boundaries a `type` alias passes.
> Exception: Declaration merging — augmenting a third-party module (`declare module 'express' {
> interface Request { userId: string } }`) needs `interface`. So does a deep shape extended many
> times, where `interface B extends A` type-checks faster and yields flatter errors than chained
> `&` intersections.

**Type Placement** — keep type definitions out of implementation files
> Pattern: A type used in one file goes at the top of that file. A type shared across files
> goes in a co-located `<module>.types.ts`, re-exported from the implementation file so callers
> don't break.
> Avoid: Mixing exported type definitions with implementations. Does **not** apply to
> activities/steps — short by design, input/output types co-located intentionally.

**Fix ESLint Issues Instead of Suppressing** — disabling hides the problem
> Pattern: Refactor, retype, restructure to satisfy the rule.
> Avoid: `// eslint-disable*` except as an absolute last resort.

**Prefer Established npm Packages Over Hand-Rolled Implementations** — libraries are edge-case
aware
> Pattern: Check for a maintained package before writing parsing, formatting, or data-structure
> logic (`csv-parse`, `date-fns`, `lodash`). Prefer an org wrapper over the raw SDK where one exists.
