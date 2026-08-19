---
name: creating-prs
disable-model-invocation: true
description: Use when creating a pull request or merge request for a feature, bugfix, or docs change — enforces the quality gate, conventional-commit title format, description structure, and separation of environment-specific changes. Works on GitHub (gh) and GitLab (glab).
---

# Creating Pull / Merge Requests

## Overview

A change request's title and description are not cosmetic — conventional-commit
titles drive release automation and changelog generation, and the description is
the only context reviewers and future readers get.

**Core principle:** get the gate right before opening anything. A change request
opened on a dirty tree, a stale branch, or a failing build costs more to unwind
than it saved.

## Forge

Detect the forge once from the origin remote and use the matching CLI. The
command mapping is in `~/.claude/references/forge-cli.md` — read it rather than
guessing flags.

```bash
git remote get-url origin   # github.com → gh,  gitlab → glab
```

## The Gate Function

```
BEFORE creating any change request:

1. QUALITY GATE: Run pre-push-quality-gate (build/test/prettier/lint)
2. VERIFY GIT STATE: clean tree, fresh target, branch up to date
3. RESOLVE TICKET: if the project tracks issues, confirm the reference
4. IDENTIFY: Is this environment-specific? (dev-only or dev+prod?)
5. PREPARE: Title, motivation, description structure
```

Pre-flight git checks:

1. **Clean tree** — `git status --porcelain` is empty, or the user has explicitly
   accepted what is uncommitted.
2. **Fresh target** — `git fetch origin --prune`.
3. **Branch pushed** — the branch exists on the remote.
4. **Branch is up to date with target** — run
   `git merge-base --is-ancestor origin/<target-branch> HEAD`. Non-zero means the
   branch is behind: merge or rebase the target in, resolve conflicts, re-run the
   quality gate, and push before proceeding.
5. **Inspect the change** — `git log --oneline $(git merge-base HEAD origin/main)..HEAD`
   for the commit range and `git diff origin/main...HEAD --stat` for the summary.

## Issue Tracker Reference

Some projects require every change request to reference a tracked issue; others
have no tracker at all. **Follow the project's own convention — do not invent
one, and do not block on a ticket in a project that does not use tickets.**

- **Project uses a tracker** (a `CLAUDE.md` rule, or existing titles carry keys
  like `ABC-123`): extract the key from the branch name
  (`feature/ABC-123-desc` → `ABC-123`), verify it exists via whatever tracker
  integration is configured, and gate on it. If the branch has no key, ask.
- **Project uses GitHub issues**: reference them as `#123` in the description and
  let GitHub link them. Use `Closes #123` when the change request should close it.
- **Project has no tracker** (most personal projects): skip this step entirely
  and use the scopeless title form below.

## Title Format

Follow the Conventional Commits rule in your global `CLAUDE.md`. The scope is the
issue key where the project uses one, and is omitted where it does not.

**With a tracker:** `^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\([A-Z]+-[0-9]+\)!?: .+$`

**Without a tracker:** `^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: .+$`

**Examples:**

- ✅ `feat(ABC-20): Add retry policy to the ingest worker`
- ✅ `fix(ABC-456): Resolve race condition in the model cache`
- ✅ `feat(ABC-315)!: Breaking API change for agent routing`
- ✅ `feat(subscriptions): Let users edit a detected subscription` (no tracker)
- ✅ `fix: Stop the importer retrying a permanently failed row` (no tracker)
- ❌ `ABC-20: Add feature` (missing type)
- ❌ `feat(abc-20): Add feature` (lowercase key)
- ❌ `feat(ABC-20) Add feature` (missing colon)

Where `feat`/`fix` trigger a release pipeline and `chore`/`refactor`/`docs` do
not, prefer `fix` for a shippable change that would otherwise read as `chore`.

## Description Structure

**REQUIRED SUB-SKILL:** use `writing-pr-description` to write the body.

Any issue link in the description must be the verified reference from the step
above — never a placeholder.

## Environment-Specific Changes

**Create SEPARATE change requests when a change affects both dev and prod:**

1. Create `branch-name-dev` with only the dev changes.
2. Open change request #1 for dev.
3. Create `branch-name-prod` with only the prod changes.
4. Open change request #2 for prod.
5. Note in #2's description: "Merge after dev validation (#<first>)".

**Why separate?** Validate dev before touching prod, roll back more easily, and
keep the deployment path obvious.

**Example:**

```
Branch: abc-20-helm-values-dev
File:   values.dev.yaml only
Title:  feat(ABC-316): Add worker env vars to the ingest service (dev)
Opened: #473

Branch: abc-20-helm-values-prod
File:   values.prod.yaml only
Title:  feat(ABC-316): Add worker env vars to the ingest service (prod)
Opened: #474  — description includes "Merge after #473 validated"
```

## Creating It

The description body comes from `writing-pr-description`.

```bash
# Push the branch
git push -u origin HEAD
```

**GitHub:**

```bash
gh pr create \
  --base main \
  --title "feat(scope): Description" \
  --body "$(cat <<'EOF'
<description body from writing-pr-description>
EOF
)"
```

**GitLab:**

```bash
glab mr create \
  --source-branch "$(git branch --show-current)" \
  --target-branch main \
  --title "feat(SCOPE-1): Description" \
  --description "$(cat <<'EOF'
<description body from writing-pr-description>
EOF
)"
```

- If a different target branch is needed, ask the user.
- Add `--draft` if the user wants a draft.

**After it is created:** give the user the URL, and update any tracking file or
project documentation the repo keeps.

## Branch Naming

| Pattern | Example |
|---------|---------|
| `feature/<key>` | `feature/ABC-123-add-retry-logic` |
| `bugfix/<key>` | `bugfix/ABC-456-fix-memory-leak` |
| `hotfix/<key>` | `hotfix/ABC-789-critical-fix` |
| `refactor/<slug>` | `refactor/extract-validation` |
| `chore/<slug>` | `chore/update-dependencies` |

If the branch does not follow the pattern, warn the user but proceed on
confirmation.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Title missing the conventional-commit type | Follow the pattern exactly — the title drives automation |
| Combining dev+prod in one change request | Separate branches, separate requests |
| No motivation section | Add 2–4 sentences on product/engineering value |
| Generic description ("Added changes") | Be specific about what changed and why |
| Lowercase issue key `(abc-20)` | Uppercase: `(ABC-20)` |
| Missing colon after the scope | `(ID):` not `(ID)` |
| No proof of work | Run a real flow and paste the output; otherwise write the ⚠️ missing note |
| `chore` for a shippable change | `chore` skips the release pipeline — use `fix` |
| Blocking on a ticket in a project with no tracker | Use the scopeless title form |

## Red Flags — STOP

- ❌ "I'll just push and open it manually"
- ❌ "The title doesn't need the type, it's obvious"
- ❌ "Combining dev and prod saves time"
- ❌ "Motivation is self-explanatory"
- ❌ "Tests passing is proof enough"

**All of these mean:** pause and follow the skill.

## Error Handling

- **Quality gate failure** — report it, attempt a fix, re-run. Do not proceed
  until it passes.
- **Branch not on remote** — `git push -u origin HEAD`.
- **Wrong project** — check the remote with `git remote -v`.
- **Auth issues** — `gh auth login` or `glab auth login`.
- **CLI missing** — `brew install gh` or `brew install glab`.

## Why This Matters

- **Title format** drives CI/CD and changelog generation.
- **Separate requests** prevent an accidental prod deploy before dev validation.
- **Motivation** gives reviewers and future readers the context.
- **Proof of work** shows the change actually works.
