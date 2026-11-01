---
name: pr-second-review
description: Use when a developer says they fixed review comments and wants a second-pass check — "check if fixed", "they fixed it", "second review", a follow-up after review comments were posted, or a Slack review thread where the author replied after your `commented`. Shows ALL comments I posted (including already-resolved ones — developers sometimes self-resolve without fixing), verifies each against the latest diff, resolves confirmed fixes, runs a fresh pr-review round for anything new, then approves.
---

# Second Review — verify fixes, review again, approve

## Step 0 — Parse the target

A **PR target** is a full PR URL, or a bare number plus `--repo`. From
`https://github.com/owner/repo/pull/437`: repo = `owner/repo`, number = `437`.

**A Slack thread link** (`https://<workspace>.slack.com/archives/<channel_id>/p<digits>`)
stands for the PRs in its parent message. `ts` is the digits after `p` with a `.`
inserted six from the end (`p1793262604241709` → `1793262604.241709`). Read the
thread with `slack_read_thread`, then:

1. Find your last review ack — a reply that is exactly `commented` or
   `commented + approved`. The replies after it are the author's answer.
2. No reply after it → the author has not asked for a re-check. Say so and stop.
3. Load `slack_add_reaction` through `ToolSearch` and react `eyes` on the latest
   reply after `commented`, so the author sees the re-check has started.
4. Take every PR URL in the parent message as a target. Keep `channel_id` and
   `ts` — Steps 6 and 7 report back to that thread.

## Delegate the verification to a Sonnet subagent

**Do not run Steps 1–5 inline.** Checking each comment against explicit fixed/not-fixed criteria is a well-specified task that doesn't need this session's model tier or its accumulated context.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched pr-second-review subagent, skip this section and Step 0, run Steps 1–5, and return.

Otherwise, spawn one subagent per PR, all in a single message:

```
Agent({
  description: "Second-pass review PR <n>",
  model: "sonnet",
  prompt: "You are the pr-second-review subagent. Invoke the pr-second-review skill
    yourself and run Steps 1–5 only — you are the dispatched subagent, so do not
    delegate further. Pull request: <number/URL>. Repo: <slug>. Return the head
    SHA, the Step 4 status table, and which threads you resolved."
})
```

Relay each status table to the user, then continue with Step 6 yourself.

## Step 1 — Fetch metadata and all review threads in parallel

```bash
# metadata
../creating-prs/pr-meta.sh <NUMBER> --repo <slug>

# my own inline threads, with the authenticated user resolved for me
python3 ../verify-resolve-pr-comments/pr_review_comments.py list --pr <NUMBER> --repo <slug>

# Latest diff
gh pr diff <NUMBER> --repo <slug>
```

## Step 2 — Extract ALL comments I posted

The `list` command above already returns exactly this: every inline thread whose
first note is yours, resolved or not, with the authenticated user resolved for
you. Do not re-parse the raw comment JSON — the script has already normalised
it.

Each thread carries `thread_id`, `body`, `file_path`, `line`, `resolved`, and
`resolved_by`. Triage on the last two:

| `resolved` | `resolved_by` | Read it as                                                                                                            |
| ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `false`    | `null`        | 🔴 open — verify against the diff                                                                                     |
| `true`     | you           | ✅ you already closed it                                                                                              |
| `true`     | someone else  | ⚠️ **suspicious** — the author may have self-closed it without fixing the code. Always verify these against the diff. |

Both flags are real, but they are still claims about the code, not evidence
about it — verify a `true` against the diff rather than trusting it.

## Step 3 — Verify each comment against the latest diff

For every comment I posted (resolved or not), read the relevant section of the new diff or the updated file at HEAD and decide:

- **Fixed** — the concern is gone in the new code (name changed, test added, type corrected, duplication removed, etc.)
- **Not fixed** — the code still has the problem I flagged.
- **Follow-up / N/A** — the comment was explicitly a suggestion for a future change; treat as fixed.

To read a file at HEAD:

```bash
gh api "repos/<slug>/contents/<PATH>?ref=<HEAD_SHA>" --jq '.content' | base64 -d | cat -n
```

## Step 4 — Present a status table to the user

| #   | Comment (truncated)  | Resolved?       | Actually fixed? |
| --- | -------------------- | --------------- | --------------- |
| 1   | Missing `public` on… | ✅ by me        | ✅ Yes          |
| 2   | Counter duplication… | ⚠️ by developer | ✅ Yes          |
| 3   | Misleading name…     | 🔴 open         | ✅ Yes          |
| 4   | Test missing assert… | ⚠️ by developer | ❌ No           |

If any comment is **not actually fixed** — regardless of who resolved it — say so clearly; the PR is not approvable this round.

## Step 5 — Resolve all unresolved-by-me discussions that are confirmed fixed

For each of my threads that is not already resolved by me and whose concern is confirmed fixed:

```bash
python3 ../verify-resolve-pr-comments/pr_review_comments.py resolve --pr <NUMBER> --thread <ID> --node-id <NODE_ID> --repo <slug>
```

Run in parallel. Skip threads already resolved by me.

## Step 6 — Run a fresh pr-review round

The fixes are new code, and the first round can have missed things. Invoke the
`pr-review` skill through the `Skill` tool with the **PR URLs** as args — not
the Slack link, which would send it back here — plus one line: "Second round:
the comments in this table are already verified; raise only new findings", with
each PR's Step 4 table.

`pr-review` merges its report, asks once, and posts on yes. From a Slack target,
hold the thread reply until Step 7 settles approval — the round gets one reply.

## Step 7 — Approve

Approve a PR when every Step 4 comment is fixed and the Step 6 round raised
nothing for it:

```bash
gh pr review <NUMBER> --approve --repo <slug>
```

A PR with an unfixed comment or a new finding waits: report it and approve only
when the user says so.

From a Slack target, reply once in the thread (`slack_send_message` with
`channel_id` and `thread_ts` = `ts`) with exactly one of:

| Comments posted this round | Approved | Reply                  |
| -------------------------- | -------- | ---------------------- |
| yes                        | yes      | `commented + approved` |
| yes                        | no       | `commented`            |
| no                         | yes      | `approved`             |

On approval, also react `white_check_mark` on the parent message. From a plain
PR target, ask:

> "Done — approved. Want me to reply in a Slack thread? If so, drop the thread URL."

and on a URL, reply `approved` in that thread.
