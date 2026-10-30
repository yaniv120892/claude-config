#!/usr/bin/env python3
"""Check the resident code-improvement loop and its watchdog decide correctly.

The loop owns the daily schedule and the watchdog is the only thing that notices when it
stops. Each failure here means a day with no run, a duplicate multi-hour run, or an alert
that cries wolf — and nobody is watching either script when it happens.

Run: python3 tests/test_code_improvement_loop.py
"""

import os
import stat
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SCRIPTS = os.path.join(ROOT, "scripts", "code-improvement")
TODAY = "2026-10-30"
YESTERDAY = "2026-10-29"


def write_executable(*, path: str, body: str) -> None:
    """Write a stub script and mark it executable.

    Args:
        path: Where to write it.
        body: The script text.
    """
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(body)
    os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC)


def read_lines(path: str) -> list[str]:
    """Return a file's lines, or none when it does not exist.

    Args:
        path: The file to read.

    Returns:
        Its lines.
    """
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return handle.read().splitlines()


class Sandbox:
    """A state dir, a pinned clock, and stubs for session.sh and osascript."""

    def __init__(self, workspace: str, *, now: str, last_run: str | None) -> None:
        self.workspace = workspace
        self.state = os.path.join(workspace, "state")
        os.makedirs(self.state)
        bin_dir = os.path.join(workspace, "bin")
        os.makedirs(bin_dir)
        self.session_calls = os.path.join(workspace, "session.calls")
        self.alerts = os.path.join(workspace, "alerts")
        self.session = os.path.join(workspace, "session.sh")
        write_executable(path=self.session, body=f'echo ran >> "{self.session_calls}"\n')
        write_executable(
            path=os.path.join(bin_dir, "osascript"),
            body=f'#!/usr/bin/env bash\necho "${{@: -1}}" >> "{self.alerts}"\n',
        )
        if last_run is not None:
            with open(os.path.join(self.state, "last-run-date"), "w", encoding="utf-8") as handle:
                handle.write(f"{last_run}\n")
        self.env = {
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "CODE_IMPROVEMENT_STATE_DIR": self.state,
            "CODE_IMPROVEMENT_SESSION": self.session,
            "CODE_IMPROVEMENT_RUN_AT": "06:43",
            "CODE_IMPROVEMENT_NOW": now,
            "CODE_IMPROVEMENT_TODAY": TODAY,
            "CODE_IMPROVEMENT_POLL_SECONDS": "0",
            "CODE_IMPROVEMENT_MAX_POLLS": "3",
        }

    def run(self, script: str, **overrides: str) -> subprocess.CompletedProcess[str]:
        """Run one of the scripts against this sandbox.

        Args:
            script: The script's file name under scripts/code-improvement.
            **overrides: Environment variables to change for this run.

        Returns:
            The finished process.
        """
        return subprocess.run(
            ["bash", os.path.join(SCRIPTS, script)],
            env={**self.env, **overrides},
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

    def last_run(self) -> str:
        """Return the last run date the loop recorded, or empty."""
        lines = read_lines(os.path.join(self.state, "last-run-date"))
        return lines[0] if lines else ""

    def hold_loop_lock(self) -> subprocess.Popen[bytes]:
        """Start a live process named loop.sh and record it as the lock holder.

        Returns:
            The running process; the caller kills it.
        """
        impostor = os.path.join(self.workspace, "loop.sh")
        write_executable(path=impostor, body="#!/usr/bin/env bash\nsleep 30\n")
        process = subprocess.Popen(["bash", impostor])
        lock_dir = os.path.join(self.state, "loop.lock")
        os.makedirs(lock_dir)
        with open(os.path.join(lock_dir, "pid"), "w", encoding="utf-8") as handle:
            handle.write(f"{process.pid}\n")
        return process


def loop_scenarios(workspace_root: str) -> list[str]:
    """Check when the loop runs the session.

    Args:
        workspace_root: A temporary directory for the sandboxes.

    Returns:
        A failure line per scenario that did not match.
    """
    scenarios = {
        "a missed day runs once, however many polls follow": ("09:00", YESTERDAY, 1, TODAY),
        "a first start after the run time runs today": ("09:00", None, 1, TODAY),
        "nothing runs before the run time": ("06:42", YESTERDAY, 0, YESTERDAY),
        "a day already run does not run again": ("23:59", TODAY, 0, TODAY),
    }
    failures = []
    for index, (name, (now, last_run, expected_runs, expected_date)) in enumerate(scenarios.items()):
        sandbox = Sandbox(os.path.join(workspace_root, f"loop-{index}"), now=now, last_run=last_run)
        sandbox.run("loop.sh")
        outcome = (len(read_lines(sandbox.session_calls)), sandbox.last_run())
        if outcome != (expected_runs, expected_date):
            failures.append(f"{name}: got {outcome}, expected {(expected_runs, expected_date)}")
    return failures


def guard_scenarios(workspace_root: str) -> list[str]:
    """Check the loop refuses a bad run time and a second instance.

    Args:
        workspace_root: A temporary directory for the sandboxes.

    Returns:
        A failure line per check that did not hold.
    """
    failures = []
    sandbox = Sandbox(os.path.join(workspace_root, "bad-time"), now="09:00", last_run=YESTERDAY)
    result = sandbox.run("loop.sh", CODE_IMPROVEMENT_RUN_AT="7:15")
    if result.returncode == 0 or read_lines(sandbox.session_calls):
        failures.append("an unpadded run time is rejected before anything runs")

    sandbox = Sandbox(os.path.join(workspace_root, "second-loop"), now="09:00", last_run=YESTERDAY)
    holder = sandbox.hold_loop_lock()
    try:
        sandbox.run("loop.sh")
    finally:
        holder.kill()
    if read_lines(sandbox.session_calls):
        failures.append("a second loop exits while the first is alive")

    sandbox = Sandbox(os.path.join(workspace_root, "stale-lock"), now="09:00", last_run=YESTERDAY)
    os.makedirs(os.path.join(sandbox.state, "loop.lock"))
    sandbox.run("loop.sh")
    if len(read_lines(sandbox.session_calls)) != 1:
        failures.append("a lock left by a dead loop is taken over")
    return failures


def watchdog_scenarios(workspace_root: str) -> list[str]:
    """Check when the watchdog alerts, and that it alerts once a day.

    Args:
        workspace_root: A temporary directory for the sandboxes.

    Returns:
        A failure line per scenario that did not match.
    """
    scenarios = {
        "a dead loop alerts": ("09:00", TODAY, False, ["not running"]),
        "a live loop that ran today is quiet": ("09:00", TODAY, True, []),
        "a live loop with no run long after the run time alerts": ("09:00", YESTERDAY, True, ["has not started"]),
        "a live loop within the grace period is quiet": ("07:00", YESTERDAY, True, []),
    }
    failures = []
    for index, (name, (now, last_run, loop_alive, expected)) in enumerate(scenarios.items()):
        sandbox = Sandbox(os.path.join(workspace_root, f"watchdog-{index}"), now=now, last_run=last_run)
        holder = sandbox.hold_loop_lock() if loop_alive else None
        try:
            sandbox.run("check-loop.sh")
            sandbox.run("check-loop.sh")
        finally:
            if holder:
                holder.kill()
        alerts = read_lines(sandbox.alerts)
        matched = len(alerts) == len(expected) and all(
            fragment in alert for fragment, alert in zip(expected, alerts)
        )
        if not matched:
            failures.append(f"{name} (twice → once): got {alerts}")
    return failures


def main() -> int:
    """Run every scenario.

    Returns:
        The process exit code: 0 when every scenario matches.
    """
    with tempfile.TemporaryDirectory() as workspace_root:
        failures = (
            loop_scenarios(workspace_root)
            + guard_scenarios(workspace_root)
            + watchdog_scenarios(workspace_root)
        )
    for failure in failures:
        print(f"FAIL  {failure}")
    if not failures:
        print("PASS  loop.sh scheduling and guards, check-loop.sh alerts")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
