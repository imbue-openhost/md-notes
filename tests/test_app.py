"""API integration tests — exercised through the real OpenHost router."""

import pytest
from openhost_test_harness import OpenhostStack

pytestmark = pytest.mark.containers


def test_health(stack: OpenhostStack) -> None:
    r = stack.owner_session.get(f"{stack.url}/health")
    assert r.status_code == 200
    assert r.text == "ok"


def test_api_health(stack: OpenhostStack) -> None:
    r = stack.owner_session.get(f"{stack.url}/api/health")
    assert r.status_code == 200


def test_frontend_served(stack: OpenhostStack) -> None:
    r = stack.owner_session.get(f"{stack.url}/")
    assert r.status_code == 200
    assert "<!doctype html>" in r.text.lower()


def test_vault_lifecycle(stack: OpenhostStack) -> None:
    s = stack.owner_session
    base = stack.url

    r = s.post(f"{base}/api/vaults", json={"name": "lifecycle-test"})
    assert r.status_code == 201

    r = s.get(f"{base}/api/vaults")
    assert r.status_code == 200
    names = [v["name"] for v in r.json()]
    assert "lifecycle-test" in names

    r = s.patch(f"{base}/api/vaults/lifecycle-test", json={"name": "lifecycle-renamed"})
    assert r.status_code == 200

    r = s.get(f"{base}/api/vaults")
    names = [v["name"] for v in r.json()]
    assert "lifecycle-renamed" in names
    assert "lifecycle-test" not in names

    r = s.delete(f"{base}/api/vaults/lifecycle-renamed")
    assert r.status_code == 200

    r = s.get(f"{base}/api/vaults")
    names = [v["name"] for v in r.json()]
    assert "lifecycle-renamed" not in names


def test_file_crud(stack: OpenhostStack) -> None:
    s = stack.owner_session
    base = stack.url
    vault = "file-test"

    s.post(f"{base}/api/vaults", json={"name": vault})

    r = s.post(f"{base}/api/docs/{vault}/file?path=hello.md", json={"content": "# Hello"})
    assert r.status_code == 201

    r = s.get(f"{base}/api/docs/{vault}/file?path=hello.md")
    assert r.status_code == 200
    assert r.text == "# Hello"

    r = s.get(f"{base}/api/docs/{vault}/")
    assert r.status_code == 200
    names = [f["name"] for f in r.json()]
    assert "hello.md" in names

    r = s.patch(f"{base}/api/docs/{vault}/file?path=hello.md", json={"newPath": "renamed.md"})
    assert r.status_code == 200

    r = s.get(f"{base}/api/docs/{vault}/file?path=renamed.md")
    assert r.status_code == 200
    assert r.text == "# Hello"

    r = s.delete(f"{base}/api/docs/{vault}/file?path=renamed.md")
    assert r.status_code == 200

    s.delete(f"{base}/api/vaults/{vault}")


def test_path_traversal_blocked(stack: OpenhostStack) -> None:
    s = stack.owner_session
    base = stack.url
    vault = "traversal-test"

    s.post(f"{base}/api/vaults", json={"name": vault})

    r = s.get(f"{base}/api/docs/{vault}/file?path=../../etc/passwd")
    assert r.status_code in (400, 403, 404)

    s.delete(f"{base}/api/vaults/{vault}")


def test_vimrc_roundtrip(stack: OpenhostStack) -> None:
    s = stack.owner_session
    base = stack.url
    vimrc = "set number\nnmap j gj\n"

    r = s.put(f"{base}/api/settings/vimrc", json={"vimrc": vimrc})
    assert r.status_code == 200

    r = s.get(f"{base}/api/settings/vimrc")
    assert r.status_code == 200
    assert r.json()["vimrc"] == vimrc
