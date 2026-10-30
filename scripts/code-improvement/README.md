# Daily code improvement

Runs the `dev-workflows:code-improvement` skill once a day on every repo in `repos.txt`.
Each repo gets at most one open improvement PR (label `auto-improve`); a new one starts only
after the previous one is merged and deployed.

```
start.sh → "Code Improvement" cmux tab running loop.sh → daily at 06:43: session.sh
         → per repo: gate.sh, then claude -p when clear → notify (cmux, macOS, email)
launchd (install.sh) → check-loop.sh daily at 06:30 → alert if the loop is not running
```

The loop lives in cmux, not launchd, because cmux's socket only answers processes cmux
started. After a cmux restart or a reboot, start it again: `bash start.sh` from a cmux terminal.

- Change the run time: `CODE_IMPROVEMENT_RUN_AT=07:15` in the environment `start.sh` runs in.
- Run now, outside the schedule: `bash session.sh` from a cmux terminal.
- Logs, per-repo backlogs, the run lock and the loop pid: `~/.claude/state/code-improvement/`.
- Each run is a named Claude session (`code-improvement <repo> <date>`); `claude --resume` opens it.
