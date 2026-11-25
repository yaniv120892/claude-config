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

**Each Config Key Has One Owner: App Repo or Deploy Config** — a deploy value silently overrides
the app's `.env.<env>`, so a key set in both shows one value in the app repo while the cluster runs
another
> Pattern: The app's `.env.<env>` holds what changes only with the code: secret *names*, third-party
> hosts, project ids. Deploy config (Helm values, Terraform) holds what describes the deployment or
> changes without a release: other services' addresses, the mode one image runs in, kill switches and
> rollout flags. Secret values live in the secret manager. When the code reads a missing value as
> the safe default, leave the key out of `.env.<env>` and set it only in deploy config.
> Avoid: The same key in both places (`.env.production` says `false`, the values file says `true`);
> a rollout flag that needs an app release to flip back.
