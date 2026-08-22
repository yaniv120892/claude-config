---
name: provision-ssm-parameters
disable-model-invocation: true
description: Use when creating or updating AWS SSM Parameter Store secrets for a service in a configured environment — e.g. "create parameter store params", "push the .env.local secrets to SSM", "set up SSM for <service>", "mirror dev params to prod". Covers the SSO / temporary-credential auth dance, the path convention, SecureString + KMS key, and reading values from an env file. Triggers on "ssm", "parameter store", "put-parameter".
---

# Provision AWS SSM Parameter Store Secrets

Create `SecureString` parameters for a service in a configured environment, sourcing
values from that service's env file. Environments differ only in **auth method**, **KMS
key**, **account**, and **path prefix** — everything else is identical, which is why one
script covers them all.

## Config

Read `~/.claude/infra-workflows.config.json` → `ssm` (shape in this plugin's
`config.example.json`): `region`, `domain`, `pathPrefix` template, and per-environment
`accountId`, `auth` (`sso` | `temporary-sts`), `profile`, and `kmsKey`. The script reads
the same file, so there is one source of truth rather than a copy in the prose.

`<service>` is the SSM service slug. Confirm the exact slug against an existing
parameter before writing — a typo silently creates a second, parallel parameter tree that
nothing reads.

## Step 1 — Authenticate

**SSO environments.** Check for a cached session first; only log in if expired:

```bash
unset AWS_PROFILE
aws sts get-caller-identity --profile <profile> --region <region> \
  || aws sso login --profile <profile>
```

> If `aws sso login` opens a browser you can't complete in this session, ask the user to
> run `! aws sso login --profile <profile>` themselves, then re-check.

**Temporary-STS environments.** The user pastes short-lived `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`. Export them and confirm the account.

> `unset AWS_PROFILE` first — a lingering `AWS_PROFILE` overrides exported keys and
> silently targets the wrong account. The script does this and then verifies the resolved
> account against the configured `accountId` for **every** environment, not just prod.

## Step 2 — Read values from the env file

Read the service's `.env.local` (or whichever file the user names) and extract exactly
the variables the user lists — do not invent or omit. Never echo secret values into the
transcript; pass them straight to `put-parameter`.

## Steps 3–4 — Put each parameter, then verify

The put loop and verification are a fixed, repeatable sequence — run the bundled script
rather than hand-typing `put-parameter` calls:

```bash
provision_ssm.sh --env <env> --service <slug> --env-file <repo>/.env.local --confirm
```

It reads `KEY=VALUE` pairs, writes each as a `SecureString` under the resolved path
prefix with that environment's KMS key (`--overwrite`, so reruns are idempotent), retries
without `--key-id` if KMS rejects it, then lists the resulting parameter names.

Because it writes secrets to AWS (irreversible, prod-capable), it:

- requires an explicit **`--confirm`** flag — without it, it prints the summary
  (environment, service, account, KMS key, path prefix, parameter **names**) and exits
  without writing;
- **never echoes secret values** — only names appear, in the summary and the verification.

Run Step 1 first so the session is valid or the credentials are exported; the script
re-checks and refuses to continue against an unexpected account. Report success/failure
**per parameter** from its output. Do not print decrypted values.

> Judgment is still required — this skill is `disable-model-invocation: true` so it won't
> auto-fire. Confirm the service slug against an existing parameter, decide which
> environment (and whether to mirror one to another), and confirm the variable list with
> the user. To mirror, re-run with the other `--env` after switching credentials.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Exported creds ignored, wrong account hit | `unset AWS_PROFILE` before exporting/using temp creds |
| `aws sso login` blocks on a browser | Try `get-caller-identity` first; if expired, have the user log in via `!` |
| `put-parameter` fails on KMS | The script retries without `--key-id`; if that also fails, the role lacks `ssm:PutParameter` |
| Created in one environment when both were needed | Re-run with the other `--env` and its credentials |
| Wrong service slug | Match an existing parameter path before creating new ones |
