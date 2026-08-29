---
name: steward
description: House posture for driving a pull/merge request to green — what to do on red CI, merge conflicts, review threads, and when standing down is allowed. Use whenever watching, babysitting, or stewarding a PR/MR: on every CI failure, review comment, or conflict event, and at every scheduled check-in on an open change request. Also the canonical source for each repo's `.claude/skills/steward/SKILL.md`.
---

# PR Steward

The posture for any change request this session opened or was asked to drive.
Remote sessions read this file from a repo's `.claude/skills/steward/SKILL.md`
on PR events; the copy in each app repo is synced from this plugin.

**Announce at start:** "I'm using the steward skill."

## The contract

A stewarded change request is done when it is merged or closed. Until then,
every event and every check-in ends in exactly one of three states:

1. **A pushed fix** — the deliverable is the push, never a comment describing it.
2. **An established blocker** — the failure is proven not to be this change's
   (see *Standing down*), recorded once.
3. **A question** — asked once, with enough context to answer without scrolling
   back, only when both sides of a decision lose behavior.

A red or conflicted head is work now, whatever its review state. Only a green,
mergeable head waits on reviewers. Ending an event with none of the three
states is the one failure mode this skill exists to prevent.

## Order of work

Work the whole head state on each event, in this order — a design question in
one thread never excuses skipping the nits in the same review:

1. **Merge conflict** — bring the base branch in with a merge commit, keeping
   the branch's existing history intact for anyone with a checkout. Regenerate
   lockfiles and generated files with the repo's own tooling. Validate, push.
2. **Red CI** — root-cause it (next section), fix, validate, push.
3. **Review threads** — implement small, local asks (nits, renames, an added
   test, a one-function refactor) and resolve the thread. For a larger ask on
   someone else's change, reply with a proposal and leave the decision to the
   author. Treat a bot finding as a bug report: verify it, then fix or refute
   it. After pushing for a changes-requested review, re-request the reviewer.

## Red CI

"Flake" is a verdict, not a hypothesis. A test failure gets one of:

- **Fix in scope** — the failure is in code the change touches or breaks:
  reproduce it locally, fix, show the same check passing, push.
- **Ported fix** — the failure is unrelated but a fix already exists (a revert,
  a fix PR whose diff you have read): port that change into this branch and
  push; it no-ops once the base carries it.
- **Established flake** — the failure names a service the diff never touches
  and reproduces identically on one re-run, or is red on the base branch too.
  At most one re-run total, spent only here or on a job that died before any
  test body ran. A second failure is real.

Tests stay enabled and unquarantined; green comes from fixing the code the
test guards. CI re-runs come from pushing a real change, never from an empty
commit or closing and reopening.

## Validated pushes

One validated push beats three speculative ones — a push that turns CI red
costs a cycle and the reviewers' trust:

- Run the repo's own fast checks first (lint, typecheck, changed-package
  tests — whatever `pre-push-quality-gate` or the contributing docs name).
- For a CI fix, reproduce the original failure before claiming the fix.
- Re-read the diff adversarially: what would make CI reject this?
- Keep each fix minimal — what the failure or comment needs, nothing wider.

## Standing down

Standing down is loud and single: one comment on the change request naming the
failing check, why it is not this change's failure, and the fix ported (or
that none exists yet). One comment per cause — a repeat event on the same
established blocker is a silent re-check, not a new comment.

## Cadence

Events under-deliver: CI success, pushes, and conflict transitions can arrive
late or not at all. While the head is red, conflicted, or awaiting a re-check,
keep a check-in scheduled (~1 hour out) that re-reads merge state, CI on the
latest commit, and open threads, then re-arms. Quiet check-ins re-arm silently.
Stop when the change request is merged or closed, or the user says stop.
