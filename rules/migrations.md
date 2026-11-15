---
paths:
  - "**/migrations/**"
  - "**/schema.prisma"
  - "**/*.sql"
description: Database schema migrations and installer SQL — compatibility with the build still serving during a deploy, and function privileges.
---

# Migrations

**Every Migration Runs Against the Build Still Serving** — migrations apply before the new
code takes traffic, so for the whole rollout the old build writes to the new schema; a
constraint it cannot satisfy fails its writes in production while CI, which runs only the new
code, stays green
> Pattern: Expand, then contract. Read each migration as the old build would hit it. A new
> NOT NULL column or required relation ships with a default or a BEFORE INSERT trigger that
> derives the value from what the old build does write. Prove it with an insert written the
> old way against a database with every migration applied. Mark the shim temporary and name
> when it goes: once no deployment predating it can serve.
> Avoid: Adding a constraint, a rename or a drop in the same release whose code first
> satisfies it.

**Revoking From PUBLIC Leaves Named-Role Grants In Place** — default privileges can grant
EXECUTE on every new function straight to named roles (Supabase grants `anon` and
`authenticated`), and `REVOKE ... FROM PUBLIC` does not touch those grants, so a SECURITY
DEFINER function that looks locked down stays callable with the definer's rights
> Pattern: After creating a SECURITY DEFINER function, revoke EXECUTE from PUBLIC and from every
> role the default privileges grant to (on Supabase, `anon, authenticated`), skipping a role
> that does not exist when the script also runs on plain Postgres. The spec installs under those
> default privileges and asserts `has_function_privilege` is false for each role.
> Avoid: `REVOKE ... FROM PUBLIC` alone; a spec that checks only `has_function_privilege('public', ...)`.
