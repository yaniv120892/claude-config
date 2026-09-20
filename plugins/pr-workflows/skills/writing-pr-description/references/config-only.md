# Config-only

For PRs whose only change is configuration — Helm/Kubernetes values, Terraform, Crossplane manifests, resource requests/limits, replica counts, env vars — with no application code and therefore nothing to build/lint/test, skip the full structure entirely. There is no Implementation or Proof of Work section: the diff (a values file) is already fully self-explanatory line-by-line, and there's no runtime evidence to gather pre-merge.

**The test is whether the diff explains itself line-by-line.** A values file does; a config file that *changes behaviour* does not, and does not get this form. A `.github/workflows/*.yml` job change, an `eslint.config.mjs` rule, a `tsconfig` path, or a Dockerfile edit all alter what runs — they take the full structure, and their Proof of Work is a pipeline job list, a resolved-config dump (`npx eslint --print-config <file>`), or a built image, not a claim that the file was edited.

Use one short prose block (what changed + why, folded together — this doubles as the Motivation) plus a before/after table:

```markdown
<1–4 sentences: what the service/component does (only if the reviewer needs that context), where/how the
problem shows up (an incident, a metric, an OOM event), and why these specific new values were chosen —
not just that they changed.>

| | before | after |
|---|---|---|
| `<field>` | <old value> | **<new value>** |

<Optional one-line scope/rollout note, e.g. "Prod only — dev unchanged.">
```

**Good example (from an `eks-services-gitops` PR):**
```markdown
`ai-models-error-mapping`'s **implement** phase clones 4 repos, installs deps, and drives the Claude CLI
inside a single pod — a resource-heavy burst on top of otherwise low, scheduler-driven traffic. On
2026-07-21, an implement run was OOM-killed (exit 137) ~38 min in, even after an earlier 1Gi→3Gi/4Gi bump.

| | before | after |
|---|---|---|
| `requests.memory` | 3Gi | **6Gi** |
| `limits.memory` | 4Gi | **8Gi** |

**Prod only — dev unchanged.**
```
