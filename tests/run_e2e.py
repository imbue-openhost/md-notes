"""End-to-end test runner.

Builds the app's container image with rootless podman, starts a container,
launches the mock OpenHost router (tests/mock_router.py) in front of it, then
runs the playwright suite against the router URL.

Usage:
    python tests/run_e2e.py                # build, run tests, tear down
    python tests/run_e2e.py --no-rebuild   # reuse existing image
    python tests/run_e2e.py --keep         # leave container/router running after tests
"""

import argparse
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IMAGE_NAME = "md-notes-test"
CONTAINER_NAME = "md-notes-test-container"
CONTAINER_PORT = 8080  # exposed by Dockerfile
HOST_CONTAINER_PORT = 18080  # podman host-side port
ROUTER_PORT = 9000


def run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, check=True, text=True, **kwargs)  # type: ignore[arg-type]


def build_image() -> None:
    run(["podman", "build", "-t", IMAGE_NAME, str(PROJECT_ROOT)])


def stop_container() -> None:
    subprocess.run(
        ["podman", "rm", "-f", CONTAINER_NAME],
        stderr=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
    )


def start_container(data_dir: Path) -> None:
    sqlite_dir = data_dir / "sqlite"
    sqlite_dir.mkdir(parents=True, exist_ok=True)

    stop_container()
    run(
        [
            "podman",
            "run",
            "-d",
            "--name",
            CONTAINER_NAME,
            "-p",
            f"{HOST_CONTAINER_PORT}:{CONTAINER_PORT}",
            "-v",
            f"{data_dir}:/data/app_data/md-notes:Z",
            "-e",
            "OPENHOST_APP_DATA_DIR=/data/app_data/md-notes",
            "-e",
            "OPENHOST_SQLITE_MAIN=/data/app_data/md-notes/sqlite/main.db",
            IMAGE_NAME,
        ]
    )


def wait_for(url: str, timeout: float = 30.0, label: str = "service") -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, headers={"X-OpenHost-Is-Owner": "true"})
            with urllib.request.urlopen(req, timeout=1) as resp:
                if resp.status < 500:
                    print(f"{label} ready at {url}")
                    return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f"{label} did not become ready at {url} within {timeout}s")


def start_router() -> subprocess.Popen[bytes]:
    env = {
        **os.environ,
        "UPSTREAM_HOST": "localhost",
        "UPSTREAM_PORT": str(HOST_CONTAINER_PORT),
        "ROUTER_PORT": str(ROUTER_PORT),
    }
    venv_python = PROJECT_ROOT / ".venv" / "bin" / "python3"
    proc = subprocess.Popen(
        [str(venv_python), str(PROJECT_ROOT / "tests" / "mock_router.py")],
        env=env,
    )
    return proc


def run_playwright(extra_args: list[str]) -> int:
    env = {
        **os.environ,
        "PLAYWRIGHT_BASE_URL": f"http://localhost:{ROUTER_PORT}",
    }
    proc = subprocess.run(
        ["npx", "playwright", "test", *extra_args],
        cwd=PROJECT_ROOT / "frontend",
        env=env,
    )
    return proc.returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-rebuild", action="store_true", help="Reuse existing image")
    parser.add_argument("--keep", action="store_true", help="Keep container and router running after tests")
    parser.add_argument("--skip-tests", action="store_true", help="Just start the env, do not run tests")
    parser.add_argument("playwright_args", nargs="*", help="Extra args forwarded to `playwright test`")
    args = parser.parse_args()

    if not args.no_rebuild:
        build_image()

    data_dir = Path(tempfile.mkdtemp(prefix="md-notes-test-"))
    print(f"Data dir: {data_dir}")

    router_proc: subprocess.Popen[bytes] | None = None
    rc = 0
    try:
        start_container(data_dir)
        wait_for(f"http://localhost:{HOST_CONTAINER_PORT}/health", label="container")

        router_proc = start_router()
        wait_for(f"http://localhost:{ROUTER_PORT}/health", label="router")

        if args.skip_tests:
            print(f"Stack ready. Router: http://localhost:{ROUTER_PORT}")
            print("Press Ctrl-C to tear down.")
            try:
                signal.pause()
            except KeyboardInterrupt:
                pass
            return 0

        rc = run_playwright(args.playwright_args)

        if args.keep:
            print(f"Tests done (rc={rc}). Stack is still running:")
            print(f"  Container: http://localhost:{HOST_CONTAINER_PORT}")
            print(f"  Router:    http://localhost:{ROUTER_PORT}")
            print("Press Ctrl-C to tear down.")
            try:
                signal.pause()
            except KeyboardInterrupt:
                pass

    finally:
        if router_proc and not args.keep:
            router_proc.terminate()
            try:
                router_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                router_proc.kill()
        if not args.keep:
            stop_container()
            shutil.rmtree(data_dir, ignore_errors=True)

    return rc


if __name__ == "__main__":
    sys.exit(main())
