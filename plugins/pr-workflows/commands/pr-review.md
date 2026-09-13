---
description: Senior-level review of one or more pull requests — code, repo and global rules, CI, and whether the Notion docs still match. One subagent per PR.
argument-hint: <PR numbers or URLs> (one or more, required)
allowed-tools: Bash(gh:*), Bash(git:*), Bash(python3:*), Read, Grep, Glob, Agent, Skill, mcp__notion__notion-search, mcp__notion__notion-fetch
---

Review the pull requests in `$ARGUMENTS` using the **pr-review** skill.

If `$ARGUMENTS` is empty, stop and ask which PRs — do not fall back to the
current branch.
