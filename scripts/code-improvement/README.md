# Daily code improvement

Runs the `dev-workflows:code-improvement` skill once a day on every repo in `repos.txt`.
Each repo gets at most one open improvement PR (label `auto-improve`); a new one starts only
after the previous one is merged and deployed.

```
start.sh → "Code Improvement" cmux tab running loop.sh → daily at 06:43: session.sh
         → per repo: gate.sh, then claude -p when clear → notify (cmux, macOS, email)
launchd (install.sh) → check-loop.sh hourly → alert if the loop is down or today's run is late
```

The loop lives in cmux, not launchd, because cmux's socket only answers processes cmux
started. After a cmux restart or a reboot the watchdog alerts; start the loop again with
`bash start.sh` from a cmux terminal. A day missed while the loop was down runs as soon as
it is back.

- Set up a machine, or pick up a change to the watchdog: `./install.sh` from the main checkout
  (the plist points at the path you run it from), then `bash start.sh` from a cmux terminal.
- Change the run time: `CODE_IMPROVEMENT_RUN_AT` in `lib.sh` — the loop's tab does not inherit
  your shell's environment.
- Run now, outside the schedule: `bash session.sh` from a cmux terminal.
- Logs, per-repo backlogs, locks and the last run date: `~/.claude/state/code-improvement/`.
- Each run is a named Claude session (`code-improvement <repo> <date>`); `claude --resume` opens it.
