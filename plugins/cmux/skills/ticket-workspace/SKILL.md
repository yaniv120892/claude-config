---
name: ticket-workspace
description: Use when given a Linear ticket (key or URL) and asked to open a workspace for it — "create a workspace for RDBAZ-560", "open a cmux workspace for this ticket", "new workspace for <linear url>", or /ticket-workspace. Creates a cmux workspace named after the ticket, starts a Claude session in it, and renames that session to match.
---

# Ticket Workspace

One Linear ticket → one cmux workspace with a Claude session named after it. Requires cmux.

## Steps

1. **Fetch the title.** Extract the key (`RDBAZ-560`) from the argument or URL and call the
   Linear `get_issue` tool with `fields: ["title", "url"]`.
2. **Name it** `<KEY> - <2-3 words>`, e.g. `RDBAZ-560 - israir trips PDFs`. Pick the words that
   tell this ticket apart from its siblings, not a truncated title. Check `cmux list-workspaces`
   first; if a workspace already starts with the key, report it and stop.
3. **Create the workspace** in the background, running Claude from `~/bazak` unless the user
   names another directory:
   ```bash
   cmux new-workspace --name "$NAME" --description "$URL" --cwd ~/bazak --command claude --focus false
   cmux list-pane-surfaces --workspace <workspace ref from the output>
   ```
4. **Rename the session** once Claude's prompt is up. Text sent before then is lost to the boot:
   ```bash
   S=<surface ref>
   for i in $(seq 1 30); do cmux read-screen --surface $S --lines 40 | grep -qE '^\s*❯' && break; sleep 1; done
   cmux send --surface $S "/rename $NAME" && cmux send-key --surface $S Enter
   ```
5. **Confirm** with `cmux read-screen --surface $S --lines 15` — the name shows in the prompt
   border. Report the workspace ref and name. Don't focus it unless asked.
