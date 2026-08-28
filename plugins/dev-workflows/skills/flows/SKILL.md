---
name: flows
description: "Ask which skill or flow fits your situation. A router over the skills in this config."
disable-model-invocation: true
---

# Flows

You don't remember every skill, so ask. A **flow** is a path through the skills; most work travels one main flow, and everything else is maintenance, quality, or standalone. Each skill's own description already says what it does and when — this file adds only where it sits in the flow and what it chains to.

## The main flow: idea → shipped

**`/ship`** delivers a feature or bug end to end with human gates; its subcommands live in its own usage block. Prefer it whenever you want the work delivered with minimal steering.

To steer step by step instead, chain the pieces yourself:

1. **`brainstorming`** — before any code.
2. **`writing-plans`** — turns the brainstormed design into a plan.
3. Execute the plan: **`subagent-driven-development`** (same session) or **`executing-plans`** (separate session).
4. **`finalize-pr`** — polish and push it out.

## PR maintenance

Your own PR: **`creating-prs`** → **`writing-pr-description`** → **`post-mr-to-slack`** to open and announce it; then **`finalize-pr`**, **`fix-pr-conflicts`**, **`address-pr-feedback`**, and **`verify-pr-state`** keep it healthy through to merge.

Someone else's PR: **`pr-review-workflow`** drives the review, with **`reviewing-pr-code`** carrying the standards and **`post-pr-inline-comments`** the posting format; after the author says "fixed", **`pr-second-review`** (verify, resolve, approve) or **`verify-resolve-pr-comments`** (re-check and resolve your own comments only).

Across repos: **`pr-feedback-harvest`**, **`dependency-bump`**.

## Quality anytime

**`test-driven-development`**, **`verification-before-completion`**, **`pre-push-quality-gate`**, **`prune-comments`**, and the **`/code-review`** / **`/simplify`** built-ins (bug hunt and cleanup pass on the current diff).

## Standalone

**`using-git-worktrees`**, **`run-service-in-docker`**, **`http-file-generator`**, **`recurring-maintenance`**, **`syncing-claude-config`**, **`open-with-cursor`**, **`wizard`**, **`research`**, **`retro`**, **`wait-what`**, **`domain-modeling`**.

## Trackers and infra

- **issue-tracker** plugin — `create-issue-ticket` and `move-issue-status` (Jira), `create-linear-ticket` (Linear).
- **infra-workflows** plugin — `add-helm-env-var`, `provision-ssm-parameters`.

## Self-maintenance

A router that doesn't mention a new skill, or still routes to a dead one, is a router that lies — update this file whenever a skill is added, renamed, or removed.
