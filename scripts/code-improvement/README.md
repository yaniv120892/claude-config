# Daily code improvement

Runs the `dev-workflows:code-improvement` skill once a day on every repo in `repos.txt`.
Each repo gets at most one open improvement PR (label `auto-improve`); a new one starts only
after the previous one is merged and deployed.

```
launchd (install.sh) → run-daily.sh → new tab in the "Code Improvement" cmux workspace
                     → session.sh → claude -p per repo, in order → notify (cmux, macOS, email)
```

- Install or change the time: `CODE_IMPROVEMENT_HOUR=6 CODE_IMPROVEMENT_MINUTE=43 ./install.sh`,
  run from the main checkout — the plist points at the path you run it from.
- Run now: `launchctl kickstart gui/$(id -u)/com.yaniv.code-improvement`.
- Logs, per-repo backlogs and the run lock: `~/.claude/state/code-improvement/`.
- Each run is a named Claude session (`code-improvement <repo> <date>`); `claude --resume` opens it.
