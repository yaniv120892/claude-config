---
paths:
  - "**/*.env*"
  - "**/*.tf"
  - "**/*.tfvars"
  - "**/settings.json"
  - "**/*.mcp.json"
  - "**/docker-compose*.y*ml"
  - "**/values*.y*ml"
  - "**/.github/workflows/*.y*ml"
  - "**/.gitlab-ci.y*ml"
description: Configuration and infrastructure files — secret handling and environment wiring.
---

# Configuration Files

Read with `code.md`, whose comment rule explicitly covers config.


**Secrets Never Live in a Tracked File** — a committed credential is compromised the moment it
is pushed, and rewriting history does not un-leak it; agent config files are the easy blind spot
because they look like local preferences rather than code
> Pattern: Keep the value in the environment and reference it — `${VAR}` in the config, exported
> from a shell profile or a secret manager. Commit a `*.example` with placeholder values so the
> shape is documented. When a file must hold a real value locally, gitignore it and say so in the
> example file's header.
> Avoid: A literal token, API key, password, or connection string in anything git tracks —
> including `settings.json`, `.mcp.json`, CI YAML, Helm values, and Terraform `.tfvars`.
> Verify: `git log -p -S '<prefix-of-the-secret>'` to confirm it was never committed. If it was,
> rotate the credential — do not merely delete the line.

**A New Environment Variable Is Added Everywhere It Is Read** — a var wired into one deployment
target and read unconditionally in code fails only in the environment nobody checked
> Pattern: When adding a var, update every place that declares it — the `.example` file, each
> environment's values/secrets, and the local compose or dev config — and make the code fail
> loudly at the point of use when it is missing.
> Avoid: Adding it to dev only and discovering prod at deploy time; a silent `?? ''` default that
> turns a missing var into a confusing downstream error.
