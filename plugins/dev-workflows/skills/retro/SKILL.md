---
name: retro
description: "Run a retrospective on a coding session and propose improvements to the agent's environment."
disable-model-invocation: true
---

# Retro

The user has asked for a **retrospective**. You are proposing improvements to the coding agent's **environment** — the config, checks, and steering files that shape future runs — not re-litigating the code.

## Steps

1. Read the primary sources for the session the user specifies. That may mean searching session logs on this machine. If the user doesn't specify a session, default to the current one.

2. Hunt for improvement candidates in these categories, each with its *use when* tell:

- **Navigation**: how easy was it to find the right files? Are there hidden dependencies between files? Would a pointer in a `CLAUDE.md` or rules file have saved the hunt? *Use when* the session spent a long time locating a piece of information.
- **Automated checks**: could lint, types, tests, or a hook have caught a mistake the agent made? *Use when* the agent made a mistake an automated check would have caught.
- **Coding standards**: should a rule be added, removed, or clarified? Route through the **Memory Management Protocol** in `shared-rules.md`: propose the rule in the house format (`**Rule Name** — one-line rationale`, then `> Pattern:` / `> Avoid:`) and the right home — `shared-rules.md` for every session, a path-scoped `rules/*.md` for a language or file type, or the repo's own `.claude/rules/` for one project. *Use when* the same class of mistake slipped through review.
- **No-op instructions**: instructions in steering files (`shared-rules.md`, `rules/*.md`, a repo `CLAUDE.md`) that don't change the agent's behavior. *Use when* the steering files are large and unwieldy.
- **Tool economy**: expensive or token-heavy tool calls that could be streamlined — a cheaper command, a cached result, a script. *Use when* the agent made an expensive call more than once.
- **Information access**: logs or services the agent couldn't see — teeing dev-server logs, read-only access to a third-party service. *Use when* a crucial piece of information was unavailable to the agent.

3. Present the candidates to the user, ordered by severity. Codify only what the user approves — full versions go to `rules-reference.md` per the protocol.
