---
name: finalize-pr
description: Use when polishing a branch/PR for shipping or maintaining an open PR — "run /review and /simplify and push", "fix any issues and push", "make sure it's aligned with my global rules then commit and push", "pull latest main and merge into PR N", "PR X was merged, sync main into my PR", "rebase this PR and fix conflicts".
---

# Finalize / Maintain a PR

A fixed orchestration for the two recurring end-of-PR flows. Both run in a worktree and both end with the quality gate. Do not skip steps or reorder them.

## Delegate the whole flow to a Sonnet subagent

**Do not run this flow inline.** Both flows below are a fixed, well-specified sequence of steps (review → simplify → verify against rules → quality gate → commit/push) — Sonnet is "near-Opus quality on coding and agentic work" per Anthropic's own model guidance, and running it inline means the fixes and quality-gate output ride on this session's full accumulated context and model tier at whatever cost that carries.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched finalize-pr subagent, skip this section and proceed directly with **Pick the flow** below.

Otherwise, spawn a subagent to run the entire flow (it needs Bash/Edit/Write access, which subagents have):

```
Agent({
  description: "Finalize PR",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the finalize-pr subagent for <repo absolute path>, worktree
    <worktree path if one exists>, PR <number/branch>. Invoke the finalize-pr skill
    yourself and follow it directly end-to-end — you are the dispatched subagent, so
    do not delegate further. Flow: <'polish & ship' or 'sync main into PR'>. Report
    back exactly what you fixed, the quality-gate result, and the final commit/push
    outcome."
})
```

Relay the subagent's final report to the user.

## Pick the flow

- **Polish & ship** — "run /review and /simplify, fix issues, verify against my rules, commit, push" → start at Step 2.
- **Sync main into an open PR** — "PR N merged, pull latest main, merge into my PR M / rebase, fix conflicts" → start at Step 1.

## Step 1 — Sync with main (sync flow only)

In the PR's worktree (**REQUIRED SUB-SKILL:** superpowers:using-git-worktrees if one doesn't exist):

```bash
git fetch origin
git checkout main && git pull origin main
git checkout <pr-branch>
git merge origin/main          # or: git rebase origin/main — match the PR's existing history style
```

Resolve conflicts. Re-run the build before continuing so a conflict resolution doesn't silently break compilation. Then continue to Step 2.

If the conflicts are more than trivial, **REQUIRED SUB-SKILL:** Use fix-pr-conflicts for this step — it resolves on three-way (merge-base) evidence and separates pre-existing target-branch breakage from breakage the merge caused. Return here for Step 2 afterwards, and skip its push step: this flow pushes once, at Step 6.

## Step 2 — /review

Run `/review` on the diff. Triage findings: fix real correctness issues; note false positives. Do not auto-apply every suggestion blindly.

## Step 3 — /simplify

Run `/simplify` for reuse / simplification / efficiency / altitude cleanups (quality only — `/review` already covered correctness). Apply the fixes.

## Step 4 — Verify against global rules

Re-read the findings against `~/.claude/shared-rules.md` (and the repo's `.claude/rules/` if present). Common ones to self-check: braces on all control flow, no `as` casts, explicit class access modifiers, `T[]` over `Array<T>`, no unexplained comments, no `eslint-disable`. Fix violations.

## Step 5 — Quality gate

**REQUIRED SUB-SKILL:** Use pre-push-quality-gate — run every step it lists, from `package.json`, before any commit/push. Inside a worktree, run scripts per that skill's worktree notes (`node_modules` may live in the main repo).

## Step 6 — Commit & push

Conventional commit (`<type>(<scope>): <desc>`). **Use `fix`/`feat`, never `chore`, for anything that should ship** — `chore` does not trigger the release pipeline. End the message with the standard `Co-Authored-By` trailer.

```bash
git commit -m "fix(AIP-N): <description>" && git push
```

If a fresh PR is needed rather than an update, **REQUIRED SUB-SKILL:** Use creating-prs.

## Red flags — do not declare done if

- You pushed without the quality gate passing — every step of it, green.
- You applied `/review` or `/simplify` suggestions without checking them against the global rules.
- You used `chore` for a change that needs to deploy.
- (Sync flow) You merged main but didn't rebuild before re-reviewing.
