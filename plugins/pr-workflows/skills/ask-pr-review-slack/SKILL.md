---
name: ask-pr-review-slack
description: Use when asking a teammate to review a pull request over Slack DM — "ask Dana to review this PR", "send these PRs to Alex for review", "ping Sam about my MR", "nudge Dana", "tell Alex I replied", "ping him again for re-review", or a PR URL paired with a person's name. Checks the PRs are actually review-ready before sending. Not for posting to a channel — that is post-mr-to-slack.
model: haiku
context: fork
background: false
---

# Ask for a PR Review on Slack

DM a teammate a short, uniform review request for one PR or a stack of them, after
verifying the PRs are actually ready to be looked at.

Channel posting is a different job — use `pr-workflows:post-mr-to-slack` for that. This
skill only sends direct messages, so it never tags the recipient: a DM already reaches
them.

## Inputs

Take `<owner>` and `<repo>` from each PR URL.


- **One or more PR URLs** (or `#475`-style numbers plus a repo).
- **One person** — the reviewer.

Multiple PRs are treated as a **stack** only when they actually chain: each PR's base
branch is the previous PR's head branch. Otherwise they are independent PRs and get
separate messages (see *Sending*).

## 1. Fetch and gate

For each PR, one call gets everything the gate and the message need:

```bash
gh pr view <number> --repo <owner>/<repo> \
  --json number,title,body,url,headRefName,baseRefName,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup
```

Unanswered review threads need GraphQL — `gh pr view` cannot report them. A thread is
unanswered when it is unresolved and its last comment is not by the PR author:

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$n:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$n){
      author { login }
      reviewThreads(first:100){ nodes { isResolved path line comments(last:1){ nodes { author { login } } } } }
    }
  }
}' -F owner=<owner> -F repo=<repo> -F n=<number> \
  --jq '.data.repository.pullRequest as $pr | [$pr.reviewThreads.nodes[]|select(.isResolved==false and .comments.nodes[0].author.login != $pr.author.login)]|length'
```

**The gate.** A PR is review-ready when every one of these holds:

- every `statusCheckRollup` entry is `SUCCESS` or `SKIPPED` — no `FAILURE`, no `PENDING`
- `mergeable` is `MERGEABLE` (`CONFLICTING` means it needs a rebase first)
- zero unanswered review threads — every thread has a reply from the PR author; it does not
  have to be resolved, the reviewer resolves their own threads when they re-review
- `reviewDecision` is not `APPROVED` (already approved — confirm they still want it sent)

`mergeStateStatus: BLOCKED` is **not** a failure here. In this org it usually means
"awaiting approval", which is exactly why the message is being sent.

If any PR fails the gate, **stop and report which PR failed which check**, then ask
whether to send anyway. Never quietly ping a reviewer at a PR that will waste their time.
Qodo findings are covered by the unanswered-threads check; Qodo's own summary comment
posts its counters as PR-level comments, so read them only if the user asks why a PR
looks unready.

## 2. Resolve the reviewer and the emoji

Who a name means, and each repo's emoji, live in `~/.claude/ask-pr-review-slack.local.md` —
machine-local, never committed, so teammates' GitHub logins and Slack IDs stay off the
config repo. Read it at the start of every run; if it's missing, create it with two empty
tables:

```
## People
| Called | GitHub | Slack ID |
|---|---|---|

## Repo emoji
| Repo | Emoji |
|---|---|
```

Match the name the user gives against **Called** (first name, nickname or full name, any
case) and DM them: `slack_send_message` with `channel_id` set to their Slack user ID.
Look the repo up in **Repo emoji**.

On a miss for either, resolve it (`slack_search_users` for a person, ask the user for an
emoji), send the message, then **append the new row to the local file** so the next run
needs no questions.

## 3. Message format

`slack_send_message` parses **standard markdown**, not Slack mrkdwn — bold is
`**double asterisk**` (a single `*…*` renders as italic).

Send each link as the **title followed by the bare URL in parentheses**: `{title} ({url})`. Never use
masked links (`<url|title>` or `[title](url)`): Slack flags a masked URL and makes the
recipient confirm it before opening.

Use PR titles **verbatim** from the forge. Do not rewrite, shorten, or strip ticket
prefixes. Never include CI status, Qodo results, review counts, or a summary of the
changes — the gate already checked readiness, and the reviewer reads the PR, not the DM.

The first line is always the PR title and link, so the message stays one glance long.

**A single PR:**

```
{emoji} {title} ({url})
Hi, please review the PR — {quip}
```

`{quip}` is a short, playful line riffing on what the PR does, drawn from its title and
`body`. Keep it under ~12 words, aimed at the code or the change, never at the reviewer
or a teammate, and skip it if nothing light fits (e.g. an incident fix). Use future
tense — the PR isn't merged yet. Example: for "add baggage tool to israir agent" → "the
agent will finally learn to carry its own bags 🧳".

**A stack:**

```
{emoji} {title} ({url})
{emoji} {title} ({url})
Hi, please review the PRs — it's a stack, merge in this order. {quip}
```

List a stack bottom-up: the PR whose base is `main` is first, then the PR based on its
head branch, and so on.

**Independent PRs** (same reviewer, no chain) use the single-PR form, one message each.

**Thread notes.** When the user asks for a note in a message's thread (a follow-up step, a
known red check), send it as a reply with `thread_ts`, one or two lines: what happens and
who does it. No explanation of why — the PR body carries that. Example: "After merge:
restrict `dev`/`production` to `main`, then apply `me-west1-shared`. Both need your access."

**Merge order between independent PRs never goes on Slack** — not in the message, not as
a thread note, even when the user's request mentions it. Whoever merges reads the PR, so the
order belongs in each description (`**Merge first:**` / `**Merge after** <repo>#<n>`). Check
the descriptions carry it; when one is missing, report it to the user instead of sending it
as a note. A real stack keeps its one "merge in this order" line, since the order is the
stack itself.

## 4. Follow-up on an earlier request

Before composing a new message, check whether this reviewer was already asked about the
PR. Every follow-up ("tell Dana I replied", "ping him again", an ack from
`address-pr-feedback`) goes through these steps.

**a. Find the request thread.** Read the DM with `slack_read_channel` (`channel_id` = the
reviewer's Slack user ID, `response_format: detailed` so each message shows its
`Message TS`). The **request message** is the top-level message from the user
whose first line holds the PR URL and whose text contains `please review the PR`. The
newest such message is the thread; its `Message TS` is the `thread_ts`. A top-level
`replied - {url}` or `please approve again - {url}` is an earlier ack, never the thread.
Page back with `cursor` until you find it or reach messages older than the PR's
`createdAt`. Search (`slack_search_public_and_private`) can miss or return the wrong hit,
so the channel read decides.

**b. Pick the reply** from the reviewer's activity on the PR:

```bash
gh pr view <number> --repo <owner>/<repo> --json reviews,comments,commits \
  | jq --arg l <github-login> '{
      reviews: [.reviews[]|select(.author.login==$l)|{state,submittedAt}],
      lastRound: ([(.reviews[]|select(.author.login==$l and .state!="APPROVED")|.submittedAt),
                   (.comments[]|select(.author.login==$l)|.createdAt)]|max),
      lastCommit: .commits[-1].committedDate}'
```

| Reviewer's state | Reply in the thread |
|---|---|
| Left comments / requested changes, and every one of their threads is fixed and replied to | `replied` |
| Approved, and commits landed after the approval (a main merge or fixes unrelated to their comments) | `please approve again` |

**c. Duplicate check, per review round.** Read the thread (`slack_read_thread`) and look for
an earlier `replied` for this PR, in the thread or as a top-level `replied - {url}`. It
covers this round only when its time is **after `lastRound`** (Slack's `Message TS` is
epoch seconds; compare against `lastRound` converted the same way). An older `replied`
answered an earlier round: send a new one. Apply the same test to `please approve again`
against the latest `APPROVED` review.

**d. Send.** `slack_send_message` with `channel_id` = the reviewer's Slack ID and
`thread_ts` = the request message's ts. The body is exactly the table's text, nothing
else: the thread's parent already carries the link, and the GitHub replies carry the fix
summary. For a stack, reply once in the stack's thread, one line per PR as
`replied - {url}`.

Only when step a finds no request message for the PR, send a new top-level message
`replied - {url}` (or `please approve again - {url}`) and tell the user no review-request
thread was found.

The gate in §1 still applies, except that an `APPROVED` decision is expected on the
re-approve row. If neither row fits (e.g. their comments are not all replied to yet, or the
approval is still current) or step c finds a current ack, stop and tell the user instead
of sending.

## 5. Sending and reporting

First request the reviewer on GitHub for every PR, so the review shows up in their queue
and the PR's reviewer list:

```bash
gh pr edit <number> --repo <owner>/<repo> --add-reviewer <github-login>
```

Take the login from the **GitHub** column of the local file's **People** table and use it without asking the user
to confirm it. On a `—`, ask the user for the login, then fill it into the local file. If the request fails (e.g. they lack repo access), say
so and still send the DM.

Then send with `slack_send_message`. One message per stack; one message per PR when the PRs are
independent. Report the returned `message_link` back to the user — if a send fails or
returns no link, say so plainly rather than implying it went through.
