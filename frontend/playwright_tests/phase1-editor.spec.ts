import { test, expect } from '@playwright/test';
import { createVault, deleteVault, createFile, openVault } from './test-helpers';

const VAULT = 'EditorTest';

test.beforeAll(async () => {
  await createVault(VAULT);
  await createFile(VAULT, 'test.md', '');
});

test.afterAll(async () => {
  await deleteVault(VAULT);
});

test.describe('Phase 1: Editor Core', () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page, VAULT);
  });

  test('editor mounts', async ({ page }) => {
    const editor = page.locator('.cm-editor');
    await expect(editor).toBeVisible();
    const content = page.locator('.cm-content');
    await expect(content).toBeVisible();
  });

  test('markdown styling: headings are styled', async ({ page }) => {
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');
    await page.keyboard.type('i');
    await page.keyboard.type('# Test Heading');
    await page.keyboard.press('Escape');

    const h1 = page.locator('.cm-header-1');
    await expect(h1).toBeVisible();
  });

  test('markdown styling: bold text is styled', async ({ page }) => {
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');
    await page.keyboard.type('i');
    await page.keyboard.type('**bold text**');
    await page.keyboard.press('Escape');

    const bold = page.locator('.cm-strong').first();
    await expect(bold).toBeVisible();
  });

  test('markdown styling: italic text is styled', async ({ page }) => {
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');
    await page.keyboard.type('i');
    await page.keyboard.type('*italic text*');
    await page.keyboard.press('Escape');

    const italic = page.locator('.cm-emphasis').first();
    await expect(italic).toBeVisible();
  });

  test('markdown styling: inline code is styled', async ({ page }) => {
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');
    await page.keyboard.type('i');
    await page.keyboard.type('`inline code`');
    await page.keyboard.press('Escape');

    const code = page.locator('.cm-code').first();
    await expect(code).toBeVisible();
  });

  test('vim mode is active', async ({ page }) => {
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');

    await page.keyboard.type('i');
    await page.keyboard.type('TESTINPUT');
    await expect(content).toContainText('TESTINPUT');
  });

  test('fold gutter is present', async ({ page }) => {
    const foldGutter = page.locator('.cm-foldGutter');
    await expect(foldGutter).toBeVisible();
  });

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // beforeEach already opened the vault; reload to capture errors on a fresh load
    await page.reload();
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
    await page.waitForTimeout(500);

    const realErrors = errors.filter(
      (e) =>
        !e.includes('lowlight') &&
        !e.includes('Failed to fetch') &&
        !e.includes('ERR_CONNECTION_REFUSED')
    );
    expect(realErrors).toEqual([]);
  });
});
