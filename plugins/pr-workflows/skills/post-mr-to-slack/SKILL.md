---
name: post-mr-to-slack
description: Use when posting a pull/merge request link to Slack — enforces one standard message format and routes to the right channel per reviewer via a config file. Trigger on "post the PR", "send to Slack", "share this MR", or any PR/MR URL paired with a Slack channel name. Works on GitHub and GitLab.
---

# Post a Merge Request to Slack

Format and send PR/MR notifications to Slack, tagging the relevant reviewers. The target
channel per reviewer comes from a routing config; the user is asked only when a reviewer
isn't in it yet.

## Delegate to a subagent

**Do not run this flow inline.** Fetch → resolve reviewers → route → format → send is a
fixed, well-specified procedure that needs neither this session's model tier nor its
accumulated context.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched
post-mr-to-slack subagent, skip this section and start at **Config** below.

Otherwise spawn a subagent for the full flow (it needs Bash, the Slack MCP, and
AskUserQuestion, which subagents have):

```
Agent({
  description: "Post MR to Slack",
  model: "sonnet",
  prompt: "You are the post-mr-to-slack subagent. Invoke the post-mr-to-slack skill
    yourself and follow it end-to-end — you are the dispatched subagent, so do not
    delegate further. MR URL(s): <url(s)>. Channel/reviewer override, if any: <override>.
    Follow the message format and routing rules exactly. Report the sent message links
    per channel."
})
```

Relay the subagent's sent-message links to the user.

## Always route through this skill

- Invoke it whenever the user gives a PR/MR URL to post, share, or send to Slack — even
  when the request looks simple enough to do inline.
- Never fetch MR details and post to Slack by calling forge/Slack tools ad hoc outside
  this skill. It owns the whole flow; bypassing it produces inconsistent formatting and
  breaks channel routing, which is the entire reason it exists.

## Config

`~/.claude/post-mr-to-slack.config.json` (shape in `config.example.json` next to this
skill). It holds `emailDomain`, `channels`, `developers`, and `repos`. Read it at the
start of every run; it is the source of truth and **the skill writes back to it** as it
learns new developers, channels, and repo emoji. If it's missing, create it from the
example on first use.

## Gathering MR information

Use the forge CLI — `gh` for GitHub, `glab` for GitLab. Command mapping is in this
plugin's `references/forge-cli.md`; read it rather than guessing flags. Both use the
user's existing authentication, so no token is stored here.

For each URL: parse out the project path and MR number, fetch the MR, and extract title,
state, author, and reviewer usernames. If the CLI call fails, fall back to asking the
user for the title and reviewers rather than posting a half-filled message.

**Repo emoji** — resolve the repo slug (or any alias the user used) against `repos` in
the config. On no match, ask which emoji to use and **append the entry** so it's known
next time.

**Description** — only capture it if the user explicitly asks, and even then condense to
1–2 sentences. Never carry a raw MR description into Slack.

## Resolving reviewers to Slack users

For each reviewer username from the MR:

1. **Check the config first.** A `developers` entry with a `slackUserId` is used as-is —
   no Slack search.
2. **Otherwise** use `slack_search_users`, searching by name derived from the username
   (`karina.b` → "Karina"), and pick the match whose email is on `emailDomain`.

Format mentions as `<@USER_ID>`.

## Routing to channels

1. For each reviewer, look up their `developers` entry.
   - **Known** → route to the channel(s) in their `channels` array.
   - **Unknown** → ask via `AskUserQuestion` which channel(s) their PRs go to, then
     **write them back** into the config (username, name, `slackUserId`, chosen
     channels), adding any new channel to `channels` too.
2. **Group reviewers by channel, per MR.** One MR may post to several channels — one
   message per channel, tagging only that channel's reviewers.
3. A channel with no reviewers routed to it gets no message.

The config is authoritative: don't ask which channels to use when every reviewer is
already known. An explicit instruction from the user ("post this only to #prs-and-bugs",
"tag only Alisa") always wins over the file.

## Message format

Keep it short and scannable — emoji, title link, project, reviewers. Nothing else by
default.

**Formatting note:** `slack_send_message` parses **standard markdown**, not Slack mrkdwn,
so bold is `**double asterisk**` (single `*…*` renders as _italic_). Slack-native link
`<url|title>` and mention `<@USER_ID>` syntax pass through and do render.

```
{repo emoji}
<{mr url}|{MR title}>
**Project:**
{repo name}
**Reviewers:**
{slack mentions separated by ", "}
```

Add a `**Summary:**` line of at most 1–2 sentences only when the user asked for the
description, or it's clearly essential (a breaking change). Never paste the raw
description.

**One MR = one Slack message, always.** Posting several MRs to the same channel means
several `slack_send_message` calls, never one combined message.

## Sending and reporting

Send with `slack_send_message` per channel with that channel's reviewer tags. For a
scheduled post use `slack_schedule_message` with the Unix timestamp.

Each send returns a `message_link`. **Report these back** — one row per channel, channel
name plus clickable link — so the user can verify delivery. If a send fails or returns no
link, say so explicitly rather than implying success. For scheduled messages, report the
scheduled time instead.

## Worked examples

**All reviewers in one channel.** Parse URL → fetch MR → both reviewers known and route
to `team-prs` → use cached `slackUserId`s → repo emoji from config → no questions asked →
one message.

**Reviewers in different channels.** Reviewer A routes to `team-prs`, reviewer B to
`prs-and-bugs` → group by channel → two messages, each tagging only its own reviewer.

**Unknown developer.** Reviewer has no entry → resolve via `slack_search_users` → ask
which channel their PRs go to → append them to the config → proceed, now treating them
as known.
