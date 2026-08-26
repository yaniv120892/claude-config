---
name: pre-push-quality-gate
description: Use when about to push code or create a commit — enforces running build, lint, prettier, typecheck, and test from package.json scripts before any push or commit is allowed to proceed
---

# Pre-Push Quality Gate

## Overview

**All five quality checks must pass before pushing code.** Skipping any check risks breaking CI, introducing formatting drift, or shipping broken builds.

**Core principle:** The gate is binary — all five pass or you don't push.

## When to Use

- Before any `git push`
- Before creating or finalizing a commit intended for a remote branch
- After making code changes, before opening a PR/MR

## The Gate (MANDATORY)

Run all five commands from `package.json` scripts in this order. Build first: a
broken build makes every later gate's output downstream noise.

```bash
npm run build
npm run lint
npm run prettier
npm run typecheck
npm run test
```

**All five must exit with code 0. If any fails — stop, fix, re-run from the top.**

## Handling Missing Scripts

Check `package.json` first if unsure what scripts exist:

```bash
cat package.json | grep -A 20 '"scripts"'
```

| Script missing | Action |
|---|---|
| `prettier` | Check for `format`, `fmt`, `prettier:check` |
| `lint` | Check for `eslint`, `tslint`, `check` |
| `build` | Check for `compile`, `bundle` |
| `typecheck` | Check for `tsc`, `types`, `check-types` |
| `test` | Check for `test:unit`, `spec`, `jest`, `vitest` |

If the script genuinely doesn't exist in the project, note it explicitly — don't silently skip.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Running only tests before push | All five gates required — tests alone don't catch build errors or formatting drift |
| Skipping prettier "because it's cosmetic" | Formatting failures block CI; run it |
| Running lint after build fails | Fix build first — lint errors may be downstream noise |
| Assuming tests cover lint/build | They don't. Each gate catches different failure modes |
| Assuming tests cover types | Vitest and Jest transpile without checking; only `typecheck` sees a broken signature |
| `--no-verify` to bypass hooks | Never. Fix the underlying issue |

## Red Flags — STOP

- "Tests pass so it's fine to push"
- "I'll fix the lint warnings in a follow-up"
- "Prettier is just style, it doesn't matter"
- "Build takes too long, I'll skip it this once"
- "CI will catch it"
- "The tests pass, so the types must be fine"

**All of these mean:** Run the gate. Don't push until all five pass.

## Why Each Gate Matters

| Gate | Catches |
|---|---|
| `prettier` | Formatting drift that fails CI format checks |
| `lint` | Code quality issues, unused vars, type violations |
| `build` | Compilation errors, missing imports, bundler failures |
| `typecheck` | Signatures that no longer hold — the test runner transpiles without checking them |
| `test` | Regressions, broken logic, failing assertions |
