"""Browser-level tests — Playwright through the real OpenHost router."""

import pytest
from openhost_test_harness import OpenhostStack
from playwright.sync_api import Page
from playwright.sync_api import expect

pytestmark = pytest.mark.containers

VAULT = "editor-pw"
FILE = "test.md"


@pytest.fixture(scope="module", autouse=True)
def _setup_vault(stack: OpenhostStack) -> None:
    s = stack.owner_session
    s.post(f"{stack.url}/api/vaults", json={"name": VAULT})
    s.post(
        f"{stack.url}/api/docs/{VAULT}/file?path={FILE}",
        json={"content": "# Test Doc\n\nHello world."},
    )


def _open_file(stack: OpenhostStack, page: Page) -> None:
    stack.playwright_login(page)
    page.goto(stack.url)
    page.locator(".vault-picker-item-name", has_text=VAULT).click()
    page.locator(f'.sidebar-item[data-type="file"][data-path="{FILE}"]').click()
    page.wait_for_selector(".cm-editor", timeout=10_000)
    page.wait_for_timeout(1000)


def test_editor_loads(stack: OpenhostStack, page: Page) -> None:
    _open_file(stack, page)
    expect(page.locator(".cm-editor")).to_be_visible()
    expect(page.locator(".cm-content")).to_be_visible()


def test_vim_insert_mode(stack: OpenhostStack, page: Page) -> None:
    _open_file(stack, page)
    content = page.locator(".cm-content")
    content.click()
    page.keyboard.press("Escape")
    page.keyboard.type("i")
    page.keyboard.type("HARNESS_INPUT")
    page.keyboard.press("Escape")
    expect(content).to_contain_text("HARNESS_INPUT")


def test_file_tree_visible(stack: OpenhostStack, page: Page) -> None:
    _open_file(stack, page)
    sidebar = page.locator("#sidebar")
    expect(sidebar).to_be_visible()
    expect(sidebar).to_contain_text("test")


def test_yjs_sync_between_tabs(stack: OpenhostStack, page: Page) -> None:
    browser = page.context.browser
    assert browser is not None

    ctx1 = browser.new_context()
    ctx2 = browser.new_context()
    p1 = ctx1.new_page()
    p2 = ctx2.new_page()

    _open_file(stack, p1)
    _open_file(stack, p2)

    p1.wait_for_timeout(2000)

    c1 = p1.locator(".cm-content")
    c1.click()
    p1.keyboard.press("Escape")
    p1.keyboard.type("G")
    p1.keyboard.type("o")
    p1.keyboard.type("SYNCED_VIA_HARNESS")
    p1.keyboard.press("Escape")

    # Collaboration cursor labels ("Anonymous") render inline in
    # .cm-content and can split the typed string. Use a prefix that
    # won't be interrupted.
    c2 = p2.locator(".cm-content")
    expect(c2).to_contain_text("SYNCED_VIA", timeout=10_000)

    ctx1.close()
    ctx2.close()
