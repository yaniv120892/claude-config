---
name: ask-tf-apply
description: Use when an infra / Terraform pull request needs `terraform apply` run by someone else because you lack apply permission — "ask Shlomo to apply #403", "send the terraform apply request", "infra PR merged, get it applied", "who runs apply for this", or /ask-tf-apply with a PR link.
---

# Ask for a Terraform Apply

DM the person who holds apply rights a short request to run `terraform apply` for a
**merged** infra PR: which PR, which Terraform roots, and what the apply changes.

## Inputs

- **A PR** — URL, or `#403` plus a repo. Several PRs each get their own message.
- The applier comes from `~/.claude/infra-workflows.config.json` → `tfApply.applier`
  (`name`, `slackId`), and the repo's local clone from `tfApply.repos` (shape in this
  plugin's `config.example.json`). If either is missing, ask once, then write it to the
  config.

## 1. Gate: merged to main

```bash
gh pr view <n> --repo <owner>/<repo> \
  --json number,title,url,body,state,baseRefName,mergedAt,mergeCommit,files
```

Send only when `state` is `MERGED` and `baseRefName` is `main`. Otherwise stop and tell the
user what state the PR is in — an apply from an unmerged branch drifts state away from
`main`. Offer to wait for the merge (the `land` skill does that) and send afterwards.

## 2. Work out the Terraform roots

A **root** is a directory whose `.tf` files hold a `backend` block. In the local clone,
on a fresh `origin/main`:

```bash
git -C <clone> fetch -q origin main
git -C <clone> grep -l 'backend "' origin/main -- '*.tf' | sed 's|^origin/main:||' | xargs -n1 dirname | sort -u
```

A changed file reaches a root when any of these holds:

- it sits in the root's directory, or in a directory the root symlinks a file from
  (`ls -l <root>` shows the links, e.g. `terraform/_shared/`);
- it sits in a module the root uses, directly or through another module (`source =` paths);
- a root or module `.tf` names its path, e.g. a YAML under `files/` read by `file(...)`,
  `templatefile(...)` or a bucket object's `source =`. Find these with
  `git grep -n '<basename>' origin/main -- '*.tf'`.

Leave out a root the repo marks as retired or quiesced (a marker file in it, such as
`_quiesced.md`) unless the PR changed a file in that root's own directory.

List every reached root by its directory name (`me-west1-dev`, `me-west1-production`). If
no root is reached, the PR needs no apply: tell the user and send nothing.

## 3. Message

`slack_send_message` parses standard markdown. Link as `{title} ({url})`, never a masked
link. One message, this shape:

```
Hi {applier first name}, can you run terraform apply for {title} ({url})? It's merged to main.
Roots: `{root}`, `{root}`
{what the apply creates or changes, one or two sentences, from the PR body}
```

The third line says what lands in the cloud (a new alert policy, a scheduler job, an IAM
binding), in plain words. Add one more sentence only when the PR body names something that
must already be live (a deployed service, a secret) and it is.

## 4. Where to send

Read the DM (`slack_read_channel`, `channel_id` = `slackId`, `response_format: detailed`),
paging back to the PR's `createdAt`. A message refers to the PR when it holds `pull/<n>` or
`<repo>#<n>`.

1. If one of those messages already asks for an apply of this PR, stop and report it with
   the roots it named. When it named none or fewer than step 2 found, say which are
   missing, so the user can follow up.
2. Otherwise, if a top-level message refers to the PR (a review request), reply in its
   thread with `thread_ts` = its `Message TS`.
3. Otherwise send a new DM.

Report the returned `message_link`. If the send fails or returns no link, say so.
