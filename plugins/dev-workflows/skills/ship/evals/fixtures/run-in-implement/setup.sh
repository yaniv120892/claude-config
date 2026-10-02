# A run paused in the implement phase, in the worktree its state.json names, on
# the branch it names, so nothing about the state looks stale to the agent.
git init --quiet -b main
git commit --quiet --allow-empty -m "init"
git checkout --quiet -b feat/price-alerts
mkdir -p .claude/ship
cat > .claude/ship/state.json <<JSON
{
  "slug": "price-alerts",
  "type": "feature",
  "request": "Let users set a price alert on a product and email them when it drops below it.",
  "repo": "$PWD",
  "worktree": "$PWD",
  "branch": "feat/price-alerts",
  "base": "main",
  "pr": null,
  "phase": "implement",
  "history": [
    {"phase": "scope", "at": "2026-09-30T09:12:00Z", "note": "email only, no push notifications"},
    {"phase": "plan", "at": "2026-09-30T10:40:00Z"},
    {"phase": "plan-approved", "at": "2026-09-30T10:55:00Z"}
  ]
}
JSON
printf '.claude/\n' >> .git/info/exclude
