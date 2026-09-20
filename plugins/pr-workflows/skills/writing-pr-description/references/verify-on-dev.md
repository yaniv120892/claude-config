# Verify on dev

Read when the change ships inside a deployed service. Also the guidance for a repo template's QA / Rollout / Post-deploy slot. It builds on Proof of Work's `**Not proven locally:**` line, so read that file first.

### Verify on dev

Acceptance criteria for after the merge deploys: what someone opens, runs, and looks at to call this change good on dev. The thinking already happened while gathering proof — this is the `**Not proven locally:**` line carried down and turned into a checklist, plus the sanity checks that say the service survived the deploy at all. The framing line here restates that gap for a reader who starts at this heading; it does not need new words for the same idea.

**Include it whenever the change ships inside a deployed service.** It is always at least these three, in this order:

1. **The service is up** — the rollout finished and the health endpoint answers.
2. **Sanity** — the surrounding flow still works: one existing request path returns what it returned before this PR.
3. **The proof, on dev** — the same check from Proof of Work run against dev, showing the *with this change* outcome.

Then add a box for anything only the deployed accounts can settle: a value the environment supplies from a secret store, queue/topic/routing wiring, an endpoint default that pointed at local infrastructure, ingress/probe/auth reachability, the runtime dependency set baked into the image, or a contract against a real upstream.

**Format — one framing line, then each criterion paired with the command that settles it:**

```markdown
## Verify on dev

**Only dev can prove:** `TRANSACTION_ROUTING_KEY` matches the SNS `filterPolicy` — that pairing exists only in the deployed accounts.

- [ ] **Rollout finished and the service answers** — `kubectl -n dev rollout status deploy/<deployment>`, then `curl -s "$DEV_API/health"` → `{"status":"ok"}`
- [ ] **Existing jobs still complete** — `curl -sX POST "$DEV_API/jobs" -d @sample.json | jq -r .id`, then `curl -s "$DEV_API/jobs/<id>" | jq .status` → `completed`
- [ ] **The new path runs on dev** — same check as Proof of Work: `kubectl -n dev logs deploy/<deployment> | grep 'transaction settled'` shows a non-null ticket
- [ ] **Memory stays flat under the same batch** — `kubectl -n dev top pod -l app=<app>` well under the 4Gi limit
```

- **Every box names a command and the outcome that command should show** — the sanity box included. It is the one that tends to get written as "a normal request still works", with no way for the next person to run it.
- **A check that takes several calls is still a command.** Write the loop or the sequence — `for i in $(seq 1 5); do curl -s -o /dev/null -w '%{http_code} ' "$DEV_API/" -H 'x-api-key: <key>'; done` → `200 200 200 429 429` — rather than "send more requests than the limit allows".
- **You will not know dev's real values, and that is not a reason to fall back to prose.** Write the command with the blank left in it — `$DEV_API`, `<api-key>`, `<job-id>`, `$RATE_LIMIT_MAX` — because a command with one blank to fill beats a sentence the next person has to reconstruct a command from. The boxes that decay into description are almost always the ones where a value was unknown, and that is precisely where the reader needs the shape of the call.
- A green pipeline never settles a box — nothing in CI runs the deployed image.
- Omit the section only when nothing about the change reaches a deployed environment.
