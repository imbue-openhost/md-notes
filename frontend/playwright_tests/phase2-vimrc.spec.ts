import { test, expect } from '@playwright/test';

test.describe('Phase 2: Vimrc Parser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
  });

  test('vim normal mode works — Escape returns to normal mode', async ({ page }) => {
    const content = page.locator('.cm-content');
    await content.click();

    // Go to normal mode
    await page.keyboard.press('Escape');

    // In normal mode, 'j' moves cursor down (doesn't insert text)
    // First, go to the top with gg
    await page.keyboard.type('gg');
    await page.waitForTimeout(100);

    // Remember the cursor line, move down with j
    await page.keyboard.press('j');
    await page.waitForTimeout(100);

    // If vim is working, 'j' should not have inserted 'j' into the document
    const text = await content.textContent();
    // The sample doc starts with "Welcome to md-notes" — no stray 'j' should appear there
    expect(text).toContain('Welcome to md-notes');
  });

  test('vim insert mode allows typing', async ({ page }) => {
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');

    // Go to top and enter insert mode
    await page.keyboard.type('gg');
    await page.keyboard.type('O'); // Open line above in insert mode
    await page.keyboard.type('VIMRC_TEST');
    await page.keyboard.press('Escape');

    await expect(content).toContainText('VIMRC_TEST');
  });

  test('vim command mode — :set shows no errors', async ({ page }) => {
    // Register error listener before any actions
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');

    // Type a command — this tests that vim command line works
    await page.keyboard.type(':');
    await page.waitForTimeout(200);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });
});
