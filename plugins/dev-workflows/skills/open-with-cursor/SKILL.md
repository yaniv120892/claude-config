---
name: open-with-cursor
user-invocable: false
description: Use when you have just created or written a file (superpowers specs, questions files, design docs, any generated artifact) and the user might want to view or edit it immediately. Ask before opening — never open silently.
---

# Open Files with Cursor

## Core Rule

After creating any spec file, questions file, design doc, or other artifact the user will want to read or edit — **ask first, then open on confirmation**.

Never open silently. Always ask.

## When to Offer

Offer to open with cursor after creating:
- Superpowers spec files (`*-questions.md`, `*-design.md`)
- Any generated document or report
- Config files the user will need to fill in
- Any file you just wrote that requires human input

## How to Ask

After committing/writing the file, add exactly one line:

> Want me to open `<filename>` in Cursor?

Do NOT combine with other questions. One line, one ask.

## How to Open

```bash
cursor /absolute/path/to/file
```

- Always use the **absolute path**
- The command opens the file in the user's existing Cursor window

## What NOT to Do

- Don't open without asking
- Don't ask more than once per file
- Don't combine the offer with unrelated questions
- Don't use relative paths
