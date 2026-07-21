"""Unit tests for vault federation: shares, secret access to the unified vault API, connections.

Run with:  uv run pytest tests/test_federation.py -v
"""

import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server" / "src"))

from litestar.testing import TestClient

from server.core.config import Config
from server.web.app import create_app

OWNER = {"x-openhost-is-owner": "true"}


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with tempfile.TemporaryDirectory() as tmp:
        config = Config(
            vault_path=Path(tmp) / "vault",
            db_path=Path(tmp) / "main.db",
            app_origin="https://md-notes.alice.example.com",
        )
        with TestClient(app=create_app(config)) as test_client:
            yield test_client


def make_vault(client: TestClient, name: str = "notes") -> None:
    assert client.post("/api/vaults", json={"name": name}, headers=OWNER).status_code in (200, 201)
    r = client.post(
        f"/api/docs/{name}/file",
        params={"path": "hello.md"},
        json={"content": "# hi\n", "type": "file"},
        headers=OWNER,
    )
    assert r.status_code == 201, r.text


def create_share(client: TestClient, permission: str = "read", name: str = "bob") -> dict:
    r = client.post(
        "/api/federation/shares",
        json={"vaultName": "notes", "name": name, "permission": permission},
        headers=OWNER,
    )
    assert r.status_code == 201, r.text
    return r.json()


# ── Shares ────────────────────────────────────────────────────────────────


def test_share_requires_owner(client: TestClient) -> None:
    r = client.post("/api/federation/shares", json={"vaultName": "notes", "name": "bob"})
    assert r.status_code == 401


def test_share_missing_vault_404(client: TestClient) -> None:
    r = client.post("/api/federation/shares", json={"vaultName": "nope", "name": "bob"}, headers=OWNER)
    assert r.status_code == 404


def test_share_requires_name(client: TestClient) -> None:
    make_vault(client)
    r = client.post("/api/federation/shares", json={"vaultName": "notes", "name": "  "}, headers=OWNER)
    assert r.status_code == 400


def test_create_list_revoke_share(client: TestClient) -> None:
    make_vault(client)
    share = create_share(client, permission="comment")
    assert share["vault_name"] == "notes"
    assert share["share_name"] == "bob"
    assert share["permission"] == "comment"
    assert share["invite_url"].startswith("https://md-notes.alice.example.com/federation/connect?")
    assert f"secret={share['secret']}" in share["invite_url"]
    assert "vault=notes" in share["invite_url"]

    listed = client.get("/api/federation/shares", headers=OWNER).json()
    assert [s["secret"] for s in listed] == [share["secret"]]

    assert client.delete(f"/api/federation/shares/{share['secret']}", headers=OWNER).status_code == 200
    assert client.get("/api/federation/shares", headers=OWNER).json() == []
    # Revoked secret no longer works anywhere.
    assert client.get("/api/federation/share-info", params={"secret": share["secret"]}).status_code == 401
    assert client.get("/api/docs/notes", params={"secret": share["secret"]}).status_code == 401


def test_share_info_handshake(client: TestClient) -> None:
    make_vault(client)
    share = create_share(client)
    r = client.get("/api/federation/share-info", params={"secret": share["secret"]})
    assert r.status_code == 200
    assert r.json() == {"app": "md-notes", "api_version": 1, "vault": "notes", "permission": "read"}
    assert client.get("/api/federation/share-info", params={"secret": "wrong"}).status_code == 401


# ── Secret access to the unified vault API ────────────────────────────────


def test_docs_require_auth(client: TestClient) -> None:
    make_vault(client)
    assert client.get("/api/docs/notes").status_code == 401
    assert client.get("/api/docs/notes/file", params={"path": "hello.md"}).status_code == 401


def test_read_secret_reads_but_cannot_write(client: TestClient) -> None:
    make_vault(client)
    secret = create_share(client, permission="read")["secret"]
    tree = client.get("/api/docs/notes", params={"secret": secret})
    assert tree.status_code == 200
    assert [e["path"] for e in tree.json()] == ["hello.md"]
    assert client.get("/api/docs/notes/file", params={"secret": secret, "path": "hello.md"}).text == "# hi\n"

    body = {"content": "x", "type": "file"}
    assert (
        client.post("/api/docs/notes/file", params={"secret": secret, "path": "new.md"}, json=body).status_code == 401
    )
    assert (
        client.patch(
            "/api/docs/notes/file", params={"secret": secret, "path": "hello.md"}, json={"newPath": "b.md"}
        ).status_code
        == 401
    )
    assert client.delete("/api/docs/notes/file", params={"secret": secret, "path": "hello.md"}).status_code == 401


def test_secret_is_pinned_to_its_vault(client: TestClient) -> None:
    make_vault(client)
    make_vault(client, "other")
    secret = create_share(client, permission="write")["secret"]
    assert client.get("/api/docs/other", params={"secret": secret}).status_code == 401


def test_write_secret_full_crud(client: TestClient) -> None:
    make_vault(client)
    secret = create_share(client, permission="write", name="carol")["secret"]
    r = client.post(
        "/api/docs/notes/file",
        params={"secret": secret, "path": "new.md"},
        json={"content": "new content", "type": "file"},
    )
    assert r.status_code == 201, r.text
    assert client.get("/api/docs/notes/file", params={"secret": secret, "path": "new.md"}).text == "new content"
    assert (
        client.patch(
            "/api/docs/notes/file", params={"secret": secret, "path": "new.md"}, json={"newPath": "renamed.md"}
        ).status_code
        == 200
    )
    assert client.delete("/api/docs/notes/file", params={"secret": secret, "path": "renamed.md"}).status_code == 200
    tree = client.get("/api/docs/notes", params={"secret": secret}).json()
    assert [e["path"] for e in tree] == ["hello.md"]


def test_path_traversal_blocked_for_secrets(client: TestClient) -> None:
    make_vault(client)
    secret = create_share(client)["secret"]
    r = client.get("/api/docs/notes/file", params={"secret": secret, "path": "../../../etc/passwd"})
    assert r.status_code == 403


def test_comment_tier_can_comment_but_not_edit(client: TestClient) -> None:
    make_vault(client)
    secret = create_share(client, permission="comment")["secret"]
    read_secret = create_share(client, permission="read", name="reader")["secret"]

    # Valid anchors need the live server doc (see test_comments.py for comment mechanics); here we
    # only care that the comment tier is admitted past auth to domain validation (400, not 401).
    body = {"userId": "u1", "userName": "Bob", "text": "hi", "anchorStart": None, "anchorEnd": None}
    r = client.post("/api/docs/notes/comments", params={"path": "hello.md", "secret": secret}, json=body)
    assert r.status_code == 400, r.text
    assert "anchor" in r.text
    # ...but file writes stay closed to the comment tier.
    assert (
        client.post(
            "/api/docs/notes/file", params={"secret": secret, "path": "x.md"}, json={"content": "x", "type": "file"}
        ).status_code
        == 401
    )
    # Read tier can't comment at all.
    assert (
        client.post(
            "/api/docs/notes/comments", params={"path": "hello.md", "secret": read_secret}, json=body
        ).status_code
        == 401
    )


# ── Unified vault list and connections ────────────────────────────────────


def test_vault_list_merges_owned_and_connected(client: TestClient) -> None:
    make_vault(client)
    r = client.post(
        "/api/vaults/connections",
        json={"host": "https://md-notes.bob.example.com/", "vault": "shared", "secret": "s1", "permission": "comment"},
        headers=OWNER,
    )
    assert r.status_code == 201, r.text
    connected = r.json()
    assert connected["owned"] is False
    assert connected["host"] == "https://md-notes.bob.example.com"  # trailing slash stripped
    assert connected["vault"] == "shared"
    assert connected["name"] == "shared"
    assert connected["permission"] == "comment"

    vaults = client.get("/api/vaults", headers=OWNER).json()
    assert [(v["name"], v["owned"]) for v in vaults] == [("notes", True), ("shared", False)]
    owned = vaults[0]
    assert owned["host"] == "https://md-notes.alice.example.com"
    assert owned["vault"] == "notes"
    assert owned["permission"] == "write"
    assert owned["secret"] is None

    # Idempotent on host+secret.
    again = client.post(
        "/api/vaults/connections",
        json={"host": "https://md-notes.bob.example.com", "vault": "shared", "secret": "s1", "permission": "comment"},
        headers=OWNER,
    ).json()
    assert again["id"] == connected["id"]

    assert client.delete(f"/api/vaults/connections/{connected['id']}", headers=OWNER).status_code == 200
    assert [v["name"] for v in client.get("/api/vaults", headers=OWNER).json()] == ["notes"]


def test_connected_name_deduped_against_owned(client: TestClient) -> None:
    make_vault(client)
    r = client.post(
        "/api/vaults/connections",
        json={"host": "https://x.example.com", "vault": "notes", "secret": "s2", "permission": "read"},
        headers=OWNER,
    )
    assert r.json()["name"] == "notes (2)"


def test_connections_require_owner_and_validate(client: TestClient) -> None:
    assert client.get("/api/vaults").status_code == 401
    assert (
        client.post(
            "/api/vaults/connections",
            json={"host": "https://x.example.com", "vault": "v", "secret": "s", "permission": "read"},
        ).status_code
        == 401
    )
    bad = client.post(
        "/api/vaults/connections",
        json={"host": "ftp://x.example.com", "vault": "v", "secret": "s", "permission": "read"},
        headers=OWNER,
    )
    assert bad.status_code == 400
    bad = client.post(
        "/api/vaults/connections",
        json={"host": "https://x.example.com", "vault": "v", "secret": "s", "permission": "admin"},
        headers=OWNER,
    )
    assert bad.status_code == 400
