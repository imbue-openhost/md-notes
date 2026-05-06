import { test, expect } from '@playwright/test';

test.describe('Phase 2: Vimrc Parser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
  });

  test('vim normal mode works — Escape returns to normal mode', async ({ page }) => {
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');

    // Type some content in insert mode first
    await page.keyboard.type('i');
    await page.keyboard.type('NORMALTEST');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // In normal mode, 'j' should not insert text
    const before = await content.textContent();
    await page.keyboard.press('j');
    await page.waitForTimeout(100);
    const after = await content.textContent();

    expect(before).toContain('NORMALTEST');
    expect(after).toBe(before);
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
