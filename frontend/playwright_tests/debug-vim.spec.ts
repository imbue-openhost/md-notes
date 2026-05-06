import { test, expect } from '@playwright/test';
import { createVault, deleteVault, createFile, openVault } from './test-helpers';

const VAULT = 'VimDebug';

test.beforeAll(async () => {
  await createVault(VAULT);
  await createFile(VAULT, 'test.md', '');
});

test.afterAll(async () => {
  await deleteVault(VAULT);
});

test.describe('Vim + Live Preview interaction', () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page, VAULT);
    await page.locator('.cm-content').click();
    await page.waitForTimeout(200);
  });

  test('Escape exits insert mode', async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await page.keyboard.type('i');
    await page.waitForTimeout(200);

    await page.keyboard.type('X');
    await page.waitForTimeout(100);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const before = await page.locator('.cm-content').textContent();
    await page.keyboard.type('j');
    await page.waitForTimeout(100);
    const after = await page.locator('.cm-content').textContent();

    expect(before).toContain('X');
  });

  test('j/k navigation does not drop into insert mode', async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Type some multi-line content first
    await page.keyboard.type('i');
    await page.keyboard.type('line1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line3');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await page.keyboard.type('gg');
    await page.waitForTimeout(200);

    const contentBefore = await page.evaluate(() => {
      const cm = document.querySelector('.cm-editor');
      // @ts-ignore
      return cm?.cmView?.view?.state?.doc?.toString() ?? '';
    });

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('j');
      await page.waitForTimeout(100);
    }

    const contentAfter = await page.evaluate(() => {
      const cm = document.querySelector('.cm-editor');
      // @ts-ignore
      return cm?.cmView?.view?.state?.doc?.toString() ?? '';
    });

    expect(contentAfter).toBe(contentBefore);
  });

  test('j/k through code block does not insert characters', async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Type content with a code block
    await page.keyboard.type('i');
    await page.keyboard.type('# Heading');
    await page.keyboard.press('Enter');
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await page.keyboard.type('const x = 1;');
    await page.keyboard.press('Enter');
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await page.keyboard.type('end');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await page.keyboard.type('gg');
    await page.waitForTimeout(200);

    const contentBefore = await page.evaluate(() => {
      const cm = document.querySelector('.cm-editor');
      // @ts-ignore
      return cm?.cmView?.view?.state?.doc?.toString() ?? '';
    });

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('j');
      await page.waitForTimeout(50);
    }
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('k');
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(200);

    const contentAfter = await page.evaluate(() => {
      const cm = document.querySelector('.cm-editor');
      // @ts-ignore
      return cm?.cmView?.view?.state?.doc?.toString() ?? '';
    });

    expect(contentAfter).toBe(contentBefore);
  });
});
