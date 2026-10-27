---
paths:
  - "**/package.json"
  - "**/eslint.config.*"
  - "**/.eslintrc*"
  - "**/.prettierrc*"
  - "**/prettier.config.*"
  - "**/tsconfig*.json"
  - "**/.lintstagedrc*"
  - "**/.husky/*"
  - "**/.github/workflows/*.y*ml"
  - "**/instrumentation*.ts"
  - "**/observability/**"
description: Lint, format, tsconfig, CI and observability setup — consumed from the shared packages.
---

# Repo Tooling

**Consume the Shared Tooling, Never Copy It** — per-repo copies of the same config drift apart
within weeks, and every fix then has to land in each one
> Pattern: A JS/TS repo depends on `github:yaniv120892/dev-config#<tag>` and composes it:
> `eslint.config.js` = `defineConfig(<ignores>, <preset>, <repo-only rules>)` with the `node`,
> `next` or base preset; `"prettier": "@yaniv120892/dev-config/prettier"`; `tsconfig.json`
> extends `@yaniv120892/dev-config/tsconfig/<node|next|library>.json`; husky runs lint-staged
> from `@yaniv120892/dev-config/lint-staged`; CI calls
> `yaniv120892/dev-config/.github/workflows/node-ci.yml@<tag>` as its quality gate, with any
> e2e/DB jobs beside it. A deployed app also depends on `github:yaniv120892/observability#<tag>`
> for logging, Sentry, heartbeats, Telegram ops alerts and health routes.
> Avoid: A local `.prettierrc`, a hand-written rule list, or a `warn` override of a shared rule.
> A shared rule that is wrong for every repo is fixed in `dev-config` and released, not
> overridden here; a repo may only *add* rules (arbox keeps `no-console` for `src`).
> Exception: legacy `my-expenses-app` is not migrated.
> Releasing either package: bump `version` on every change (Vercel caches same-version git
> deps), squash-merge, `gh release create v<x.y.z>`, then bump the tag in consumers.
