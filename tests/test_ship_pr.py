#!/usr/bin/env python3
"""Check scripts/ship-pr.sh hands the gh account back however it exits.

The script switches to the repo owner's account to push. Leaving that account
active means every later `gh` call in a work repo runs as the wrong user. The fake
`gh api user` answers a different name on purpose: after a GitHub rename, gh's
stored account name no longer matches the live login, and only the stored one
can be switched back to.

Run: python3 tests/test_ship_pr.py
"""

import os
import stat
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SCRIPT = os.path.join(ROOT, "scripts", "ship-pr.sh")

FAKE_GH = """#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "auth status") echo work-account ;;
  "api user") echo renamed-login ;;
  "pr view") exit 1 ;;
  "pr create") exit 1 ;;
esac
"""


def run(cmd, cwd, env=None):
    subprocess.run(cmd, cwd=cwd, env=env, check=True, capture_output=True)


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        origin = os.path.join(tmp, "origin.git")
        repo = os.path.join(tmp, "repo")
        bin_dir = os.path.join(tmp, "bin")
        log = os.path.join(tmp, "gh.log")
        os.makedirs(bin_dir)
        gh = os.path.join(bin_dir, "gh")
        with open(gh, "w", encoding="utf-8") as handle:
            handle.write(FAKE_GH)
        os.chmod(gh, os.stat(gh).st_mode | stat.S_IEXEC)

        run(["git", "init", "-q", "--bare", origin], tmp)
        run(["git", "clone", "-q", origin, repo], tmp)
        git_id = ["-c", "user.name=t", "-c", "user.email=t@t"]
        run(["git", *git_id, "commit", "-q", "--allow-empty", "-m", "c"], repo)
        run(["git", "checkout", "-q", "-b", "feature"], repo)

        env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "GH_LOG": log}
        result = subprocess.run(["bash", SCRIPT, "title"], cwd=repo, env=env, capture_output=True)

        with open(log, encoding="utf-8") as handle:
            switches = [line.strip() for line in handle if line.startswith("auth switch")]

    failures = []
    if result.returncode == 0:
        failures.append("script succeeded although `gh pr create` failed")
    if switches[:1] != ["auth switch -u yaniv120892"]:
        failures.append(f"did not switch to the owner account first: {switches}")
    if switches[-1:] != ["auth switch -u work-account"]:
        failures.append(f"did not restore the previous account on failure: {switches}")
    for failure in failures:
        print(f"FAIL  {failure}")
    if not failures:
        print("ok  ship-pr.sh restores the gh account on failure")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
