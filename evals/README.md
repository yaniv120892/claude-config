# Skill evals

A skill can go wrong in two ways that no unit test sees. Its description can stop
matching the prompts it is meant for, or start matching ones meant for a sibling.
Or it can fire and then do the wrong thing. These evals run real prompts through a
real agent harness and check both.

The same cases run on **Claude Code** and on **Codex**. A case that passes on one
and fails on the other points at a portability gap in the skill.

## Running

```sh
python3 evals/run.py --validate                      # check every evals.json, free
python3 evals/run.py --harness claude                # every case, once
python3 evals/run.py --harness codex --skill pr-review
python3 evals/run.py --harness claude --kind trigger --runs 5
python3 evals/run.py --harness claude --dry-run      # print the commands only
```

Each run costs model calls: about $0.15 for a trigger case and up to $3 for a
behavior case, capped per run by `--budget` on Claude. CI runs only `--validate`,
through `tests/test_skill_evals.py`. Run the evals yourself after editing a skill's
description or body, and before trusting a change to one.

Raw harness logs and a `results.json` land in `evals/results/`, which git ignores.
`--keep` also keeps each run's working directory, for looking at what the agent
left behind.

## How a run is isolated

Every case runs in a fresh temporary git repo, never in this checkout.

| | Claude Code | Codex |
| --- | --- | --- |
| Skill source | `--plugin-dir plugins/<plugin>` from this checkout | the plugin's skills linked into the repo's `.agents/skills/` |
| Your own config | user settings skipped (`--setting-sources project`), so globally installed plugins don't compete | your `~/.codex` config applies |
| Trigger case | `Bash`, `Edit`, `Write`, `Agent` and web tools blocked | `-s read-only` |
| Behavior case | tools allowed inside the temp repo | `-s workspace-write` |
| Invoking explicitly | `/<plugin>:<skill> <prompt>` | `$<skill> <prompt>` |

Every run gets `GH_TOKEN=eval-sandbox-no-access`, so a skill that calls `gh` fails
rather than acting on your real GitHub account.

The two harnesses also show that a skill fired in different ways. On Claude Code,
the run calls the `Skill` tool with the skill's name. Codex has no such tool, so a
run counts as firing a skill when a command reads that skill's `SKILL.md`.

## Writing cases

Cases live beside the skill, in `<skill>/evals/evals.json`, so they move with it.

```json
{
  "cases": [
    {
      "id": "safe-to-merge",
      "kind": "trigger",
      "prompt": "Is PR #123 in acme/widgets safe to merge?",
      "expect_trigger": true
    },
    {
      "id": "no-target-asks",
      "kind": "behavior",
      "invoke": true,
      "fixture": "fixtures/feature-branch",
      "prompt": "review my current branch",
      "checks": [
        {"final_matches": "(?i)which .*PR"},
        {"run": "test -z \"$(git status --porcelain)\""}
      ]
    }
  ]
}
```

**Trigger cases.** Give each skill both kinds:
- prompts it should fire on, phrased the way you would actually ask;
- near-misses that belong to a sibling skill or to no skill.

A near-miss is what catches a description that has grown too broad. One run of a
trigger case is a coin flip, so judge a description by `--runs 5` or more.

A skill marked `disable-model-invocation: true` gets one trigger case with
`expect_trigger: false`. That case checks the harness keeps the skill explicit-only.

**Behavior cases.** These run the skill against a fixture and check the outcome.
- `invoke: true` prefixes the prompt with the harness's explicit-invocation syntax.
- `fixture` names a directory under `evals/`. It is copied into the temp repo. If it
  holds a `setup.sh`, that script runs there and is then deleted, so the agent sees
  the state the script built, not the script itself. Without a `setup.sh`, the
  fixture is committed as a single initial commit.

Checks, all of which must pass:

| Check | Passes when |
| --- | --- |
| `final_matches` | the agent's final message matches the regex |
| `final_not_matches` | it does not match |
| `max_lines` | the final message has at most this many non-blank lines |
| `run` | the shell command exits 0 in the repo the agent left behind |

Check what the skill promises, not how it gets there. "Asks which PR" survives a
rewrite of the skill's wording; "says the phrase 'explicit targets'" does not.
