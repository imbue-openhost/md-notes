"""Unit tests for vault federation: share CRUD, invite URLs, and the secret-authenticated peer API.

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
from server.core.federation import RemoteVaultError
from server.core.federation import normalize_source_url
from server.core.federation import parse_peer_vault_info
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
    share = create_share(client, permission="write")
    assert share["vault_name"] == "notes"
    assert share["share_name"] == "bob"
    assert share["permission"] == "write"
    assert share["invite_url"].startswith("https://md-notes.alice.example.com/federation/connect?")
    assert f"secret={share['secret']}" in share["invite_url"]
    assert "vault=notes" in share["invite_url"]

    listed = client.get("/api/federation/shares", headers=OWNER).json()
    assert [s["secret"] for s in listed] == [share["secret"]]

    assert client.delete(f"/api/federation/shares/{share['secret']}", headers=OWNER).status_code == 200
    assert client.get("/api/federation/shares", headers=OWNER).json() == []
    # Revoked secret no longer works on the peer API.
    assert client.get("/api/federation/peer/vault", params={"secret": share["secret"]}).status_code == 401


def test_peer_vault_info(client: TestClient) -> None:
    make_vault(client)
    share = create_share(client)
    r = client.get("/api/federation/peer/vault", params={"secret": share["secret"]})
    assert r.status_code == 200
    assert r.json() == {"vault_name": "notes", "permission": "read", "app": "md-notes", "api_version": 1}
    assert client.get("/api/federation/peer/vault", params={"secret": "wrong"}).status_code == 401


def test_peer_docs_read(client: TestClient) -> None:
    make_vault(client)
    share = create_share(client)
    tree = client.get("/api/federation/peer/docs", params={"secret": share["secret"]}).json()
    assert [e["path"] for e in tree] == ["hello.md"]
    content = client.get("/api/federation/peer/docs/file", params={"secret": share["secret"], "path": "hello.md"})
    assert content.status_code == 200
    assert content.text == "# hi\n"


def test_peer_path_traversal_blocked(client: TestClient) -> None:
    make_vault(client)
    share = create_share(client)
    r = client.get(
        "/api/federation/peer/docs/file",
        params={"secret": share["secret"], "path": "../../../etc/passwd"},
    )
    assert r.status_code == 403


def test_read_share_cannot_write(client: TestClient) -> None:
    make_vault(client)
    share = create_share(client, permission="read")
    r = client.post(
        "/api/federation/peer/docs/file",
        params={"secret": share["secret"], "path": "new.md"},
        json={"content": "x", "type": "file"},
    )
    assert r.status_code == 403
    r = client.patch(
        "/api/federation/peer/docs/file",
        params={"secret": share["secret"], "path": "hello.md"},
        json={"newPath": "moved.md"},
    )
    assert r.status_code == 403
    r = client.delete("/api/federation/peer/docs/file", params={"secret": share["secret"], "path": "hello.md"})
    assert r.status_code == 403


def test_write_share_full_crud(client: TestClient) -> None:
    make_vault(client)
    share = create_share(client, permission="write", name="carol")
    secret = share["secret"]
    r = client.post(
        "/api/federation/peer/docs/file",
        params={"secret": secret, "path": "new.md"},
        json={"content": "new content", "type": "file"},
    )
    assert r.status_code == 201, r.text
    assert client.get("/api/federation/peer/docs/file", params={"secret": secret, "path": "new.md"}).text == (
        "new content"
    )
    r = client.patch(
        "/api/federation/peer/docs/file",
        params={"secret": secret, "path": "new.md"},
        json={"newPath": "renamed.md"},
    )
    assert r.status_code == 200
    r = client.delete("/api/federation/peer/docs/file", params={"secret": secret, "path": "renamed.md"})
    assert r.status_code == 200
    tree = client.get("/api/federation/peer/docs", params={"secret": secret}).json()
    assert [e["path"] for e in tree] == ["hello.md"]


def test_remotes_require_owner(client: TestClient) -> None:
    assert client.get("/api/federation/remotes").status_code == 401


def test_list_remotes_empty(client: TestClient) -> None:
    assert client.get("/api/federation/remotes", headers=OWNER).json() == []


def test_peer_info_handshake() -> None:
    good = {"app": "md-notes", "api_version": 1, "vault_name": "notes", "permission": "read"}
    info = parse_peer_vault_info(good, "https://a.example.com")
    assert info.vault_name == "notes"
    assert info.permission == "read"

    with pytest.raises(RemoteVaultError, match="not an md-notes instance"):
        parse_peer_vault_info({**good, "app": "other-app"}, "https://a.example.com")
    with pytest.raises(RemoteVaultError, match="version"):
        parse_peer_vault_info({**good, "api_version": 2}, "https://a.example.com")
    with pytest.raises(RemoteVaultError, match="invalid"):
        parse_peer_vault_info({**good, "permission": "admin"}, "https://a.example.com")
    with pytest.raises(RemoteVaultError, match="invalid"):
        parse_peer_vault_info("nonsense", "https://a.example.com")


def test_normalize_source_url() -> None:
    assert normalize_source_url("md-notes.alice.example.com") == "https://md-notes.alice.example.com"
    assert normalize_source_url("https://md-notes.alice.example.com/") == "https://md-notes.alice.example.com"
    assert normalize_source_url("http://md-notes.harness.localhost:8123") == "http://md-notes.harness.localhost:8123"
