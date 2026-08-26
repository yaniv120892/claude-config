---
name: pre-push-quality-gate
description: Use when about to push code or create a commit — syncs the branch with its base, then enforces running format, lint, typecheck, build, and test from package.json scripts before any push or commit is allowed to proceed
---

# Pre-Push Quality Gate

## Overview

**Sync with the base branch, then run every check — all must pass before pushing.** Skipping any step risks breaking CI, introducing formatting drift, or shipping broken builds.

**Core principle:** The gate is binary — everything passes or you don't push. And it runs against the tree CI will build, not the one you happen to have.

## When to Use

- Before any `git push`
- Before creating or finalizing a commit intended for a remote branch
- After making code changes, before opening a PR/MR

## Step 0 — Sync with the base branch (MANDATORY, FIRST)

CI does not build your branch. It builds the **merge of your branch with the current base**. A local checkout goes stale the moment anyone else merges, so a gate run against an unsynced tree validates code that will never exist.

```bash
git fetch origin main                  # or master/develop — whatever the PR targets
git log --oneline HEAD..origin/main    # what landed while you worked
git merge --no-edit origin/main        # or rebase, per the repo's convention
```

Then run the checks below. **Order is not negotiable**: syncing after the checks means pushing a merge nothing validated.

If the merge conflicts, resolve it and regenerate lockfiles with the repo's tooling before continuing. If dependencies changed in the merge, re-run the install (`npm ci`) — a stale `node_modules` invalidates every check that follows.

## The Gate (MANDATORY)

Run all five from `package.json` scripts in this order:

```bash
# 1. Format check — must CHECK, not rewrite
npx prettier --check .

# 2. Lint
npm run lint

# 3. Types
npm run typecheck

# 4. Build
npm run build

# 5. Tests
npm test
```

**All five must exit 0. If any fails — stop, fix, re-run from step 1.**

### Read the exit code, not the summary

A step's own summary can print reassuring totals while the process exits non-zero. Vitest, for example, reports a source-level type error as an unhandled error and still prints `Test Files 59 passed | Type Errors no errors` — the only truthful signal is `echo $?`. Never conclude a step passed because its last lines looked green.

### Why typecheck is its own step

`build` does not substitute for it. A Next.js build type-checks the application graph, so a type error in a **test file** compiles clean and exits 0 — the exact shape of error most likely to appear in a branch that has drifted from its base. Run `tsc --noEmit` over the whole project, which is what CI does.

### Why the format step must be `--check`

`npm run format` is usually `prettier --write`: it rewrites files and exits 0 no matter what. A step that cannot fail is not a gate. Use `--check` here and `--write` to fix.

## Match the gate to the repo's CI

The five above are the default. Before trusting them, read the CI workflow and make the gate a **superset** of what CI runs:

```bash
cat .github/workflows/*.yml | grep -B 2 -A 5 "run:"
```

If CI runs a step you don't, add it. If CI sets an env var to make a step pass (`NODE_OPTIONS=--max-old-space-size=4096` for a memory-hungry build), set it locally too.

## Handling Missing Scripts

Check `package.json` first if unsure what scripts exist:

```bash
cat package.json | grep -A 20 '"scripts"'
```

| Script missing | Action |
|---|---|
| format/prettier | Fall back to `npx prettier --check .` |
| `lint` | Check for `eslint`, `tslint`, `check` |
| `typecheck` | Check for `tsc`, `types`, `check-types`; else `npx tsc --noEmit` |
| `build` | Check for `compile`, `tsc`, `bundle` |
| `test` | Check for `test:unit`, `spec`, `jest`, `vitest` |

If the script genuinely doesn't exist in the project, note it explicitly — don't silently skip.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Running the gate without fetching the base first | CI builds the merge, not your tree — sync is step 0 |
| Syncing after the checks instead of before | The merge you push is then unvalidated |
| Running only tests before push | Each step catches a different failure mode |
| Treating `build` as a typecheck | It skips test files; run `tsc --noEmit` separately |
| Trusting a green summary over the exit code | Some runners print passing totals and exit 1 |
| Skipping prettier "because it's cosmetic" | Formatting failures block CI; run it |
| `--no-verify` to bypass hooks | Never. Fix the underlying issue |

## Red Flags — STOP

- "Tests pass so it's fine to push"
- "My branch was only a few commits behind"
- "The build succeeded, so the types are fine"
- "I'll fix the lint warnings in a follow-up"
- "Build takes too long, I'll skip it this once"
- "CI will catch it"

**All of these mean:** Sync, then run the gate. Don't push until everything passes.

## Why Each Step Matters

| Step | Catches |
|---|---|
| sync with base | Type and API drift from work merged while you were on the branch |
| format | Formatting drift that fails CI format checks |
| lint | Code quality issues, unused vars, rule violations |
| typecheck | Compilation errors anywhere in the project, test files included |
| build | Bundler, import, and codegen failures the typechecker cannot see |
| test | Regressions, broken logic, failing assertions |

## What this gate cannot do

Syncing narrows the window between your tree and CI's; it does not close it. The base can still move between your last check and CI's run, and only a merge queue removes that entirely. The gate's promise is that a failure caused by *known* upstream work never reaches CI — not that CI can never surprise you.
