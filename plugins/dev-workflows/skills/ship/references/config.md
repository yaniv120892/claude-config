# `.claude/ship.json` — per-repo configuration

Optional. Lives at `<repo>/.claude/ship.json` and is committed, so the pipeline behaves the same for every run in that repo. Every field is optional; anything missing falls back to the defaults below.

```jsonc
{
  "base": "main",

  // Commands. Omit any the repo doesn't have — the pipeline detects
  // package.json scripts on its own; these override that detection.
  "commands": {
    "test":     "npm test",
    "build":    "npm run build",
    "lint":     "npm run lint",
    "format":   "npm run prettier",
    "dev":      "npm run dev"
  },

  // How the QA agent gets the real app in front of it. The single
  // highest-value field in this file — without it QA falls back to
  // reading code, which is a weak pass.
  "qa": {
    "run":  "npm run dev",
    "url":  "http://localhost:3000",
    "notes": "Login with the seeded dev account; prices need PRICING_API_KEY set."
  },

  // The verify-tests phase: how hard it mutates the diff.
  "verifyTests": {
    "maxMutants": 12,                  // mutations applied per run, discards included; 0 skips the pass
    "exclude": ["src/vendor/**"]       // ADDITIONAL to what the phase never mutates
  },

  // Environments for `/ship verify`.
  "dev":  { "url": "https://dev.example.com",  "verify": "Open /portfolio, confirm prices render" },
  "prod": { "url": "https://example.com",      "verify": "Same, plus check the error dashboard" },

  // Model per phase. Omit to inherit the session model.
  "models": {
    "implement":    "opus",
    "polish":       "sonnet",
    "verify-tests": "opus",
    "qa":           "opus"
  },

  // Commit scope convention. "none" for personal repos with no tickets;
  // "ticket" to pull it from the branch name (AIP-123/foo -> AIP-123).
  "scope": "none",

  "pr": { "draft": false }
}
```

## Defaults when the file is absent

| | Default |
|---|---|
| base | the repo's default branch, via `git symbolic-ref refs/remotes/origin/HEAD` |
| commands | detected from `package.json` scripts per `pre-push-quality-gate` |
| qa.run | the repo's `dev` script, or its Dockerfile via `run-service-in-docker` |
| verifyTests.maxMutants | 12 |
| verifyTests.exclude | empty — the phase's own never-mutate rule still applies |
| dev / prod | none — `/ship verify` reports that it has nothing to verify against |
| models | inherit the session model for every phase |
| scope | `ticket` if the branch matches `[A-Z]+-\d+`, else `none` |

## Notes

- Pass this file's **path** to subagents. Never inline its contents into a prompt.
- Absent config never blocks a run. Mention once, at the end, that adding one would sharpen future runs — then drop it.
- `verifyTests.maxMutants` is a budget, not a target, and it bounds the phase's wall-clock: every mutation applied counts against it, including ones discarded for not compiling. Raise it where a bug is expensive. `0` skips the mutation pass — the phase still runs traceability and the tautology check, but returns `BLOCKED — mutation skipped by config` rather than a pass.
- `qa.notes` is the place for whatever a newcomer would need to get the app into a testable state: seeded accounts, required env vars, a service to start first.
