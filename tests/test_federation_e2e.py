"""Two-instance federation tests: instance A shares a vault, instance B connects to it.

Runs two full OpenHost stacks (two routers, two md-notes containers) side by side. Instance B's
server stores the remote-vault reference, and B's "browser" (requests + Playwright) talks directly
to instance A, exactly as in production.
"""

import time

import pytest
import requests
from openhost_test_harness import OpenhostStack
from playwright.sync_api import Page
from playwright.sync_api import expect

pytestmark = pytest.mark.containers

VAULT = "fedvault"
FILE = "shared.md"
FILE_CONTENT = "# Shared\n\nGreetings from instance A."


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


# Instance A is the shared session-scoped `stack` fixture from conftest (app name "md-notes").
# Instance B needs a distinct app name because podman container names are global.
@pytest.fixture(scope="module")
def stack_b():
    with OpenhostStack(app_name="md-notes-b", zone_name="zoneb") as s:
        _wait_healthy(s)
        yield s


@pytest.fixture(scope="module", autouse=True)
def _seed_vault(stack: OpenhostStack) -> None:
    s = stack.owner_session
    s.post(f"{stack.url}/api/vaults", json={"name": VAULT})
    r = s.post(f"{stack.url}/api/docs/{VAULT}/file?path={FILE}", json={"content": FILE_CONTENT})
    assert r.status_code == 201, r.text


def _create_share(stack: OpenhostStack, name: str, permission: str) -> dict:
    r = stack.owner_session.post(
        f"{stack.url}/api/federation/shares",
        json={"vaultName": VAULT, "name": name, "permission": permission},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_invite_url_shape(stack: OpenhostStack) -> None:
    share = _create_share(stack, "invite-shape", "read")
    # The invite is a link to the sharing instance itself.
    assert share["invite_url"].startswith(f"{stack.url}/federation/connect?")
    assert f"secret={share['secret']}" in share["invite_url"]
    assert f"vault={VAULT}" in share["invite_url"]
    stack.owner_session.delete(f"{stack.url}/api/federation/shares/{share['secret']}")


def test_peer_api_cross_origin(stack: OpenhostStack) -> None:
    """Simulates instance B's browser hitting instance A directly with the share secret."""
    write_share = _create_share(stack, "bob", "write")
    read_share = _create_share(stack, "carol", "read")
    base = f"{stack.url}/api/federation/peer"
    anon = requests.Session()  # no owner cookies — a foreign browser

    # metadata, including the app/version handshake
    r = anon.get(f"{base}/vault", params={"secret": write_share["secret"]})
    assert r.status_code == 200
    assert r.json() == {"vault_name": VAULT, "permission": "write", "app": "md-notes", "api_version": 1}
    assert anon.get(f"{base}/vault", params={"secret": "nope"}).status_code == 401

    # listing + reading
    r = anon.get(f"{base}/docs", params={"secret": read_share["secret"]})
    assert r.status_code == 200
    assert FILE in [e["path"] for e in r.json()]
    r = anon.get(f"{base}/docs/file", params={"secret": read_share["secret"], "path": FILE})
    assert r.text == FILE_CONTENT

    # writes: allowed for write shares, rejected for read shares
    r = anon.post(
        f"{base}/docs/file",
        params={"secret": write_share["secret"], "path": "from-b.md"},
        json={"content": "written by B", "type": "file"},
    )
    assert r.status_code == 201, r.text
    r = anon.post(
        f"{base}/docs/file",
        params={"secret": read_share["secret"], "path": "nope.md"},
        json={"content": "x", "type": "file"},
    )
    assert r.status_code == 403

    # revocation cuts access immediately
    assert stack.owner_session.delete(f"{stack.url}/api/federation/shares/{read_share['secret']}").status_code == 200
    assert anon.get(f"{base}/docs", params={"secret": read_share["secret"]}).status_code == 401

    stack.owner_session.delete(f"{stack.url}/api/federation/shares/{write_share['secret']}")
    anon.delete(f"{base}/docs/file", params={"secret": write_share["secret"], "path": "from-b.md"})


def test_connect_remote_vault(stack: OpenhostStack, stack_b: OpenhostStack) -> None:
    """Instance B stores a reference to A's vault, validating it server-to-server."""
    share = _create_share(stack, "instance-b", "write")
    sb = stack_b.owner_session

    r = sb.post(
        f"{stack_b.url}/api/federation/remotes",
        json={"sourceUrl": stack.url, "vaultName": VAULT, "secret": share["secret"], "name": ""},
    )
    assert r.status_code == 201, r.text
    remote = r.json()
    assert remote["vault_name"] == VAULT
    assert remote["name"] == VAULT
    assert remote["permission"] == "write"
    assert remote["source_url"] == stack.url

    # idempotent: same source+secret returns the existing record
    r = sb.post(
        f"{stack_b.url}/api/federation/remotes",
        json={"sourceUrl": stack.url, "vaultName": VAULT, "secret": share["secret"], "name": ""},
    )
    assert r.status_code == 201
    assert r.json()["id"] == remote["id"]

    listed = sb.get(f"{stack_b.url}/api/federation/remotes").json()
    assert [rv["id"] for rv in listed] == [remote["id"]]

    # a bogus secret is rejected during server-side validation
    r = sb.post(
        f"{stack_b.url}/api/federation/remotes",
        json={"sourceUrl": stack.url, "vaultName": VAULT, "secret": "bogus", "name": ""},
    )
    assert r.status_code == 502, r.text

    assert sb.delete(f"{stack_b.url}/api/federation/remotes/{remote['id']}").status_code == 200
    assert sb.get(f"{stack_b.url}/api/federation/remotes").json() == []
    stack.owner_session.delete(f"{stack.url}/api/federation/shares/{share['secret']}")


def _connect_and_open(stack: OpenhostStack, stack_b: OpenhostStack, page: Page, permission: str) -> dict:
    """Create a share on A, register it on B, and open the remote vault in B's UI."""
    share = _create_share(stack, f"pw-{permission}", permission)
    r = stack_b.owner_session.post(
        f"{stack_b.url}/api/federation/remotes",
        json={"sourceUrl": stack.url, "vaultName": VAULT, "secret": share["secret"], "name": f"remote-{permission}"},
    )
    assert r.status_code == 201, r.text
    remote = r.json()

    stack_b.playwright_login(page)
    page.goto(stack_b.url)
    page.locator(".vault-picker-item-name", has_text=remote["name"]).click()
    page.locator(f'.sidebar-item[data-type="file"][data-path="{FILE}"]').click()
    page.wait_for_selector(".cm-editor", timeout=15_000)
    page.wait_for_timeout(1500)
    return {"share": share, "remote": remote}


def test_invite_landing_page(stack: OpenhostStack, page: Page) -> None:
    """Opening the invite link directly shows an informational page on the sharing instance."""
    share = _create_share(stack, "landing", "read")
    page.goto(share["invite_url"])
    expect(page.locator(".vault-picker-title")).to_contain_text("Shared vault invite")
    expect(page.locator(".vault-picker-card")).to_contain_text(VAULT)
    expect(page.locator(".vault-picker-card")).to_contain_text("view only")
    stack.owner_session.delete(f"{stack.url}/api/federation/shares/{share['secret']}")


def test_b_connects_by_pasting_invite_and_edits(stack: OpenhostStack, stack_b: OpenhostStack, page: Page) -> None:
    """The real user flow: B pastes A's invite link into their own vault picker."""
    share = _create_share(stack, "paste-ui", "write")

    stack_b.playwright_login(page)
    page.goto(stack_b.url)
    page.fill('input[placeholder^="Paste an invite link"]', share["invite_url"])
    page.get_by_role("button", name="Connect", exact=True).click()
    page.locator(f'.sidebar-item[data-type="file"][data-path="{FILE}"]').click()
    page.wait_for_selector(".cm-editor", timeout=15_000)
    page.wait_for_timeout(1500)

    content = page.locator(".cm-content")
    expect(content).to_contain_text("Greetings from instance A.")

    remotes = stack_b.owner_session.get(f"{stack_b.url}/api/federation/remotes").json()
    assert [rv["vault_name"] for rv in remotes] == [VAULT]
    stack_b.owner_session.delete(f"{stack_b.url}/api/federation/remotes/{remotes[0]['id']}")
    stack.owner_session.delete(f"{stack.url}/api/federation/shares/{share['secret']}")


def test_b_edits_a_vault_via_ui(stack: OpenhostStack, stack_b: OpenhostStack, page: Page) -> None:
    ctx = _connect_and_open(stack, stack_b, page, "write")
    content = page.locator(".cm-content")
    expect(content).to_contain_text("Greetings from instance A.")

    content.click()
    page.keyboard.press("Escape")
    page.keyboard.type("G")
    page.keyboard.type("o")
    page.keyboard.type("EDITED_FROM_B")
    page.keyboard.press("Escape")
    expect(content).to_contain_text("EDITED_FROM_B")

    # The CRDT room on A debounce-saves within ~10s; the edit must land in A's own .md file.
    deadline = time.time() + 30
    while time.time() < deadline:
        body = stack.owner_session.get(f"{stack.url}/api/docs/{VAULT}/file", params={"path": FILE}).text
        if "EDITED_FROM_B" in body:
            break
        time.sleep(2)
    else:
        raise AssertionError("Edit from instance B never reached instance A's markdown file")

    stack_b.owner_session.delete(f"{stack_b.url}/api/federation/remotes/{ctx['remote']['id']}")
    stack.owner_session.delete(f"{stack.url}/api/federation/shares/{ctx['share']['secret']}")


def test_readonly_remote_vault_ui(stack: OpenhostStack, stack_b: OpenhostStack, page: Page) -> None:
    ctx = _connect_and_open(stack, stack_b, page, "read")
    content = page.locator(".cm-content")
    expect(content).to_contain_text("Greetings from instance A.")
    # CodeMirror readOnly + editable(false) renders a non-editable content element.
    assert content.get_attribute("contenteditable") == "false"
    before = content.inner_text()
    content.click()
    page.keyboard.type("SHOULD_NOT_APPEAR")
    page.wait_for_timeout(500)
    assert "SHOULD_NOT_APPEAR" not in content.inner_text()
    assert content.inner_text() == before

    stack_b.owner_session.delete(f"{stack_b.url}/api/federation/remotes/{ctx['remote']['id']}")
    stack.owner_session.delete(f"{stack.url}/api/federation/shares/{ctx['share']['secret']}")
