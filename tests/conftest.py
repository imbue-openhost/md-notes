import time

import pytest
from openhost_test_harness import OpenhostStack


def _wait_healthy(stack: OpenhostStack, timeout: float = 60) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = stack.owner_session.get(f"{stack.url}/health", timeout=2)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError(f"App did not become healthy at {stack.url}/health within {timeout}s")


@pytest.fixture(scope="session")
def stack():
    with OpenhostStack() as s:
        _wait_healthy(s)
        yield s
