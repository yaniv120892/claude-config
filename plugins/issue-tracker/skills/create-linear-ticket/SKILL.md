---
name: create-linear-ticket
disable-model-invocation: true
description: Create a Linear issue from a fixed five-section template — Why, Repro, Fix, Done when, Signals — with team, project, priority and labels resolved before writing. Use when the user wants a Linear ticket, or when filing findings from a review or audit.
---

# Create Linear Ticket

File a Linear issue that a future reader can act on without asking a follow-up question.

Personal-project Linear has no triage step and no reporter to chase, so the ticket is the
only record. Everything needed to reproduce, fix and verify goes in at creation time.

## Resolve before writing

Never guess a team, project or label — Linear accepts names, so look them up:

| Field | Source | Rule |
| --- | --- | --- |
| `team` | `mcp__Linear__list_teams` | One team → use it. More than one → ask. |
| `project` | `mcp__Linear__list_projects` | Match the repo being worked in. No match → ask before filing outside a project. |
| `labels` | `mcp__Linear__list_issue_labels` | Existing labels only. A label the workspace lacks is a question for the user, not a new label. |
| `priority` | Impact table below | Pass the number, not the name. |

Then create with `mcp__Linear__save_issue` — with no `id`. Report the identifier and URL.

## Priority

Set it from what happens if the ticket is never picked up, not from how interesting it is.

| | When |
| --- | --- |
| **1 Urgent** | Already exploitable or already costing money; or a check whose bad answer would be urgent. |
| **2 High** | Breaks on its own as usage grows, or a real defect behind a precondition that can occur. |
| **3 Medium** | Bounded waste or a gap that needs a specific unlucky sequence. |
| **4 Low** | Consistency, hardening, small caps — real, but nothing degrades while it waits. |

## Title

Imperative, one line, names the change and not the symptom. Backtick paths and identifiers.
`Cap the assistant's step count and memory window` — not `Chat is expensive`.

## Description template

Five `##` sections in this order. Prose in sentences, not fragments. Aim for under 200 words
of body; a ticket that has to be skimmed gets skimmed.

```markdown
## Why

One short paragraph: what is wrong, what it costs, and any precondition that gates it.
Lead with the consequence. If severity depends on something unverified, say so here.

## Repro

Numbered steps someone can actually follow. For a code-only finding, cite `file.ts:42`
and name what to read there — a path plus the observation is a valid repro.

## Fix

The change, in a sentence or two or a short bullet list. Scope, not design.

## Done when

Checklist of assertions a reviewer can each check off. Every line must be testable —
`returns 401 without the bearer header`, not `is secure`.

## Signals

The metric, alert or log line that proves it holds in production, or names the existing
one that already would. Omit the whole section when there is nothing to add — an empty
heading is worse than no heading.
```

## Rules

- **One ticket per fix, not per finding.** Two findings that close with the same change are
  one ticket; a single finding needing two independent changes is two.
- **Verification is a ticket too.** "Check whether X is true" is legitimate work when the
  answer changes the priority. Say in `Done when` what each answer leads to.
- **Cite, don't paste.** `file.ts:42` and one line of context beats a fenced block.
- **No estimates, no assignee** unless the user asks. Status defaults to Backlog.
- **Never invent a label.** Not offering a fitting one is better than creating a near-duplicate.

## Batches

Filing several tickets from one review: resolve team, project and labels once, then confirm
the list — title and priority per ticket — with the user before writing any. Report as a
table of identifier, priority and title.
