# Proof of Work


**Run it, and paste what happened — both ways.** The reviewer should be able to see what the code does wrong without this PR and what it does instead with it, from output you actually produced on your machine.

Run the service locally where the change is reachable that way (`docker compose up`, `pnpm dev`, the worker entrypoint) and drive the changed path for real. Where it is not reachable — no running service, external keys needed, a database-dependent flow — write a script that drives the real module with realistic data, and run that instead. Either way, produce the *without* half too: `git stash`, check the files out from the base branch, or turn the new path off, and run the identical command again.

**Format:**

````markdown
## Proof of Work

Ran the worker locally over 200 source images with `scripts/repro-oom.sh` (included below).

**Without this change** — resident memory climbs until the process is killed:
```
[worker] processed 12 images
Killed (exit 137), peak RSS 3.9GB
```

**With this change** — the same run finishes, memory flat:
```
[worker] processed 200 images
done in 41s, peak RSS 412MB
```

**Not proven locally:** the dev pod is capped at 4Gi, half this laptop's headroom.
````

- **Tests are not evidence anywhere in the description** (Core principle). The shape to catch yourself writing here is "Also ran/added the new `x.test.ts` (`→ ok`)", tacked on after real output because it felt generous — or the same sentence relocated to a risk note. Cut it; what you ran above already carries the section.
- **Both halves, same command.** One-sided output proves the code runs, not that it fixes anything.
- **Say how you ran it** — the command, the script, the endpoint — so a reviewer can reproduce it. Paste a short script inline in a fenced block, or commit it and name the path.
- **Paste real output**, trimmed to the lines carrying the claim. A description of the output is not the output.
- **Close with `**Not proven locally:**`** naming what the run could not reach. `## Verify on dev` opens with that same line as its `**Only dev can prove:**` — carry it down as-is rather than rewording it.
- Where there is genuinely no *before* — a brand-new endpoint — the 404 from the base branch is the before. Show it.

**What counts as the run:**
- A live call: `curl` against the local service, plus the response body.
- A Temporal workflow run ID + status (the run ID is in the local UI at `http://localhost:8233`), or the history event showing the new field.
- Log lines showing the new behavior, on both sides.
- A metrics sample: `curl localhost:9090/metrics | grep <metric_name>`.
- For a UI flow, a numbered frame sequence (`01-empty-form.png` → `04-success.png`) or a GIF — the route, not just the destination. `gh` cannot attach media to a PR body, so these get dragged in through the web UI; cite a frame only once it is actually attached.
- A script that imports the real module and runs on real data shapes — labeled `Script output:`, not dressed up as a live service call.
