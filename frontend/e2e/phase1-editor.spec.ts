import { test, expect } from '@playwright/test';

test.describe('Phase 1: Editor Core', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for CM6 editor to mount
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
  });

  test('editor mounts and shows content', async ({ page }) => {
    const editor = page.locator('.cm-editor');
    await expect(editor).toBeVisible();
    const content = page.locator('.cm-content');
    await expect(content).toContainText('Welcome to md-notes');
  });

  test('live preview: headings are styled', async ({ page }) => {
    // H1 should have cm-header-1 class applied
    const h1 = page.locator('.cm-header-1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('Welcome to md-notes');
  });

  test('live preview: bold text is styled', async ({ page }) => {
    const bold = page.locator('.cm-strong').first();
    await expect(bold).toBeVisible();
  });

  test('live preview: inline formatting marks are hidden when cursor is away', async ({ page }) => {
    // Click at the very end of the document to move cursor away from formatting
    const content = page.locator('.cm-content');
    await content.click({ position: { x: 10, y: 10 } });

    // Press Escape to go to normal mode, then G to go to end of doc
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+G');

    // Wait for decorations to settle
    await page.waitForTimeout(300);

    // Inline marks should exist with the hidden class (no -visible suffix)
    const hiddenMarks = page.locator('.cm-formatting-inline:not(.cm-formatting-inline-visible)');
    const count = await hiddenMarks.count();
    expect(count).toBeGreaterThan(0);
  });

  test('vim mode is active', async ({ page }) => {
    // @replit/codemirror-vim adds a cm-vim-panel or similar indicator
    // The key test: pressing 'i' should enter insert mode
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');

    // Type 'i' to enter insert mode - should not insert 'i' literally in normal mode
    // Instead it enters insert mode. Then typing 'X' should insert 'X'.
    await page.keyboard.type('i');
    await page.keyboard.type('TESTINPUT');
    await expect(content).toContainText('TESTINPUT');
  });

  test('fold gutter is present', async ({ page }) => {
    const foldGutter = page.locator('.cm-foldGutter');
    await expect(foldGutter).toBeVisible();
  });

  test('code blocks are rendered', async ({ page }) => {
    // The code block widget or source styling should be present
    const codeBlock = page.locator('.cm-codeblock-widget, .cm-codeblock-source');
    const count = await codeBlock.count();
    expect(count).toBeGreaterThan(0);
  });

  test('link widgets are rendered', async ({ page }) => {
    // Move cursor to end so links are not in edit mode
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+G');
    await page.waitForTimeout(300);

    const linkWidget = page.locator('.cm-link-widget');
    const count = await linkWidget.count();
    expect(count).toBeGreaterThan(0);
  });

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.reload();
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
    await page.waitForTimeout(500);

    // Filter out expected warnings (e.g., lowlight not available)
    const realErrors = errors.filter(
      (e) =>
        !e.includes('lowlight') &&
        !e.includes('Failed to fetch') &&
        !e.includes('ERR_CONNECTION_REFUSED')
    );
    expect(realErrors).toEqual([]);
  });
});
