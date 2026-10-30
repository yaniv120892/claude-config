---
paths:
  - "**/migrations/**"
  - "**/schema.prisma"
  - "**/*.sql"
description: Database schema migrations — compatibility with the build still serving during a deploy.
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
