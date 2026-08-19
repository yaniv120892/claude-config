---
name: dependency-bump
disable-model-invocation: true
description: >
  Bump shared npm package versions across multiple repos and verify lockfile integrity.
  Use when the user wants to update a shared dependency (like @models/media-generation-model,
  @models/core.common.model, or any shared package) across multiple repositories.
  Trigger on phrases like "bump dependency", "update package version", "bump @models across repos",
  "update shared package", or when a model package has been published and downstream repos need updating.
---

# Cross-Repo Dependency Bump

Bump shared npm package versions across multiple repositories with lockfile verification. Prevents the common pitfall of stale lockfiles that resolve to local `file:` or `link:` references instead of the published registry version.

## When to Use

- A shared package (`@models/media-generation-model`, `@models/core.common.model`, etc.) has been published with a new version
- Downstream repos need to pick up the new version
- After merging model package changes as part of a multi-repo workflow (like `add-error-code`)

## Inputs

Gather from the user:
1. **Package name(s)** — e.g., `@models/media-generation-model`, `@models/core.common.model`
2. **Target version(s)** — e.g., `1.5.0`, `^2.0.0`, or `latest`
3. **Target repos** — which repos need the bump (paths or names)
4. **Package manager** per repo — `npm` (default) or `pnpm`

### Common Shared Packages

| Package | Typical Consumers |
|---------|-------------------|
| `@models/media-generation-model` | generate-footage-api, ai-workflow-engine |
| `@models/core.common.model` | ai-workflow-engine, frontend-monorepo |

### Common Repo Paths

| Repo | Path | Package Manager |
|------|------|-----------------|
| generate-footage-api | `~/Develop/assetManagement/core-content-asset-management-generate-footage-api` | npm |
| ai-workflow-engine | `~/Develop/ma-toolkit/ai-workflow-engine` | npm |
| frontend-monorepo | `~/Develop/frontend-monorepo` | pnpm |
| core-services-ai-models-service | `~/Develop/ma-toolkit/core-services-ai-models-service` | npm |
| toolkit-chat-sessions-service | `~/Develop/ma-toolkit/toolkit-chat-sessions-service` | npm |

## Process (per repo)

### 1. Prep

```bash
cd {repo_path}
git checkout main && git pull origin main
```

### 2. Update Version in package.json

Find the dependency in `package.json` (could be in `dependencies` or `devDependencies`) and update to the target version.

For monorepos (like frontend-monorepo), the dependency may be in a nested `package.json`:
```bash
# Find which package.json files reference the dependency
grep -r "{package_name}" --include="package.json" -l .
```

Update each matching `package.json`.

### 3. Clean Reinstall + Verify Lockfile

Run the bundled script — it detects npm vs pnpm, regenerates the lockfile (never `npm ci`, which preserves stale entries), and fails loudly if the package still resolves to a local `file:`/`link:` reference instead of the registry:

```bash
./reinstall.sh {repo_path} {package_name}
```

If it reports a verification failure, the lockfile has stale local references — usually from a prior `npm link`. Clear the cache and retry:
```bash
rm -rf node_modules && rm -f package-lock.json && npm cache clean --force && npm install   # pnpm: pnpm store prune && pnpm install
./reinstall.sh {repo_path} {package_name}
```

### 4. Validate

Run the project's standard checks:

```bash
npm run lint    # or pnpm run lint
npm run build   # or pnpm run build
npm test        # or pnpm test
```

If lint/build/test fail due to breaking changes in the new package version, report to the user — this requires code changes beyond a simple version bump.

### 5. Branch, Commit, Push

```bash
git checkout -b chore/{ticket}-bump-{package_short_name}
git add package.json package-lock.json  # or pnpm-lock.yaml
git commit -m "chore({ticket}): bump {package_name} to {version}"
git push -u origin HEAD
```

## Multi-Repo Parallel Execution

When bumping the same package across multiple repos, the work per repo is fully independent. Use parallel agents — one per repo — each following the process above, **pinned to `model: "sonnet"`**. This is a mechanical version-bump-and-verify task per repo; it doesn't need this session's model tier, and pinning avoids inheriting whatever (often more expensive) model this session happens to be running.

Include in each agent's prompt:
- `model: "sonnet"`
- Package name and target version
- Repo path and package manager
- Jira ticket number (for branch names and commit messages)
- Instruction to run `reinstall.sh` to verify lockfile integrity
- If your own task prompt already identifies you as the dispatched per-repo subagent, follow the Process directly rather than re-delegating.

## Output

After all repos are done, present a summary:

```
## Dependency Bump Summary

| Repo | Package | Old Version | New Version | Lockfile | Lint | Build | Test |
|------|---------|-------------|-------------|----------|------|-------|------|
| generate-footage-api | @models/media-generation-model | 1.4.0 | 1.5.0 | OK | OK | OK | OK |
| ai-workflow-engine | @models/core.common.model | 2.1.0 | 2.2.0 | OK | OK | OK | FAIL |

### Issues
- ai-workflow-engine: Test failure in error-code-mapper.spec.ts — new enum value not handled
```

## Common Pitfalls

- **`npm ci` preserves stale lockfiles** — `reinstall.sh` deletes the lockfile and regenerates it instead
- **`link: true` in lockfile** — Means the package was previously `npm link`ed locally; `reinstall.sh` flags it
- **Monorepo nested package.json** — Search for all `package.json` files that reference the dependency, not just the root
- **Registry auth** — If install fails with 401/403, the user needs to authenticate with the private registry first
- **Version not published yet** — Verify the target version exists: `npm view {package_name} versions --json | grep {version}`
