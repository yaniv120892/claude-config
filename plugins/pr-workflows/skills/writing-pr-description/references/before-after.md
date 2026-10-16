# Before / After

A table of what behaves differently, one row per scenario, so a reader sees the effect of the PR without reading the evidence. Required in the full structure.

````markdown
## Before / After

| Scenario | Before | After |
|---|---|---|
| Guest sends `05/10-08/10, 2 adults` | Blocked in the browser as an ID | Sent; agent answers |
| Guest sends a card number | Blocked in the browser | Blocked by the server (422), nothing saved |
````

- **Rows are scenarios a person would recognise** — an input, a request, a user action — not file names or functions. 2–5 rows; pick the ones the PR exists for, plus the one that must *not* change if there is one.
- **Cells state observable outcomes**: a status code, what the user sees, what is saved or logged. Not "improved" or "fixed".
- **Every cell is backed by Proof of Work.** The table summarises; the evidence (pasted output, recording) sits in `## Proof of Work`. A cell you could not observe says so — `not observed (see Not proven locally)` — rather than stating what the code should do.
- **Before means the PR's base.** In a stack, the bottom PR's "after" can legitimately equal its "before" for the user (a module nothing calls yet); then say that in one row, e.g. `Any message | unchanged | unchanged: nothing calls the check until #545`.
