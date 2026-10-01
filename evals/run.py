#!/usr/bin/env python3
"""Run skill evals against an agent harness: Claude Code or Codex.

Each skill keeps its cases in `<skill>/evals/evals.json`, beside its SKILL.md, so
the cases travel with the skill. Two kinds of case:

- trigger:  one prompt, and whether the skill should fire on it. Tools that act
            are blocked, so a trigger run only shows what the agent reached for.
- behavior: a prompt run against a throwaway fixture repo, then checks on the
            agent's final message and on the repo it left behind.

The same cases run on every harness. A case that passes on one and fails on the
other is a portability bug in the skill, not in the case.

Usage:
  python3 evals/run.py --validate
  python3 evals/run.py --harness claude --skill pr-review
  python3 evals/run.py --harness codex --kind trigger --runs 3
  python3 evals/run.py --harness claude --dry-run
"""

import argparse
import dataclasses
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_DIR = os.path.join(ROOT, "evals", "results")
HARNESSES = ("claude", "codex")
KINDS = ("trigger", "behavior")
CHECK_KEYS = ("final_matches", "final_not_matches", "max_lines", "run")

# A behavior run may call `gh`, and some skills post to GitHub. An unusable token
# makes every such call fail instead of acting on the user's real account.
SANDBOX_ENV = {"GH_TOKEN": "eval-sandbox-no-access", "GIT_TERMINAL_PROMPT": "0"}
CLAUDE_TRIGGER_BLOCKED = "Bash Edit Write NotebookEdit WebFetch WebSearch Agent"
CLAUDE_BEHAVIOR_ALLOWED = "Bash Read Edit Write Glob Grep Skill Agent"


@dataclasses.dataclass
class Skill:
    name: str
    plugin: str
    skill_dir: str
    cases: list[dict]


@dataclasses.dataclass
class Transcript:
    final: str
    skills_invoked: set[str]
    exit_code: int
    log_path: str


def discover(skill_filter: list[str] | None) -> list[Skill]:
    """Find every skill that ships an evals.json.

    Args:
        skill_filter: Skill names to keep, or None for all of them.

    Returns:
        The skills with evals, sorted by plugin then name.
    """
    skills = []
    pattern = os.path.join(ROOT, "plugins", "*", "skills", "*", "evals", "evals.json")
    for path in sorted(glob.glob(pattern)):
        skill_dir = os.path.dirname(os.path.dirname(path))
        name = os.path.basename(skill_dir)
        if skill_filter and name not in skill_filter:
            continue
        with open(path, encoding="utf-8") as handle:
            spec = json.load(handle)
        plugin = os.path.basename(os.path.dirname(os.path.dirname(skill_dir)))
        skills.append(Skill(name, plugin, skill_dir, spec.get("cases", [])))
    return skills


def validate(skill: Skill) -> list[str]:
    """List what is wrong with a skill's cases, without running any of them.

    Args:
        skill: The skill whose evals.json to check.

    Returns:
        One message per problem; empty when the file is sound.
    """
    errors = []
    seen_ids = set()
    for index, case in enumerate(skill.cases):
        label = f"{skill.name}[{case.get('id', index)}]"
        if not case.get("id"):
            errors.append(f"{label}: missing id")
        elif case["id"] in seen_ids:
            errors.append(f"{label}: duplicate id")
        seen_ids.add(case.get("id"))
        if not case.get("prompt"):
            errors.append(f"{label}: missing prompt")
        kind = case.get("kind")
        if kind not in KINDS:
            errors.append(f"{label}: kind must be one of {KINDS}")
        if kind == "trigger" and not isinstance(case.get("expect_trigger"), bool):
            errors.append(f"{label}: a trigger case needs expect_trigger true or false")
        if kind == "behavior" and not case.get("checks"):
            errors.append(f"{label}: a behavior case needs at least one check")
        for check in case.get("checks", []):
            if len(check) != 1 or next(iter(check)) not in CHECK_KEYS:
                errors.append(f"{label}: each check is one of {CHECK_KEYS}, got {check}")
        fixture = case.get("fixture")
        if fixture and not os.path.isdir(os.path.join(skill.skill_dir, "evals", fixture)):
            errors.append(f"{label}: fixture {fixture} does not exist")
    return errors


def prepare_workdir(skill: Skill, case: dict, harness: str) -> str:
    """Build the throwaway git repo a case runs in.

    The fixture is copied in and its `setup.sh`, if any, runs and is then removed,
    so the agent sees the state setup produced rather than the script.

    Args:
        skill: The skill under test.
        case: The case being run.
        harness: Which harness will run in the directory.

    Returns:
        The path of the prepared directory.
    """
    workdir = tempfile.mkdtemp(prefix=f"eval-{skill.name}-")
    fixture = case.get("fixture")
    if fixture:
        shutil.copytree(os.path.join(skill.skill_dir, "evals", fixture), workdir, dirs_exist_ok=True)
    git_env = {
        **os.environ,
        **SANDBOX_ENV,
        "GIT_AUTHOR_NAME": "eval",
        "GIT_AUTHOR_EMAIL": "eval@example.com",
        "GIT_COMMITTER_NAME": "eval",
        "GIT_COMMITTER_EMAIL": "eval@example.com",
    }
    setup = os.path.join(workdir, "setup.sh")
    if os.path.exists(setup):
        subprocess.run(["bash", setup], cwd=workdir, env=git_env, check=True, capture_output=True)
        os.remove(setup)
    if not os.path.isdir(os.path.join(workdir, ".git")):
        subprocess.run(["git", "init", "--quiet", "-b", "main"], cwd=workdir, env=git_env, check=True)
        subprocess.run(["git", "add", "-A"], cwd=workdir, env=git_env, check=True)
        subprocess.run(
            ["git", "commit", "--quiet", "--allow-empty", "-m", "init"],
            cwd=workdir, env=git_env, check=True,
        )
    if harness == "codex":
        install_for_codex(skill, workdir)
    return workdir


def install_for_codex(skill: Skill, workdir: str) -> None:
    """Expose the skill's whole plugin to Codex through the repo's `.agents/skills/`.

    Every sibling skill is linked, not just the one under test, so a trigger case
    competes against the same near-misses it would in real use.

    Args:
        skill: The skill under test.
        workdir: The repo Codex will run in.
    """
    target = os.path.join(workdir, ".agents", "skills")
    os.makedirs(target, exist_ok=True)
    plugin_skills = os.path.join(ROOT, "plugins", skill.plugin, "skills")
    for name in os.listdir(plugin_skills):
        os.symlink(os.path.join(plugin_skills, name), os.path.join(target, name))
    with open(os.path.join(workdir, ".git", "info", "exclude"), "a", encoding="utf-8") as handle:
        handle.write("\n.agents/\n")


def build_command(harness: str, skill: Skill, case: dict, workdir: str, args: argparse.Namespace) -> list[str]:
    """Assemble the non-interactive harness invocation for one case.

    Args:
        harness: "claude" or "codex".
        skill: The skill under test.
        case: The case being run.
        workdir: The repo the agent runs in.
        args: Parsed command-line options.

    Returns:
        The argv to execute.
    """
    prompt = case["prompt"]
    is_trigger = case["kind"] == "trigger"
    if harness == "claude":
        if case.get("invoke"):
            prompt = f"/{skill.plugin}:{skill.name} {prompt}"
        budget = args.budget or (0.5 if is_trigger else 3.0)
        command = [
            "claude", "-p", prompt,
            "--plugin-dir", os.path.join(ROOT, "plugins", skill.plugin),
            # Project settings only, so plugins the user installed globally do
            # not load beside the checkout under test and blur which one fired.
            "--setting-sources", "project",
            "--output-format", "stream-json", "--verbose",
            "--no-session-persistence",
            "--max-budget-usd", str(budget),
        ]
        if is_trigger:
            command += ["--permission-mode", "default", "--disallowedTools", CLAUDE_TRIGGER_BLOCKED]
        else:
            command += ["--permission-mode", "acceptEdits", "--allowedTools", CLAUDE_BEHAVIOR_ALLOWED]
    else:
        if case.get("invoke"):
            prompt = f"${skill.name} {prompt}"
        command = [
            "codex", "exec", "--json", "--ephemeral", "--skip-git-repo-check",
            "-C", workdir,
            "-s", "read-only" if is_trigger else "workspace-write",
            "-o", os.path.join(workdir, ".eval-last-message"),
            prompt,
        ]
    if args.model and harness == "claude":
        command += ["--model", args.model]
    elif args.model:
        # Codex takes its prompt as the final positional, so options go before it.
        command[-1:-1] = ["-m", args.model]
    return command


def parse_claude(log_path: str) -> tuple[str, set[str]]:
    """Read the final message and the skills invoked from a stream-json log.

    Args:
        log_path: The captured stdout of `claude -p --output-format stream-json`.

    Returns:
        The final message and the bare names of every skill the agent invoked.
    """
    final, invoked = "", set()
    for event in read_jsonl(log_path):
        if event.get("type") == "result":
            final = event.get("result") or ""
        if event.get("type") != "assistant":
            continue
        for block in event.get("message", {}).get("content", []):
            if block.get("type") == "tool_use" and block.get("name") == "Skill":
                invoked.add(str(block.get("input", {}).get("skill", "")).split(":")[-1])
    return final, invoked


def parse_codex(log_path: str, workdir: str, skill_names: list[str]) -> tuple[str, set[str]]:
    """Read the final message and the skills invoked from a `codex exec --json` log.

    Codex has no skill tool: it loads a skill by reading its SKILL.md, so a read
    of `<name>/SKILL.md` by any command is the invocation. Agent messages are
    skipped, since the agent can name a skill without loading it.

    Args:
        log_path: The captured JSONL stdout of `codex exec --json`.
        workdir: The repo Codex ran in, which holds the last-message file.
        skill_names: Every skill name in the plugin under test.

    Returns:
        The final message and the names of every skill whose SKILL.md was read.
    """
    invoked = set()
    for event in read_jsonl(log_path):
        item = event.get("item") or {}
        if event.get("type") != "item.completed" or item.get("type") in ("agent_message", "reasoning"):
            continue
        text = json.dumps(item)
        invoked.update(name for name in skill_names if f"{name}/SKILL.md" in text)
    last_message = os.path.join(workdir, ".eval-last-message")
    final = ""
    if os.path.exists(last_message):
        with open(last_message, encoding="utf-8") as handle:
            final = handle.read()
        os.remove(last_message)
    return final, invoked


def read_jsonl(path: str) -> list[dict]:
    """Parse a JSON-lines file, skipping lines that are not JSON objects.

    Args:
        path: The file to read.

    Returns:
        The decoded objects, in order.
    """
    events = []
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict):
                events.append(event)
    return events


def run_case(harness: str, skill: Skill, case: dict, args: argparse.Namespace, log_dir: str) -> tuple[Transcript, str]:
    """Run one case once and capture what the agent did.

    Args:
        harness: "claude" or "codex".
        skill: The skill under test.
        case: The case to run.
        args: Parsed command-line options.
        log_dir: Where to keep the raw harness log.

    Returns:
        The transcript, and the workdir the agent left behind.
    """
    workdir = prepare_workdir(skill, case, harness)
    command = build_command(harness, skill, case, workdir, args)
    log_path = os.path.join(log_dir, f"{harness}-{skill.name}-{case['id']}-{int(time.time() * 1000)}.jsonl")
    with open(log_path, "w", encoding="utf-8") as log:
        completed = subprocess.run(
            command, cwd=workdir, env={**os.environ, **SANDBOX_ENV},
            stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            timeout=args.timeout, check=False,
        )
    if harness == "claude":
        final, invoked = parse_claude(log_path)
    else:
        sibling_skills = os.listdir(os.path.join(ROOT, "plugins", skill.plugin, "skills"))
        final, invoked = parse_codex(log_path, workdir, sibling_skills)
    return Transcript(final, invoked, completed.returncode, log_path), workdir


def grade(skill: Skill, case: dict, transcript: Transcript, workdir: str) -> list[str]:
    """Compare what the agent did against the case's expectations.

    Args:
        skill: The skill under test.
        case: The case that ran.
        transcript: What the agent did.
        workdir: The repo the agent left behind.

    Returns:
        One message per failed expectation; empty when the case passed.
    """
    failures = []
    if case["kind"] == "trigger":
        fired = skill.name in transcript.skills_invoked
        if fired != case["expect_trigger"]:
            others = sorted(transcript.skills_invoked - {skill.name}) or "none"
            verb = "did not fire" if case["expect_trigger"] else "fired"
            failures.append(f"{skill.name} {verb} (other skills invoked: {others})")
        return failures
    if not transcript.final:
        failures.append(f"no final message (harness exit {transcript.exit_code})")
    for check in case["checks"]:
        key, value = next(iter(check.items()))
        if key == "final_matches" and not re.search(value, transcript.final):
            failures.append(f"final message does not match /{value}/")
        elif key == "final_not_matches" and re.search(value, transcript.final):
            failures.append(f"final message matches /{value}/")
        elif key == "max_lines":
            lines = len([line for line in transcript.final.strip().splitlines() if line.strip()])
            if lines > value:
                failures.append(f"final message has {lines} non-blank lines, limit {value}")
        elif key == "run":
            completed = subprocess.run(
                ["bash", "-c", value], cwd=workdir, capture_output=True, text=True, check=False
            )
            if completed.returncode != 0:
                failures.append(f"check failed: {value}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--harness", choices=HARNESSES, default="claude")
    parser.add_argument("--skill", action="append", help="run only this skill; repeatable")
    parser.add_argument("--case", action="append", help="run only this case id; repeatable")
    parser.add_argument("--kind", choices=KINDS, help="run only this kind of case")
    parser.add_argument("--runs", type=int, default=1, help="repeat each case; trigger rates need several")
    parser.add_argument("--model", help="model override passed to the harness")
    parser.add_argument("--budget", type=float, help="claude only: max USD per run")
    parser.add_argument("--timeout", type=int, default=900, help="seconds per run")
    parser.add_argument("--validate", action="store_true", help="check every evals.json, run nothing")
    parser.add_argument("--dry-run", action="store_true", help="print each command, run nothing")
    parser.add_argument("--keep", action="store_true", help="keep each run's workdir for inspection")
    args = parser.parse_args()

    skills = discover(args.skill)
    errors = [error for skill in skills for error in validate(skill)]
    if errors or args.validate:
        for error in errors:
            print(f"INVALID  {error}")
        print(f"{len(skills)} skills with evals, {len(errors)} problems")
        return 1 if errors else 0

    os.makedirs(RESULTS_DIR, exist_ok=True)
    log_dir = tempfile.mkdtemp(prefix="eval-logs-", dir=RESULTS_DIR)
    results = []
    for skill in skills:
        for case in skill.cases:
            if (args.kind and case["kind"] != args.kind) or (args.case and case["id"] not in args.case):
                continue
            if args.dry_run:
                command = build_command(args.harness, skill, case, "<workdir>", args)
                print(f"{skill.name}/{case['id']}: {subprocess.list2cmdline(command)}")
                continue
            passes = 0
            for attempt in range(args.runs):
                transcript, workdir = run_case(args.harness, skill, case, args, log_dir)
                failures = grade(skill, case, transcript, workdir)
                passes += not failures
                status = "PASS" if not failures else "FAIL"
                print(f"{status}  {skill.name}/{case['id']} run {attempt + 1}/{args.runs}")
                for failure in failures:
                    print(f"      {failure}")
                if failures:
                    print(f"      log: {transcript.log_path}")
                if not args.keep:
                    shutil.rmtree(workdir, ignore_errors=True)
                results.append({
                    "harness": args.harness, "skill": skill.name, "case": case["id"],
                    "kind": case["kind"], "attempt": attempt + 1, "failures": failures,
                    "skills_invoked": sorted(transcript.skills_invoked),
                    "final": transcript.final, "log": transcript.log_path,
                })
    if args.dry_run:
        return 0

    passed = sum(not result["failures"] for result in results)
    summary_path = os.path.join(log_dir, "results.json")
    with open(summary_path, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)
    print(f"\n{passed}/{len(results)} runs passed on {args.harness}. Details: {summary_path}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
