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


def _open_file(stack: OpenhostStack, page: Page, vim: bool = False) -> None:
    stack.playwright_login(page)
    if vim:
        # Editor preference is a client-side setting; opt into vim keybindings
        # the same way the settings modal does.
        page.add_init_script("localStorage.setItem('mdnotes-editor-kind', 'live-preview-vim')")
    page.goto(stack.url)
    page.locator(".vault-picker-item-name", has_text=VAULT).click()
    page.locator(f'.sidebar-item[data-type="file"][data-path="{FILE}"]').click()
    page.wait_for_selector(".cm-editor", timeout=10_000)
    page.wait_for_timeout(1000)


def test_editor_loads(stack: OpenhostStack, page: Page) -> None:
    _open_file(stack, page)
    expect(page.locator(".cm-editor")).to_be_visible()
    expect(page.locator(".cm-content")).to_be_visible()


def test_default_editor_types_directly(stack: OpenhostStack, page: Page) -> None:
    _open_file(stack, page)
    # The default editor has no vim status bar and inserts keystrokes directly.
    expect(page.locator(".cm-vim-panel")).to_have_count(0)
    content = page.locator(".cm-content")
    content.click()
    page.keyboard.type("HARNESS_DIRECT")
    expect(content).to_contain_text("HARNESS_DIRECT")


def test_vim_insert_mode(stack: OpenhostStack, page: Page) -> None:
    _open_file(stack, page, vim=True)
    expect(page.locator(".cm-vim-panel")).to_be_visible()
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
    p1.keyboard.press("Enter")
    p1.keyboard.type("SYNCED_VIA_HARNESS")

    # Collaboration cursor labels ("Anonymous") render inline in
    # .cm-content and can split the typed string. Use a prefix that
    # won't be interrupted.
    c2 = p2.locator(".cm-content")
    expect(c2).to_contain_text("SYNCED_VIA", timeout=10_000)

    ctx1.close()
    ctx2.close()


def test_pane_collapse(stack: OpenhostStack, page: Page) -> None:
    _open_file(stack, page)

    page.keyboard.press("Control+\\")
    expect(page.locator(".dv-groupview")).to_have_count(2)
    page.wait_for_timeout(500)

    # The tab-bar button collapses a pane to a thin strip labeled with the file name.
    page.locator(".pane-collapse-btn").first.click()
    strip = page.locator(".pane-collapsed-strip")
    expect(strip).to_have_count(1)
    expect(strip).to_contain_text("test")
    box = page.locator(".dv-groupview.pane-collapsed").bounding_box()
    assert box is not None and box["width"] < 40
    expect(page.locator(".dv-groupview:not(.pane-collapsed) .cm-editor").first).to_be_visible()

    # Collapsed state survives a reload.
    page.reload()
    page.wait_for_selector(".pane-collapsed-strip", timeout=10_000)

    # Clicking the strip expands the pane back to a usable width.
    page.locator(".pane-collapsed-strip").click()
    expect(strip).to_have_count(0)
    for group in page.locator(".dv-groupview").all():
        gbox = group.bounding_box()
        assert gbox is not None and gbox["width"] >= 100

    # Ctrl+Shift+\ collapses the active pane; focusing it again (ctrl+l) expands it.
    groups = page.locator(".dv-groupview").all()
    rightmost = max(groups, key=lambda g: (g.bounding_box() or {"x": 0})["x"])
    rightmost.locator(".cm-content").click()
    page.keyboard.press("Control+Shift+Backslash")
    expect(strip).to_have_count(1)
    page.keyboard.press("Control+l")
    expect(strip).to_have_count(0)


def test_search_palette(stack: OpenhostStack, page: Page) -> None:
    s = stack.owner_session
    s.post(
        f"{stack.url}/api/docs/{VAULT}/file?path=search-target.md",
        json={"content": "top line\n\nfind the Golden-Nugget here\n"},
    )

    stack.playwright_login(page)
    page.goto(stack.url)
    page.locator(".vault-picker-item-name", has_text=VAULT).click()
    page.wait_for_selector("#sidebar")

    # App handles metaKey || ctrlKey, so Control works cross-platform.
    page.keyboard.press("Control+Shift+F")
    search_input = page.locator(".search-modal input")
    expect(search_input).to_be_visible()

    # Fuzzy default: query with different case/punctuation still matches, highlighted.
    search_input.type("golden nugget")
    hit = page.locator(".search-hit", has_text="search-target.md")
    expect(hit.first).to_be_visible()
    expect(page.locator("mark.search-hl").first).to_have_text("Golden-Nugget")

    # Selecting the hit opens the file with the cursor on the matched line.
    hit.first.click()
    page.wait_for_selector(".cm-editor", timeout=10_000)
    expect(page.locator(".cm-content")).to_contain_text("Golden-Nugget")
    expect(page.locator(".cm-activeLine")).to_contain_text("Golden-Nugget", timeout=10_000)

    # Escape closes the palette.
    page.keyboard.press("Control+Shift+F")
    expect(page.locator(".search-modal input")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator(".search-modal input")).not_to_be_visible()
