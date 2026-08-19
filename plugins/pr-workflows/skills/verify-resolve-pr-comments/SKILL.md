---
name: verify-resolve-pr-comments
description: Use when re-checking your own inline review comments on a pull or merge request after the author says they fixed them — to independently verify each concern was genuinely addressed by the new commits and resolve only the ones that were. Triggers on "they fixed my comments", "re-check my review", "verify and resolve my PR/MR comments", "did they address my feedback".
---

# Verify & Resolve My Own Review Comments

## Delegate to a Sonnet subagent

**Do not run this verification inline.** Judging fixed/partial/not-fixed against your own prior comments is well-specified enough to not need this session's model tier or its accumulated context.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched verify-resolve-pr-comments subagent, skip this section and go straight to **Step 1** below.

Otherwise, spawn a subagent to run the full flow (it needs Bash access for the plumbing script):

```
Agent({
  description: "Verify and resolve MR comments",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the verify-resolve-pr-comments subagent. Invoke the
    verify-resolve-pr-comments skill yourself and follow it directly end-to-end — you
    are the dispatched subagent, so do not delegate further. MR: <IID/URL>. Repo:
    <group/subgroup/repo, if not the current directory>. Follow the destructive-action
    gates exactly as written (never resolve NOT/PARTIAL comments; ask before
    approving). Return the Step 6 verification table."
})
```

Relay the subagent's verification table to the user, and handle the approval ask yourself if the subagent says it's pending.

You left inline review comments on a GitLab MR. The author pushed commits and says "fixed it."
Your job: independently re-read the NEW code, judge whether each of YOUR concerns is genuinely
addressed, and resolve only the ones that are. Leave the rest open with a reason.

**The author's word and the "resolved" flag are claims, not evidence.** A developer can mark your
comment resolved without fixing it. You verify against the actual new code and CI — never against
status.

Repo-agnostic: pass `--repo <group/subgroup/repo>` to every command to target a repo other than the
current working directory. All plumbing lives in `pr_review_comments.py` in this skill directory.

## Step 1 — Get the MR IID

Require an MR IID or URL as input. From a URL, extract the trailing number
(`.../-/merge_requests/2385` → `2385`). **If no IID/URL was given, STOP and ask** — do not guess
from the current branch.

## Step 2 — List MY inline comments (resolved AND unresolved)

```bash
python3 pr_review_comments.py list --pr <NUMBER> [--repo <slug>]
```

Returns JSON of every inline discussion whose first note is yours (matched against `glab api user`),
**including ones the author already marked resolved** — those are exactly the cases worth
double-checking. Each entry gives you `discussion_id`, `resolved`, `file`, `old_line`/`new_line`,
`posted_against_head_sha`, `current_head_sha`, `head_moved`, and the comment `body`.

If `count` is 0, report that you have no inline comments to verify and stop.

## Step 3 — See what actually changed at each comment's anchor

Each comment carries the head SHA it was posted against. Diff that against the current head for the
file to see what the author changed:

```bash
git fetch origin                       # ensure both SHAs are local (or `glab mr checkout <IID>`)
git diff <posted_against_head_sha>..<current_head_sha> -- <file>
```

When `head_moved` is `false`, nothing was pushed since your comment — the concern is untouched by
definition; mark it **not fixed**. When the local clone lacks a SHA, fetch the MR ref or read the
file at the current head via `glab api "projects/{id}/repository/files/{enc_path}?ref={head_sha}"`.

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
- **Ask before approving the MR.** Do not run `glab mr approve` unprompted.
- **Repo gotchas:** `glab mr approve` can return 401 on interactive re-auth, and the MR may already
  be merged — check MR state before any approve/resolve and report it instead of erroring out.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Trusting `resolved: true` as "fixed" | Read the new code; resolved is a claim, verify it (Step 4) |
| Skipping resolved comments | `list` returns them on purpose — they're the prime suspects |
| Resolving a partial/unfixed comment to "clean up" | Leave it open with a reason; resolving is outward-facing |
| Diffing against the wrong base | Use `posted_against_head_sha`..`current_head_sha`, not main |
| Approving the MR without asking | Approval is outward-facing — ask first |
