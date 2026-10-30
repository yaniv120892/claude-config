#!/usr/bin/env python3
"""Check the resident code-improvement loop decides when to run correctly.

The loop polls instead of sleeping until the run time, and a first start after the run
time must not fire at once. Getting either wrong means a day with no run, or a surprise run
the moment someone opens the tab — neither of which anyone is watching for.

Run: python3 tests/test_code_improvement_loop.py
"""

import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
LOOP = os.path.join(ROOT, "scripts", "code-improvement", "loop.sh")
EARLIEST = "00:00"
NEVER = "24:00"


def run_loop(*, workspace: str, run_at: str, last_run: str | None) -> tuple[int, str]:
    """Poll the loop once against a session stub that counts its calls.

    Args:
        workspace: An empty temporary directory.
        run_at: The loop's daily run time, HH:MM.
        last_run: The recorded last run date, or None for a first start.

    Returns:
        How many times the session ran, and the last run date the loop recorded.
    """
    state = os.path.join(workspace, "state")
    os.makedirs(state)
    calls = os.path.join(workspace, "session.calls")
    session = os.path.join(workspace, "session.sh")
    with open(session, "w", encoding="utf-8") as handle:
        handle.write(f'echo ran >> "{calls}"\n')
    last_run_file = os.path.join(state, "last-run-date")
    if last_run is not None:
        with open(last_run_file, "w", encoding="utf-8") as handle:
            handle.write(f"{last_run}\n")

    env = {
        **os.environ,
        "CODE_IMPROVEMENT_STATE_DIR": state,
        "CODE_IMPROVEMENT_SESSION": session,
        "CODE_IMPROVEMENT_RUN_AT": run_at,
        "CODE_IMPROVEMENT_POLL_SECONDS": "0",
        "CODE_IMPROVEMENT_MAX_POLLS": "2",
    }
    subprocess.run(["bash", LOOP], env=env, capture_output=True, timeout=30, check=True)

    with open(last_run_file, encoding="utf-8") as handle:
        recorded = handle.read().strip()
    session_runs = 0
    if os.path.exists(calls):
        with open(calls, encoding="utf-8") as handle:
            session_runs = len(handle.read().splitlines())
    return session_runs, recorded


def main() -> int:
    """Run each scenario and compare the session count and recorded date.

    Returns:
        The process exit code: 0 when every scenario matches.
    """
    today = time.strftime("%Y-%m-%d")
    scenarios = {
        "a first start after the run time waits for tomorrow": (EARLIEST, None, 0, today),
        "a missed day runs once, however many polls follow": (EARLIEST, "2000-01-01", 1, today),
        "nothing runs before the run time": (NEVER, "2000-01-01", 0, "2000-01-01"),
        "a day already run does not run again": (EARLIEST, today, 0, today),
    }
    failures = []
    for name, (run_at, last_run, expected_runs, expected_date) in scenarios.items():
        with tempfile.TemporaryDirectory() as workspace:
            outcome = run_loop(workspace=workspace, run_at=run_at, last_run=last_run)
        if outcome != (expected_runs, expected_date):
            failures.append(f"{name}: got {outcome}, expected {(expected_runs, expected_date)}")

    for failure in failures:
        print(f"FAIL  {failure}")
    if not failures:
        print(f"PASS  loop.sh scheduling, {len(scenarios)} scenarios")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
