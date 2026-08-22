---
name: move-issue-status
description: Transition a Jira ticket to a new status (e.g. "move ABC-899 to deployed to dev", "mark this ticket in progress", "move jira to done/in QA/closed"). Caches each project's status→transition-id map so repeat transitions skip the discovery round-trip.
---

# Move Issue Status

Transition a Jira issue to a target status using a cached per-project map of status
name → transition ID, so most calls go straight to `transitionJiraIssue` instead of
always calling `getTransitionsForJiraIssue` first.

## Config

`~/.claude/issue-tracker.config.json` (shape in this plugin's `config.example.json`) is
the source of truth and the cache: `site`, `defaultCloudId`, `statusAliases`, and
`projects.<KEY>.{cloudId,transitions}`. The skill **writes back** to it as it learns new
projects and transitions. If the file is missing, create it from the example on first use.

## Flow

1. **Identify the issue key.** If not given explicitly, infer it from context — a ticket
   just discussed, a branch name like `fix/ABC-899/...`, a commit scope, an MR title.
   Ask only when genuinely ambiguous.

2. **Resolve the target status.** Lowercase the user's phrase and look it up in
   `statusAliases` to get the canonical name ("dev" / "deploy to dev" / "in dev" →
   `deployed to dev`). If it matches no alias or canonical name, ask which status they
   mean — never guess at an unfamiliar status.

3. **Resolve project + cloudId.** Take the project key from the issue key prefix
   (`ABC-899` → `ABC`), then:

   - **Known project + cached status** → use the cached `cloudId` and
     `transitions.<status>.id`. Transition with no further lookups.
   - **Known project, uncached status** → call `getTransitionsForJiraIssue`, match by
     name case-insensitively, use its `id`, and **write the full transitions list back**
     for that project so the next call skips the lookup.
   - **Unknown project** → try `getTransitionsForJiraIssue` with `defaultCloudId` first
     (most tickets share one site). On 404, ask for the cloudId, then add a
     `projects.<KEY>` entry with that cloudId and the full transitions map, keyed by
     lowercased status name.

4. **Transition** via `transitionJiraIssue` with the resolved `cloudId`, `issueIdOrKey`,
   and `transition.id`.

5. **Report**: issue key, old → new status, and the browse URL
   (`https://<site>/browse/<KEY>`, or the `webUrl` from the response if present).

## Notes

- Transition IDs are **workflow-specific, not global**. Cache them per project and never
  assume one project's IDs apply to another — that is the single most likely way to
  transition the wrong thing.
- If the requested transition isn't in the `isAvailable: true` set — blocked by a
  workflow condition, or the ticket is already in that status — say so plainly instead
  of retrying blindly.
- Transitions are pre-approved: once the issue and target status are unambiguous, apply
  it without asking for confirmation.
- If a cached ID is ever rejected (the workflow changed), re-run
  `getTransitionsForJiraIssue` and overwrite that project's cached map.
