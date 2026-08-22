---
name: create-issue-ticket
disable-model-invocation: true
description: Create a Jira ticket (Story, Bug, or Task) with a validated project and issue type. Use when the user wants a new Jira issue, or when a ticket is needed (e.g. during MR creation) and none exists.
---

# Create Issue Ticket

Create a Jira ticket, validating the project and issue type before writing.

## Config

Read `~/.claude/issue-tracker.config.json` (shape in this plugin's `config.example.json`).
It supplies `site`, `defaultProject`, `issueTypes`, and optionally
`defaultAssigneeAccountId`. If the file is missing, ask the user for the project key
and site once and offer to write the file — do not hardcode either into this skill.

## MCP server

Prefer the local `jira` MCP server (`mcp__jira__*`): it is pre-approved, so writes
raise no permission prompt, and it exposes raw Jira REST verbs rather than named
operations. Fall back to `mcp__claude_ai_Atlassian__*` only if the local server is
unavailable.

## Flow

1. **Gather inputs** — project (default `defaultProject` from config, user may override),
   issue type (from `issueTypes`), summary, and an optional description.

2. **Validate the project** via `mcp__jira__jira_get`,
   `path: "/rest/api/3/project/search"`.

3. **Validate the issue type** via `mcp__jira__jira_get`,
   `path: "/rest/api/3/issue/createmeta/{projectKey}/issuetypes"` — confirm the chosen
   type exists in that project. Types vary per project; never assume.

4. **Create** via `mcp__jira__jira_post`, `path: "/rest/api/3/issue"`:

   ```json
   { "fields": {
       "project":   { "key": "<KEY>" },
       "issuetype": { "name": "<Type>" },
       "summary":   "<Summary>",
       "description": "<ADF>"
   } }
   ```

   `description` must be Atlassian Document Format, **not** markdown. Wrap plain text as:

   ```json
   { "type": "doc", "version": 1,
     "content": [{ "type": "paragraph",
                   "content": [{ "type": "text", "text": "..." }] }] }
   ```

5. **Report** the ticket key and its URL (`https://<site>/browse/<KEY>`).

## Error handling

| Failure | Response |
| --- | --- |
| Project doesn't exist | Say so, ask for the correct key — don't guess a neighbour |
| Issue type invalid for project | List the types the project actually offers, let the user pick |
| Creation rejected | Show the API error verbatim and suggest the fix; a required custom field is the usual cause |
