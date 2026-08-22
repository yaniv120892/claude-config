---
name: add-helm-env-var
disable-model-invocation: true
description: Add a new environment variable to a service's Helm values across the configured GitOps registries and open the PRs. Use when adding a new env var to a deployed service.
---

# Add Helm Environment Variable

Add an environment variable to a service's Helm values and open a PR per modified repo.

## Config

Read `~/.claude/infra-workflows.config.json` → `helm` (shape in this plugin's
`config.example.json`). It supplies the registry list, each registry's `valuesPattern`
and `defaultBranch`, and the environment names. **Registry order is meaningful**: the
first registry containing the service wins, so the preferred (non-legacy) one is listed
first. If the config is missing, ask for the registry path once and offer to write it.

## Input

- **Service name** (e.g. `payments-api`)
- **Env var name** and its value per environment
- **Environments** — default to all in `helm.environments`

## Process

### 1. Locate the service, preferred registry first

Walk `helm.registries` in order, resolving `valuesPattern` for the service:

```bash
ls <registry.path>/<resolved valuesPattern> 2>/dev/null
```

Use the first registry that has it. If a `legacy: true` registry is the only match, say
so — the var is being added to a repo that is being migrated away from, which the user
should know before the PR exists, not after.

If **no** registry has the service, stop and ask which one to add it to rather than
creating a values file on a guess.

### 2. Follow the existing structure exactly

Read the values file and find where env vars live. The key varies by chart — `env`,
`extraEnv`, `envVars`, and others are all common. Match the surrounding pattern; never
restructure the file or introduce a second convention alongside the existing one.

```yaml
env:
  - name: EXISTING_VAR
    value: "some-value"
  - name: NEW_VAR          # added in the same shape
    value: "new-value"
```

If the var **already exists**, report the current value and ask whether to update it.
If the value is a secret, ask whether it should reference the secret store instead of
sitting in plain YAML — see the `provision-ssm-parameters` skill for the store side.

### 3. Open a PR per modified repo

1. Verify the repo is clean (`git status`) before branching.
2. Branch: `chore/add-<env-var-name>-to-<service-name>`.
3. Commit: `chore: add <ENV_VAR_NAME> to <service-name> helm values`.
4. Push and open the PR/MR.

**Check the base branch rather than assuming.** These repos commonly default to `master`,
not `main`; `defaultBranch` in config records it, but confirm with `git remote show origin`
when a repo is new to the config. Open separate PRs for dev and prod when the repo layout
requires it, one PR when both environments live in the same repo.

### 4. Sync the local env file, if the config names a command

If the service has a `.env.local` and `helm.envLocalSyncCommand` is set, add the var
there too with a local value. Show the user the diff and **wait for confirmation**, then
put a checkbox in the PR description so the secret-store half is not forgotten:

```
- [ ] Run `<helm.envLocalSyncCommand>` to push .env.local changes to the secret store
```

### 5. Report

The PR URLs and which files changed, per repo.

## Rules

- Follow the existing YAML structure; don't restructure.
- A missing var must fail the feature, not the deploy — pair this with a provisioning
  ticket so the code half and the config half ship together. Merged code reading an
  unprovisioned var is silently inert and nothing in CI will say so.
- Always confirm the base branch before pushing.
