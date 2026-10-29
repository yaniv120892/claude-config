# Observability Check

After this diff ships, can someone tell from production telemetry whether it
works, and does every existing dashboard, insight, and alert still measure what
it claims? Read-only — never create or edit events, insights, or alerts.

Read the target repo's CLAUDE.md first; its logging and analytics rules (which
logger, which event helper, naming) override anything generic here.

## Where telemetry lives

| Signal | Emitted by | Consumed by |
|---|---|---|
| Logs | the repo's logger → the log backend | log-based alert policies, in the infra repo `~/.claude/work-context.local.md` names |
| Product / analytics events | PostHog `capture` calls, or the repo's wrapper around them | PostHog insights, dashboards, funnels, cohorts, feature-flag targeting |
| LLM traces | the agent framework's trace exporter → PostHog `$ai_*` events | PostHog LLM analytics, conversation scoring |

## The three questions

### 1. Logs — will a failure in the new code be visible?

For each new or changed failure path (catch block, error return, retry
exhaustion, fallback branch, rejected input at a trust boundary):

- Is it logged at the right level? Swallowed errors and expected-path noise at
  `error` are both findings.
- Does the log carry the context needed to act on it — tenant, thread/request
  id, upstream status — as structured fields, not interpolated into the message?
- Does it leak a secret, token, or guest PII into the log?
- Does it bypass the repo's logger (`console.*` in runtime code)?

### 2. New event — does the change need one?

Ask for an event only when the diff adds a **user-visible outcome or a business
decision point** nobody can currently count: a new tool, a new flow step, a new
conversion, a new fallback the product team would want a rate on. Grep for an
existing event that already covers it before asking for a new one.

Do not ask for events on internal refactors, helpers, or anything the LLM trace
already records (tool calls and their results are in the trace).

### 3. Existing event or log — did the diff change one something depends on?

This is the check most likely to break production silently. Flag when the diff:

- renames an event, or removes or renames a property on one;
- changes a property's type or value set (`"success"` → `true`);
- moves an event so it fires at a different point, more or fewer times;
- edits or removes a log message or field that an alert filter matches on.

For each one, find the consumers:

- **Logs**: grep the alert-policy files `~/.claude/work-context.local.md` names for the message text or
  field name. A hit in an alert filter means the alert goes quiet the day this
  ships.
- **Events**: if the PostHog MCP (`mcp__posthog__exec`) is available, look up
  the event definition and the insights that use it. If it is not, say the
  consumers were not checked rather than guessing.

## What does not count

- Missing logs on happy paths that the trace already shows.
- Log wording preferences.
- An event "would be nice" with no question it answers.

## Output

Return this section, nothing else:

````markdown
### G. Observability — <owner/repo>#<n>
| tag | severity | file:line | comment |
| G1 | HIGH | src/x.ts:42 | Renames log `upstream timeout` → `gw timeout`; `gateway-monitoring.tf:31` filters on the old text, so the timeout alert goes silent. |
````

Severity: HIGH breaks an existing alert/dashboard or leaks PII/secrets; MEDIUM
leaves a new failure path invisible; LOW is missing context on an existing log
or an event that would answer a real question. Same comment form as
`rubric.md`'s comment contract; a code fix goes in a `suggestion` block below
the table, tagged `G1`, `G2`….

Close with one line naming the consumers you checked (alert files grepped,
PostHog events looked up), or `None` when the diff touches no telemetry and
needs none.
