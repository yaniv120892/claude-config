---
name: fix-pr-conflicts
description: Use when a pull request has merge conflicts that need resolving, committing, and pushing back to the same source branch — "there are conflicts in the PR <link>", "fix the conflicts on PR 10", "this PR can't be merged, resolve it", "resolve conflicts and push", or a bare PR URL paired with the word conflict.
---

# Fix Merge Conflicts on a Pull Request

Takes a PR link (or number), merges the target branch in, resolves every conflict on
the evidence rather than by picking a side, verifies, and pushes back to **the same source
branch** so the existing PR updates in place.

Scope is deliberately narrow: conflicts only. It does not review, simplify, or refactor.
For "sync main in, then review and polish", use **finalize-pr** instead — that skill's
Step 1 covers conflicts in one line and then moves on; this one is the deep version.

## Delegate the whole flow to a Sonnet subagent

**Do not run this flow inline.** It is a fixed, well-specified sequence (identify → merge →
resolve → verify → push) and Sonnet is near-Opus on exactly this kind of agentic coding
work. Running it inline burdens the resolution with this session's accumulated context.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched
fix-pr-conflicts subagent, skip this section and start at Step 1.

```
Agent({
  description: "Fix pull request conflicts",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the fix-pr-conflicts subagent. Repo: <absolute path>. PR: <url or number>.
    Invoke the fix-pr-conflicts skill yourself and follow it end-to-end — you are the
    dispatched subagent, so do not delegate further. Read the repo's CLAUDE.md and
    .claude/rules/ (if present) before resolving anything; those files are the tiebreaker
    when two sides disagree. Report back: each conflicted file and how you resolved it with
    the reason, what verification you ran and its result, which failures were pre-existing
    on the target branch vs. caused by the merge, and the push outcome."
})
```

Relay the subagent's report to the user, including the per-file resolution reasoning.

## Step 1 — Identify the pull request from the link

Never assume the source/target branches. Ask the API, through the authenticated CLI (never
extract its token):

```bash
# metadata
../creating-prs/pr-meta.sh <number> --repo <slug>

# or directly
gh pr view <number> --repo <owner/repo> \
  --json headRefName,baseRefName,mergeable,mergeStateStatus,headRefOid,author,isCrossRepository
```

The repo slug is the `<owner>/<repo>` part of the URL before `/pull/<n>`. Confirm
`mergeable` is actually `CONFLICTING` — if it is already `MERGEABLE`, stop and say so rather
than manufacturing a merge commit.

Stop and ask the user first if: the PR is authored by someone else, or
`isCrossRepository` is true (a fork — you cannot push to it by default).

## Step 2 — Isolate, then merge the target branch in

Work in a git worktree, never in the user's live checkout (**REQUIRED SUB-SKILL:**
superpowers:using-git-worktrees, or the EnterWorktree tool when available).

```bash
git fetch origin --prune
git log --oneline -1 origin/<source_branch>    # confirm you are starting from the PR tip
git merge origin/<target_branch> --no-edit
```

Match the PR's existing history style: if that branch already carries merges from the
target, merge. Only rebase if the branch history is linear **and** nobody else is working
on it — a rebase forces a force-push, which Step 6 forbids.

If a previous session left a local half-done merge on a scratch branch, prefer resetting to
the pushed PR tip (`git reset --hard origin/<source_branch>`) and merging fresh. One
reviewable resolution beats a stack of unreviewed local ones.

## Step 3 — Resolve each conflict on three-way evidence

**The conflict markers alone are not enough evidence to resolve a conflict.** They show you
two results, not two intentions, and the intention is what you need. Both sides editing
adjacent-but-different things looks identical to both sides fighting over the same thing.

For every conflicted file, read all three versions before touching it:

```bash
BASE=$(git merge-base HEAD origin/<target_branch>)
git show "${BASE}:<path>"                  # what both sides started from
git show HEAD:<path>                       # ours — the MR
git show "origin/<target_branch>:<path>"   # theirs — the target
git diff "${BASE}" origin/<target_branch> -- <path>   # what the target actually changed, and why
```

> Note for zsh: always brace the ref (`"${BASE}:path"`). Unbraced `$BASE:l...` is eaten by
> zsh's `:l` modifier and silently gives you a mangled ref.

This is the step that catches the resolutions that look obvious and are wrong. A real case:
markers suggested the target branch had *added* a per-field comment that the MR wanted
gone. The base showed it had contained **both** a section header and that per-field comment
— the target deleted the header, the MR deleted the comment. Each side deleted a *different*
half. Taking either side wholesale would have silently reverted the other's intent.

Rules for choosing:

- **Keep both intents whenever they are compatible.** Most conflicts are two edits near each
  other, not a genuine contradiction.
- **When they genuinely contradict, the repo's own written conventions decide** — its
  `CLAUDE.md` and `.claude/rules/`. Cite the rule in your report. A convention the target
  branch itself has already adopted outranks the PR's older local variant.
- **Preserve the PR's functional change.** The PR exists for a reason; a resolution that
  quietly drops the behaviour it was opened to deliver is a failed resolution, even when it
  compiles. Re-read the PR description and confirm its point survived.
- **Never resolve by deleting whichever side is inconvenient**, and never "resolve" by
  keeping both copies of the same declaration.
- Do not fix unrelated problems you notice. No drive-by edits — they make the merge
  unreviewable.

Then confirm nothing is left behind:

```bash
grep -rn '^<<<<<<<\|^>>>>>>>\|^=======$' --include='*.ts' --include='*.md' . | grep -v node_modules
git diff --name-only --diff-filter=U      # must be empty before committing
```

Also grep the whole tree for identifiers the merge touched (a renamed/removed config field,
a deleted helper). An auto-merged hunk elsewhere can still reference the old name — that
compiles as long as nothing typechecks it, and CI often does not.

## Step 4 — Establish the pre-existing-failure baseline

A merge resolution is only as trustworthy as your ability to tell *your* breakage from
breakage the target branch already had. Do this **before** reporting anything as broken.

For any file that fails typecheck/lint/test:

```bash
git diff origin/<target_branch> -- <failing file> | wc -l
```

Zero lines means that file is byte-identical to the target branch, so the failure is
pre-existing and not yours — say so explicitly instead of fixing it (that would be scope
creep) and instead of hiding it (the user needs to know CI is already red).

Watch for lint-suppression baselines (`eslint-suppressions.json` and friends). A merge
routinely leaves an entry with nothing left to suppress, which is itself an error. If you
prune, **never run a scoped prune** (`eslint <one-project> --prune-suppressions`) — it
deletes entries for every file it did not lint. Back the file up, prune, diff, restore, then
apply only the entry that is genuinely yours.

## Step 5 — Verify

Run the repo's real gates from its `package.json`
(**REQUIRED SUB-SKILL:** pre-push-quality-gate — it owns the step list). Its base-sync
step is already satisfied here: resolving the conflict is that merge. In a worktree,
`node_modules` may live in the main checkout; follow that skill's worktree notes.

- A conflict resolution that compiles can still be semantically wrong. Prefer running the
  affected tests over trusting the diff.
- Beware a build that reports a **100% cache hit** — that is not evidence your merged tree
  builds. Re-run the deployables with `--skip-nx-cache` (or the equivalent) at least once.
- Know what the repo's CI actually gates. If CI only lints changed apps, or a test job is
  `allow_failure`, a green pipeline will not catch a bad resolution — run those gates
  locally and say which ones you ran.

## Step 6 — Commit and push to the same source branch

Commit the merge (a merge commit needs no `-m`; `git commit --no-edit` keeps the standard
message). Give it a message naming both branches:

```bash
git commit --no-edit
git commit --amend -m "Merge branch '<target_branch>' into <source_branch>"
```

Push back to the PR's source branch. When your worktree branch has a different local name,
use an explicit refspec:

```bash
git push origin <local_branch>:<source_branch>
```

**Never** `--force` / `--force-with-lease` (it rewrites a branch the PR author and reviewers
are reading), never push to `main`/`master`, and never merge the PR. If the push is rejected
as non-fast-forward, someone else pushed — re-fetch and redo the merge on the new tip;
do not force past it.

Then confirm the PR agrees:

```bash
gh pr view <number> --repo <owner/repo> --json mergeable,mergeStateStatus,state
```

GitHub needs a few seconds to recompute the flag; expect a stale `CONFLICTING` immediately
after the push. Report the actual value — do not assume the push fixed it.

## Red flags — do not declare done if

- You resolved any conflict without reading the merge-base version of that file.
- The PR's own functional change did not survive your resolution.
- Conflict markers, or unmerged paths, remain anywhere in the tree.
- You reported a failure as yours without the Step 4 baseline check — or reported the tree
  as clean when the target branch was already red.
- You force-pushed, pushed to a protected branch, merged the PR, or pushed to a fork you
  were not asked to touch.
- You "fixed" things unrelated to the conflicts.
- You said the PR is mergeable without re-querying the API for it.
