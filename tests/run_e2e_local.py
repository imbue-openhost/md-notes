"""Local end-to-end test runner (no container build).

Starts the backend, vite dev server, and mock router as local processes,
then runs the Playwright suite. Faster iteration than run_e2e.py (which
builds a container image first).

Usage:
    uv run python tests/run_e2e_local.py                       # run all e2e tests
    uv run python tests/run_e2e_local.py vim-easyclip           # run one spec
    uv run python tests/run_e2e_local.py --keep                 # leave stack running
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
BACKEND_PORT = 8000
VITE_PORT = 5173
ROUTER_PORT = 9000


def wait_for(url: str, timeout: float = 30.0, label: str = "service", headers: dict[str, str] | None = None) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=1) as resp:
                if resp.status < 500:
                    print(f"  {label} ready")
                    return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f"{label} did not become ready at {url} within {timeout}s")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="Leave stack running after tests")
    parser.add_argument("playwright_args", nargs="*", help="Extra args forwarded to `playwright test`")
    args = parser.parse_args()

    data_dir = Path(tempfile.mkdtemp(prefix="md-notes-e2e-local-"))
    (data_dir / "sqlite").mkdir()
    print(f"Data dir: {data_dir}")

    procs: list[subprocess.Popen[bytes]] = []

    try:
        # Backend
        procs.append(
            subprocess.Popen(
                ["uv", "run", "python", "-m", "server"],
                cwd=PROJECT_ROOT,
                env={
                    **os.environ,
                    "OPENHOST_APP_DATA_DIR": str(data_dir),
                    "OPENHOST_SQLITE_MAIN": str(data_dir / "sqlite" / "main.db"),
                },
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        wait_for(
            f"http://localhost:{BACKEND_PORT}/api/vaults",
            label="backend",
            headers={"X-OpenHost-Is-Owner": "true"},
        )

        # Vite dev server
        procs.append(
            subprocess.Popen(
                ["node_modules/.bin/vite", "--port", str(VITE_PORT)],
                cwd=PROJECT_ROOT / "frontend",
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        wait_for(f"http://localhost:{VITE_PORT}/", label="vite")

        # Mock router (injects auth header)
        procs.append(
            subprocess.Popen(
                ["uv", "run", "python", str(PROJECT_ROOT / "tests" / "mock_router.py")],
                cwd=PROJECT_ROOT,
                env={
                    **os.environ,
                    "UPSTREAM_PORT": str(VITE_PORT),
                    "ROUTER_PORT": str(ROUTER_PORT),
                },
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        )
        wait_for(f"http://localhost:{ROUTER_PORT}/api/vaults", label="router")

        print(f"Stack ready at http://localhost:{ROUTER_PORT}")

        # Run Playwright
        default_args = ["--grep-invert", "list rendering"]
        result = subprocess.run(
            ["node_modules/.bin/playwright", "test", *default_args, *args.playwright_args],
            cwd=PROJECT_ROOT / "frontend",
            env={**os.environ, "PLAYWRIGHT_BASE_URL": f"http://localhost:{ROUTER_PORT}"},
        )
        rc = result.returncode

        if args.keep:
            print(f"\nTests done (rc={rc}). Stack still running at http://localhost:{ROUTER_PORT}")
            print("Press Ctrl-C to tear down.")
            try:
                signal.pause()
            except KeyboardInterrupt:
                pass

        return rc

    finally:
        for proc in reversed(procs):
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
