---
name: verify-resolve-pr-comments
description: Use when re-checking your own inline review comments on a pull request after the author says they fixed them — to independently verify each concern was genuinely addressed by the new commits and resolve only the ones that were. Triggers on "they fixed my comments", "re-check my review", "verify and resolve my PR comments", "did they address my feedback".
---

# Verify & Resolve My Own Review Comments

## Delegate to a Sonnet subagent

**Do not run this verification inline.** Judging fixed/partial/not-fixed against your own prior comments is well-specified enough to not need this session's model tier or its accumulated context.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched verify-resolve-pr-comments subagent, skip this section and go straight to **Step 1** below.

Otherwise, spawn a subagent to run the full flow (it needs Bash access for the plumbing script):

```
Agent({
  description: "Verify and resolve PR comments",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the verify-resolve-pr-comments subagent. Invoke the
    verify-resolve-pr-comments skill yourself and follow it directly end-to-end — you
    are the dispatched subagent, so do not delegate further. PR: <number/URL>. Repo:
    <owner/repo, if not the current directory>. Follow the destructive-action
    gates exactly as written (never resolve NOT/PARTIAL comments; ask before
    approving). Return the Step 6 verification table."
})
```

Relay the subagent's verification table to the user, and handle the approval ask yourself if the subagent says it's pending.

You left inline review comments on a pull request. The author pushed commits and says "fixed it."
Your job: independently re-read the NEW code, judge whether each of YOUR concerns is genuinely
addressed, and resolve only the ones that are. Leave the rest open with a reason.

**The author's word and the "resolved" flag are claims, not evidence.** A developer can mark your
comment resolved without fixing it. You verify against the actual new code and CI — never against
status.

Repo-agnostic: pass `--repo <owner/repo>` to every command to target a repo other than the
current working directory. All plumbing lives in `pr_review_comments.py` in this skill directory.

## Step 1 — Get the PR number

Require a PR number or URL as input. From a URL, extract the trailing number
(`.../pull/2385` → `2385`). **If no number/URL was given, STOP and ask** — do not guess
from the current branch.

## Step 2 — List MY inline comments (resolved AND unresolved)

```bash
python3 pr_review_comments.py list --pr <NUMBER> [--repo <slug>]
```

Returns JSON of every inline thread whose first comment is yours (matched against `gh api user`),
**including ones the author already marked resolved** — those are exactly the cases worth
double-checking. The shape is `{"me": <login>, "threads": [...]}`, and each thread gives you
exactly these fields:

`thread_id`, `author`, `body`, `file_path`, `line`, `resolved`, `resolved_by`.

`thread_id` is what Step 5's `resolve` takes. There is no per-comment SHA and no `head_moved`
flag — Step 3 works from the diff instead.

If `threads` is empty, report that you have no inline comments to verify and stop.

## Step 3 — See what actually changed at each comment's anchor

Read the PR's own changes for the file the comment sits on:

```bash
git fetch origin pull/<NUMBER>/head
git diff origin/<BASE_BRANCH>...FETCH_HEAD -- '<file_path>'
```

Single-quote `<file_path>` — a `[tenant]`-style route folder is a shell glob and expands to
nothing unquoted.

Without a local clone, read the file at the current head instead:

```bash
gh api "repos/<slug>/contents/<PATH>?ref=<HEAD_SHA>" --jq '.content' | base64 -d | cat -n
```

Judge against the thread's `line` and `body`. If the file is absent from the diff entirely, nothing
was changed there — mark it **not fixed** without further reading.

## Step 4 — Verify genuinely (this is the judgment, not the plumbing)

Read the new code around the anchor and decide, per comment, against the SPECIFIC concern you raised:

- **fixed** — the new code resolves exactly what you flagged.
- **partial** — addressed in one place but not others, or fixed differently with a residual gap.
- **not** — unchanged, cosmetically changed, or changed elsewhere while the flagged spot still stands.

Do not infer "fixed" from the `resolved` flag, the author's comment, or the mere presence of a diff.
**If a comment is marked `resolved: true` but the code does NOT address your concern, flag that
loudly** — that is the failure mode this skill exists to catch.

## Step 5 — Resolve ONLY the genuinely-fixed comments

```bash
python3 pr_review_comments.py resolve --pr <NUMBER> --thread <THREAD_ID> [--repo ...]
```

Run once per confirmed comment. Leave **partial** and **not** open — their continued existence is the
signal to the author.

## Step 6 — Report a verification table

| Comment (gist) | file:line | What the author changed | Verdict | Resolved? |
|---|---|---|---|---|
| Missing config on 2 of 4 ctors | `modelToSettingsConfig.ts:240` | Added to all 4 constructors | fixed | ✅ yes |
| Tools onChange test gap | `AnnotationConfigControls.tsx:69` | No new test | not | ❌ left open |

Call out separately any comment that was `resolved: true` but you judged **not**/​**partial**.

## Gate destructive / outward actions

- **Never resolve a comment you judge NOT or PARTIAL.** Resolving is outward-facing and signals the
  author it's handled — only do it for genuinely-fixed concerns.
- **Ask before approving the PR.** Do not run `gh pr review --approve` unprompted.
- **Repo gotchas:** `gh pr review --approve` cannot approve your own PR, and the PR may already
  be merged — check PR state before any approve/resolve and report it instead of erroring out.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Trusting `resolved: true` as "fixed" | Read the new code; resolved is a claim, verify it (Step 4) |
| Skipping resolved comments | `list` returns them on purpose — they're the prime suspects |
| Resolving a partial/unfixed comment to "clean up" | Leave it open with a reason; resolving is outward-facing |
| Diffing against the wrong base | Use `posted_against_head_sha`..`current_head_sha`, not main |
| Approving the PR without asking | Approval is outward-facing — ask first |
