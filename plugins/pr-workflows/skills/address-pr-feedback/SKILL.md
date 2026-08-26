---
name: address-pr-feedback
description: Use when someone leaves review comments on a pull or merge request you authored and you want them handled. Triggers on "I got comments on my PR/MR", "address my MR feedback", "respond to the review on my MR", "someone reviewed my PR, handle it", "go through my MR comments", "fix the comments on PR/MR <n>".
---

# Address Reviewer Feedback on My MR

A reviewer left comments on a change request **you authored**. Work through each one, fix what is genuinely
right, push the fixes, and reply in every thread. This is the author-side counterpart to
`verify-resolve-pr-comments` (which is the reviewer re-checking their own comments).

**REQUIRED BACKGROUND:** Use `superpowers:receiving-code-review` for the judgment — external feedback
is a suggestion to *evaluate against this codebase*, not an order to implement. Verify before
implementing; push back with technical reasoning when the reviewer is wrong. **No performative
agreement, no "thanks."**

Repo-agnostic: pass `--repo <group/subgroup/repo>` to every command to target a repo other than the
current working directory. Plumbing lives in `pr_feedback.py` in this skill directory.

## Step 0 — Resolve a Slack link to an MR (if given one)

If the input is a Slack message/thread URL (`https://<workspace>.slack.com/archives/<channel_id>/p<digits>`)
instead of an MR IID/URL, read the thread first: `channel_id` is the path segment after `archives/`;
`message_ts` is the digits after `p` with a decimal point inserted 6 digits from the end (`p1234567890123456`
→ `1234567890.123456`). Call `slack_read_thread` with those two values, then find the MR link in the
parent message or replies. Resolve the IID from that link as in Step 1. Remember the request came
from Slack — it gates the extra question in Step 8.

## Step 1 — Get the MR IID

Require an MR IID or URL (`.../-/merge_requests/504` → `504`). If none was given and Step 0 didn't
resolve one either, derive it from the current branch with `glab mr view --output json` and **state
which MR you resolved to** before continuing. Check the MR state — if it is already merged, say so
and confirm the user still wants replies/fixes before pushing anything.

## Step 2 — List the incoming comments

```bash
python3 pr_feedback.py list --pr <NUMBER> [--repo <slug>]
```

Returns JSON of every reviewer discussion (inline and general, resolved and unresolved), excluding
system notes and your own threads. Each entry gives `discussion_id`, `author`, `resolved`, `inline`,
`file`, `new_line`/`old_line`, `head_moved`, `reply_count`, and `body`.

Ignore non-actionable general notes (e.g. release-bot "included in version X" messages). If
`count` is 0, report that and stop.

## Step 3 — Triage each comment (the judgment)

For each comment, open the file at its anchor and decide against the SPECIFIC concern raised:

- **valid → fix** — the concern is correct for this codebase. Plan the change.
- **push back** — technically wrong for this stack, breaks something, violates YAGNI, or the
  reviewer lacks context. Verify with the code/SDK/lockfile, then reply with the reasoning. Do NOT
  change code to appease a wrong comment.
- **needs investigation** — can't judge from the diff alone (dependency conflicts, runtime behavior).
  Actually run the check (`npm ls`, read the SDK types, grep usage) and let the evidence decide.

Verify claims against reality — read the SDK/type definitions, run `npm ls <pkg>`, grep for callers —
rather than taking either the reviewer's premise or your own first instinct at face value.

## Step 4 — Implement the valid fixes

One change at a time. Add or update a test that covers each fix (these are usually edge cases the
reviewer found — a test documents the fix and prevents regression). Then run the repo's OWN quality
gate before pushing — **REQUIRED:** `pre-push-quality-gate` — every step it lists, from this
repo's `package.json`; never another repo's. Confirm only your changed files are clean — pre-existing
lint warnings in untouched files are not yours to fix here.

## Step 4a — Flag generic fixes for rule codification

For each fix just implemented, check: is this specific to this file, or a recurring
architectural/stylistic preference (same pattern fixed elsewhere before, or a general design
decision independent of this specific diff — e.g. "use the established lodash helper instead of a
hand-rolled loop", "extract inline JSX handlers into named functions")? Grep `~/.claude/shared-rules.md`
and this repo's `.claude/rules/` first — skip anything an existing rule already covers.

If a fix is generic and not yet covered, follow the **Memory Management Protocol** in the global
CLAUDE.md: ask "Should I codify this into a new or existing rule?" once per fix, before Step 5's
push — not batched into the Step 7 report, where it's easy to skip past.

## Step 5 — Commit and push to the MR's source branch

Conventional commit with the MR's ticket scope (`fix(AIP-XXXX): …`); `fix`/`feat` ship, `chore` does
not — see global commit rules. Push to the **source branch** (never force-push, never a new branch).
Capture the pushed SHA — you reference it in the fix replies.

## Step 6 — Ask the one gate question, then reply

**Ask the user how to post replies: via API into each thread, or draft-only for them to paste.**
Defaults (no need to ask): replies are **attributed to Claude** and threads are **left unresolved**
for the reviewer to close. Only deviate if the user says otherwise.

Reply per thread with `pr_feedback.py`:

```bash
printf '%s' "<reply markdown>" > /tmp/reply.md
python3 pr_feedback.py reply --pr <NUMBER> --thread <THREAD_ID> --body-file /tmp/reply.md [--repo ...]
```

- **Fixed:** state the fix and the SHA — `Fixed in <sha> — <what changed>.` No gratitude, no "great catch."
- **Pushed back:** give the technical reason and the evidence you checked. `<concern> doesn't hold here:
  <evidence>. No change.`
- Write the body to a file and use `--body-file` — multi-line markdown and backticks break shell `-f`/`--field` escaping.

## Step 7 — Report

| Comment (gist) | file:line | Verdict | Action |
|---|---|---|---|
| empty list → trailing colon | `formatting.ts:22` | valid | guard + spec, fixed in `b822af3` |
| `inputSchema: {}` underspecified | `referenceTools.ts:22` | push back | it's a Zod raw shape, not JSON Schema — no change |

## Step 8 — Offer to acknowledge in the Slack thread

Only relevant if Step 0 resolved the MR from a Slack link — skip entirely when the MR was given
directly. Ask the user whether to reply to that Slack thread with the literal text `replied`, as a
lightweight ack that the feedback was handled. Only post if they confirm; use `slack_send_message`
with `thread_ts` set to the parent message's timestamp. Do not post unprompted.

## Gate outward-facing actions

- **Resolving is the reviewer's call by default — leave threads open** unless the user asks you to
  resolve fixed ones. Only ever resolve a thread you genuinely fixed, never a push-back.
- **Confirm the target branch is the MR's source branch before pushing**; never force-push.
- Posting replies publishes to the reviewer — honor the Step 6 method choice; don't post when the
  user asked for draft-only.
- Posting to Slack (Step 8) is also outward-facing — always ask before sending, never assume.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Implementing a wrong comment to be agreeable | Verify against the code/SDK; push back with reasoning (Step 3) |
| "You're absolutely right!" / "Thanks!" in a reply | State the fix or the reasoning. No performative agreement. |
| Posting multi-line replies with `glab -f body=` | Backticks/newlines break escaping — write to a file, use `--body-file` |
| Resolving threads to "tidy up" | Resolving is outward-facing and the reviewer's signal — leave open by default |
| Running another repo's build/lint in a worktree | Run THIS repo's `package.json` scripts (pre-push-quality-gate) |
| Treating a release-bot note as feedback | Ignore non-actionable general notes; act on reviewer comments |
| Silently fixing a generic/recurring pattern with no follow-up | Ask the codify-rule question (Step 4a) before push — don't bury it in the Step 7 report |
| Asking to codify something already in `CLAUDE.md`/`.claude/rules/` | Grep first (Step 4a) — only ask about genuinely new preferences |
| Forgetting to offer the Slack ack when the request came in via a Slack link | Track Slack origin from Step 0 and ask in Step 8 before wrapping up |
