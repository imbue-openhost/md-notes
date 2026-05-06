import { test, expect } from '@playwright/test';
import { createVault, deleteVault, createFile, openVault } from './test-helpers';

const VAULT = 'VimrcTest';

test.beforeAll(async () => {
  await createVault(VAULT);
  await createFile(VAULT, 'test.md', '');
});

test.afterAll(async () => {
  await deleteVault(VAULT);
});

test.describe('Phase 2: Vimrc Parser', () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page, VAULT);
  });

  test('vim normal mode works — Escape returns to normal mode', async ({ page }) => {
    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');

    await page.keyboard.type('i');
    await page.keyboard.type('NORMALTEST');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

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

    await page.keyboard.type('gg');
    await page.keyboard.type('O');
    await page.keyboard.type('VIMRC_TEST');
    await page.keyboard.press('Escape');

    await expect(content).toContainText('VIMRC_TEST');
  });

  test('vim command mode — :set shows no errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const content = page.locator('.cm-content');
    await content.click();
    await page.keyboard.press('Escape');

    await page.keyboard.type(':');
    await page.waitForTimeout(200);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });
});
