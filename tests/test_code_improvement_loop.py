#!/usr/bin/env python3
"""Check the resident code-improvement loop, its refresh step and its watchdog decide correctly.

The loop owns the daily schedule and the watchdog is the only thing that notices when it
stops. Each failure here means a day with no run, a duplicate multi-hour run, or an alert
that cries wolf — and nobody is watching either script when it happens.

Run: python3 tests/test_code_improvement_loop.py
"""

import json
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
    """A state dir, a pinned clock, and stubs for session.sh, refresh-config.sh and osascript."""

    def __init__(self, workspace: str, *, now: str, last_run: str | None) -> None:
        """Lay out the sandbox.

        Args:
            workspace: A directory that does not exist yet.
            now: The pinned time of day, HH:MM.
            last_run: The recorded last run date, or None for a first start.
        """
        self.workspace = workspace
        self.state = os.path.join(workspace, "state")
        os.makedirs(self.state)
        bin_dir = os.path.join(workspace, "bin")
        os.makedirs(bin_dir)
        self.session_calls = os.path.join(workspace, "session.calls")
        self.alerts = os.path.join(workspace, "alerts")
        self.session = os.path.join(workspace, "session.sh")
        write_executable(path=self.session, body=f'echo ran >> "{self.session_calls}"\n')
        self.step_order = os.path.join(workspace, "step-order")
        self.ordered_session = os.path.join(workspace, "ordered-session.sh")
        write_executable(path=self.ordered_session, body=f'echo session >> "{self.step_order}"\n')
        self.refresh = os.path.join(workspace, "refresh.sh")
        write_executable(path=self.refresh, body=f'echo refresh >> "{self.step_order}"\n')
        self.failing_refresh = os.path.join(workspace, "failing-refresh.sh")
        write_executable(
            path=self.failing_refresh, body=f'echo refresh >> "{self.step_order}"\nexit 3\n'
        )
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
            "CODE_IMPROVEMENT_REFRESH": self.refresh,
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
    accepted_bad_time = result.returncode == 0 or bool(read_lines(sandbox.session_calls))
    if accepted_bad_time:
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


def refresh_order_scenarios(workspace_root: str) -> list[str]:
    """Check the loop refreshes before the session, and a failed refresh only alerts.

    Args:
        workspace_root: A temporary directory for the sandboxes.

    Returns:
        A failure line per check that did not hold.
    """
    failures = []
    sandbox = Sandbox(os.path.join(workspace_root, "refresh-due"), now="09:00", last_run=YESTERDAY)
    sandbox.run("loop.sh", CODE_IMPROVEMENT_SESSION=sandbox.ordered_session)
    order = read_lines(sandbox.step_order)
    if order != ["refresh", "session"]:
        failures.append(f"a due run refreshes first, then runs once: got {order}")

    sandbox = Sandbox(os.path.join(workspace_root, "refresh-idle"), now="06:42", last_run=YESTERDAY)
    sandbox.run("loop.sh")
    order = read_lines(sandbox.step_order)
    if order:
        failures.append(f"no refresh when no run is due: got {order}")

    sandbox = Sandbox(os.path.join(workspace_root, "refresh-fail"), now="09:00", last_run=YESTERDAY)
    sandbox.run(
        "loop.sh",
        CODE_IMPROVEMENT_REFRESH=sandbox.failing_refresh,
        CODE_IMPROVEMENT_SESSION=sandbox.ordered_session,
    )
    order = read_lines(sandbox.step_order)
    alerts = read_lines(sandbox.alerts)
    if order != ["refresh", "session"] or not any("refresh" in alert for alert in alerts):
        failures.append(f"a failed refresh alerts and the run goes ahead: {order}, {alerts}")
    return failures


def git(*args: str, cwd: str) -> str:
    """Run git in a directory.

    Args:
        *args: The git arguments.
        cwd: The directory to run in.

    Returns:
        Its trimmed output.
    """
    identity = ["-c", "user.name=test", "-c", "user.email=test@example.com"]
    return subprocess.run(
        ["git", *identity, *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout.strip()


class RefreshSandbox:
    """A clone one commit behind its origin, a plugin list, and a stub claude CLI."""

    def __init__(self, workspace: str, *, claude_exit: int = 0) -> None:
        """Lay out the sandbox.

        Args:
            workspace: A directory that does not exist yet.
            claude_exit: The exit code of every stubbed claude call.
        """
        os.makedirs(workspace)
        self.project = os.path.realpath(os.path.join(workspace, "project"))
        os.makedirs(self.project)
        origin = os.path.join(workspace, "origin.git")
        git("init", "-q", "--bare", "-b", "main", origin, cwd=workspace)
        self.checkout = os.path.join(workspace, "checkout")
        git("clone", "-q", origin, self.checkout, cwd=workspace)
        git("checkout", "-q", "-B", "main", cwd=self.checkout)
        git("commit", "-q", "--allow-empty", "-m", "old", cwd=self.checkout)
        git("push", "-q", "origin", "main", cwd=self.checkout)
        self.old_head = git("rev-parse", "HEAD", cwd=self.checkout)
        ahead = os.path.join(workspace, "ahead")
        git("clone", "-q", origin, ahead, cwd=workspace)
        git("commit", "-q", "--allow-empty", "-m", "new", cwd=ahead)
        git("push", "-q", "origin", "main", cwd=ahead)
        self.new_head = git("rev-parse", "HEAD", cwd=ahead)

        self.claude_calls = os.path.join(workspace, "claude.calls")
        bin_dir = os.path.join(workspace, "bin")
        os.makedirs(bin_dir)
        write_executable(
            path=os.path.join(bin_dir, "claude"),
            body=(
                "#!/usr/bin/env bash\n"
                f'echo "$(pwd -P) $*" >> "{self.claude_calls}"\n'
                f"exit {claude_exit}\n"
            ),
        )
        installed = os.path.join(workspace, "installed_plugins.json")
        with open(installed, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "plugins": {
                        "mods@yaniv-claude-config": [{"scope": "user", "version": "1"}],
                        "pr-workflows@yaniv-claude-config": [
                            {"scope": "project", "version": "1", "projectPath": self.project}
                        ],
                        "other@somewhere-else": [{"scope": "user", "version": "1"}],
                    }
                },
                handle,
            )
        self.home = os.path.realpath(workspace)
        self.env = {
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "HOME": self.home,
            "CODE_IMPROVEMENT_STATE_DIR": os.path.join(workspace, "state"),
            "CODE_IMPROVEMENT_CONFIG_CHECKOUT": self.checkout,
            "CODE_IMPROVEMENT_INSTALLED_PLUGINS": installed,
        }

    def run(self) -> subprocess.CompletedProcess[str]:
        """Run refresh-config.sh against this sandbox.

        Returns:
            The finished process.
        """
        return subprocess.run(
            ["bash", os.path.join(SCRIPTS, "refresh-config.sh")],
            cwd=self.home,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

    def head(self) -> str:
        """Return the checkout's current commit."""
        return git("rev-parse", "HEAD", cwd=self.checkout)


def refresh_scenarios(workspace_root: str) -> list[str]:
    """Check what refresh-config.sh pulls and updates, and that it survives a failure.

    Args:
        workspace_root: A temporary directory for the sandboxes.

    Returns:
        A failure line per check that did not hold.
    """
    failures = []
    sandbox = RefreshSandbox(os.path.join(workspace_root, "refresh-ok"))
    result = sandbox.run()
    if result.returncode != 0 or sandbox.head() != sandbox.new_head:
        failures.append(f"a checkout on main fast-forwards: {result.returncode}, {result.stderr}")
    expected_calls = [
        f"{sandbox.home} plugin marketplace update yaniv-claude-config",
        f"{sandbox.home} plugin update mods@yaniv-claude-config --scope user",
        f"{sandbox.project} plugin update pr-workflows@yaniv-claude-config --scope project",
    ]
    calls = read_lines(sandbox.claude_calls)
    if calls != expected_calls:
        failures.append(f"every install updates, at its scope and path: got {calls}")

    sandbox = RefreshSandbox(os.path.join(workspace_root, "refresh-branch"))
    git("checkout", "-q", "-b", "feature", cwd=sandbox.checkout)
    result = sandbox.run()
    if sandbox.head() != sandbox.old_head or result.returncode == 0:
        failures.append("a checkout on another branch is left alone, and reported")
    if len(read_lines(sandbox.claude_calls)) != len(expected_calls):
        failures.append("plugins still update when the checkout is on another branch")

    sandbox = RefreshSandbox(os.path.join(workspace_root, "refresh-claude-down"), claude_exit=1)
    result = sandbox.run()
    if result.returncode == 0 or len(read_lines(sandbox.claude_calls)) != len(expected_calls):
        failures.append("a failed plugin update is reported, and the others are still tried")
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
            + refresh_order_scenarios(workspace_root)
            + refresh_scenarios(workspace_root)
        )
    for failure in failures:
        print(f"FAIL  {failure}")
    if not failures:
        print("PASS  loop.sh scheduling and guards, check-loop.sh alerts, refresh-config.sh")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
