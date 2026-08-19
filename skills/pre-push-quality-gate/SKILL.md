---
name: pre-push-quality-gate
description: Use when about to push code or create a commit — enforces running build, test, prettier, and lint from package.json scripts before any push or commit is allowed to proceed
---

# Pre-Push Quality Gate

## Overview

**All four quality checks must pass before pushing code.** Skipping any check risks breaking CI, introducing formatting drift, or shipping broken builds.

**Core principle:** The gate is binary — all four pass or you don't push.

## When to Use

- Before any `git push`
- Before creating or finalizing a commit intended for a remote branch
- After making code changes, before opening a PR/MR

## The Gate (MANDATORY)

Run all four commands from `package.json` scripts in this order:

```bash
# 1. Format check
npm run prettier

# 2. Lint
npm run lint

# 3. Build
npm run build

# 4. Tests
npm run test
```

**All four must exit with code 0. If any fails — stop, fix, re-run from step 1.**

## Handling Missing Scripts

Check `package.json` first if unsure what scripts exist:

```bash
cat package.json | grep -A 20 '"scripts"'
```

| Script missing | Action |
|---|---|
| `prettier` | Check for `format`, `fmt`, `prettier:check` |
| `lint` | Check for `eslint`, `tslint`, `check` |
| `build` | Check for `compile`, `tsc`, `bundle` |
| `test` | Check for `test:unit`, `spec`, `jest`, `vitest` |

If the script genuinely doesn't exist in the project, note it explicitly — don't silently skip.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Running only tests before push | All four gates required — tests alone don't catch build errors or formatting drift |
| Skipping prettier "because it's cosmetic" | Formatting failures block CI; run it |
| Running lint after build fails | Fix build first — lint errors may be downstream noise |
| Assuming tests cover lint/build | They don't. Each gate catches different failure modes |
| `--no-verify` to bypass hooks | Never. Fix the underlying issue |

## Red Flags — STOP

- "Tests pass so it's fine to push"
- "I'll fix the lint warnings in a follow-up"
- "Prettier is just style, it doesn't matter"
- "Build takes too long, I'll skip it this once"
- "CI will catch it"

**All of these mean:** Run the gate. Don't push until all four pass.

## Why Each Gate Matters

| Gate | Catches |
|---|---|
| `prettier` | Formatting drift that fails CI format checks |
| `lint` | Code quality issues, unused vars, type violations |
| `build` | Compilation errors, missing imports, broken types |
| `test` | Regressions, broken logic, failing assertions |
