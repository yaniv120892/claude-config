---
name: recurring-maintenance
disable-model-invocation: true
description: Drip-feed a backlog of mechanical cleanup — deprecations, dependency bumps, dead flags, flaky tests — one item per run, each as its own ticket, worktree, and small PR. Use when a repo has many instances of the same safe change and you want them landed steadily and reviewably rather than in one unreviewable sweep.
---

# Recurring Maintenance

A harness for backlogs where the same safe change applies in many places: feature flags
past their expiry, framework deprecations, dependency bumps, quarantined tests. It trades
throughput for reviewability — one item per run, each in its own PR a human actually
reads.

Instantiate it by supplying the four task-specific pieces marked **[task]** below. The
sequencing, the safety rules, and the "one per run" discipline are the reusable part.

## The rule that makes this work

**Each run processes exactly ONE item:** the oldest qualifying candidate with no open PR.
Do not bundle several into one ticket or PR. Leave the rest for the next run.

Bundling is the failure mode this exists to prevent. Twelve mechanical changes in one PR
gets skimmed and rubber-stamped; the one that wasn't mechanical rides along unnoticed.

**Never merge.** A human reviews every PR. You open it and stop.

## Step 1 — Identify candidates

Search **`origin/<default-branch>`**, not the working branch — a candidate that exists
only locally isn't deployed and can't qualify.

**[task]** Define the marker to search for and how to classify a hit:

- **Candidate** — the state you're migrating *from*.
- **Already done** — the state you're migrating *to*; skip.
- **Out of scope** — tests, mocks, fixtures, vendored code; skip.

List every candidate with file, line, and identifier.

## Step 2 — Verify age

An item qualifies only once it has been deployed long enough to be safely retired.

Find the introducing commit, then the first release tag containing it:

```bash
git log origin/main --oneline -S "<identifier>" | tail -1
git merge-base --is-ancestor <sha> origin/main      # must be on the default branch
git tag --sort=creatordate --contains <sha> | head -1
git show <tag> --format="%ci" -s
```

**[task]** Define the minimum age (e.g. "first release tag older than 3 days").

**If you cannot confidently establish the deployment date, it does not qualify.** Record
the tag, date, and computed age for each candidate — that record is what makes the
selection auditable when someone asks why this item and not another.

## Step 3 — Select exactly one

From the qualifying set:

1. **Skip anything already in flight** — an open PR/MR referencing it, or an unmerged
   remote branch (`git branch -r | grep <key>`). Use the forge CLI; mapping is in the
   `pr-workflows` plugin's `references/forge-cli.md`.
2. Pick the **oldest** by first-release-tag date among what remains.
3. If everything qualifying is already in flight, **report that and stop** — no ticket,
   no branch, no PR. A run that correctly does nothing is a success, not a failure.

## Step 4 — Ticket and worktree

- Create a ticket (see the `issue-tracker` plugin). Title it for the single item; put the
  identifier, file/line, and measured age in the description so a reviewer can verify the
  age claim without redoing the archaeology.
- Branch **from `origin/<default-branch>`**, never from the current working branch:

```bash
git worktree add .claude/worktrees/<TICKET> -b <TICKET>/<slug> origin/main
```

## Step 5 — Make the change

**[task]** Define the transformation precisely, including its non-obvious invariants.

Two rules that generalize past any one task:

- **Count the call sites.** If a marker appears N times, the replacement usually needs to
  appear N times. Consolidating N occurrences into one is the classic way these
  migrations break — it looks tidier and changes behaviour.
- **Clean up what the change orphans** — now-unused imports, helpers, config entries.
  Leaving them means the next run's search still finds ghosts of this one.

## Step 6 — Open the PR

Small, single-purpose, and titled as a conventional commit (it becomes the squash message).
Link the ticket. Say in the description what was verified — which tag, what age — so the
reviewer checks the reasoning rather than re-deriving it.

Then stop. Do not merge.

## Step 7 — Report

Always end with a short summary, including on a no-op run:

- The item processed (or why none qualified)
- Ticket key and PR URL
- How many candidates remain for future runs

That remaining count is what tells the user whether this is converging or whether the
backlog is growing faster than the drip.
