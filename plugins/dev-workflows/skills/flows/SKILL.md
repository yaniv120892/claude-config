---
name: flows
description: "Ask which skill or flow fits your situation. A router over the skills in this config."
disable-model-invocation: true
---

# Flows

You don't remember every skill, so ask. A **flow** is a path through the skills; most work travels one main flow, and everything else is maintenance, quality, or standalone.

## The main flow: idea → shipped

**`/ship`** drives the whole thing end to end: scoping questions → plan approval gate → TDD implementation → simplify/review/rules polish → verify-tests (mutation + trace to spec) → blind QA regression pass → hand-off at "ready to merge" (merging stays the user's call). Prefer it whenever you want a feature or bug delivered with minimal steering: it runs in a worktree, keeps state on disk, and resumes.

For work you want to steer step by step, chain the pieces yourself:

1. **`brainstorming`** — sharpen intent, requirements, and design before any code.
2. **`writing-plans`** — turn the design into a written implementation plan.
3. Execute the plan:
   - **`subagent-driven-development`** — same session, independent tasks dispatched to subagents.
   - **`executing-plans`** — a separate/parallel session working the plan with review checkpoints.
4. **`finalize-pr`** — polish, run review + simplify, and push it out.

## PR maintenance

- **`finalize-pr`** — polish a branch for shipping, or keep an open PR healthy (sync main in, fix, push).
- **`fix-pr-conflicts`** — a PR/MR can't merge; resolve conflicts and push back to the source branch.
- **`address-pr-feedback`** — reviewers left comments on your PR; handle them.
- **`pr-review-workflow`** / **`reviewing-pr-code`** — review someone else's PR (the workflow drives the CLI; reviewing-pr-code carries the standards).
- **`pr-second-review`** — the author says they fixed your comments; verify, resolve, approve.
- **`verify-resolve-pr-comments`** — re-check your own inline comments against the new commits; resolve only the genuinely fixed.
- **`verify-pr-state`** — watch a PR's CI; auto-merge on green, report and fix on red.
- **`writing-pr-description`** — budgeted Motivation / Implementation / Proof of Work sections.
- **`creating-prs`** — open the PR/MR itself: quality gate, conventional title, clean scope.
- **`post-pr-inline-comments`** — post review findings as inline diff comments, never general notes.
- **`post-mr-to-slack`** — share the PR/MR link in the standard format to the right channel.
- **`pr-feedback-harvest`** — mine recurring review comments across repos into rules/skills/hooks.
- **`dependency-bump`** — bump a shared package across repos and verify lockfiles.

## Quality anytime

- **`test-driven-development`** — red-green slices before implementation code, always.
- **`verification-before-completion`** — evidence before any "done/fixed/passing" claim.
- **`pre-push-quality-gate`** — format, lint, typecheck, build, test before any push or commit.
- **`prune-comments`** — delete comments the code can carry itself.
- **`/code-review`** / **`/simplify`** (built-ins) — bug hunt and cleanup pass on the current diff.

## Standalone

- **`using-git-worktrees`** — isolate feature work from the current workspace.
- **`run-service-in-docker`** — run the app in its own Dockerfile-built container, not a bare host process.
- **`http-file-generator`** — generate `.http` test files for REST endpoints.
- **`recurring-maintenance`** — drip-feed a mechanical-cleanup backlog, one small PR per run.
- **`syncing-claude-config`** — ship drifted `~/.claude` config back to this repo via PR.
- **`open-with-cursor`** — offer to open a just-written file in Cursor.
- **`wizard`** — generate a bash wizard for steps only a human can take (credentials, dashboards, cutovers).
- **`research`** — background agent investigates a question against primary sources, leaves a cited Markdown file.
- **`retro`** — retrospective on a session; propose improvements to the agent's environment.
- **`wait-what`** — the last message didn't land; re-pitch it in plain English.
- **`domain-modeling`** — sharpen the project's domain language; resolve overloaded terms.

## Trackers and infra

- **issue-tracker** — `create-issue-ticket` (Jira), `create-linear-ticket` (Linear), `move-issue-status` (Jira transitions).
- **infra-workflows** — `add-helm-env-var` (GitOps Helm values + PRs), `provision-ssm-parameters` (AWS SSM secrets).

## Self-maintenance

A router that doesn't mention a new skill, or still routes to a dead one, is a router that lies — update this file whenever a skill is added, renamed, or removed.
