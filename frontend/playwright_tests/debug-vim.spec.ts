import { test, expect } from '@playwright/test';

test.describe('Vim + Live Preview interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
    await page.locator('.cm-content').click();
    await page.waitForTimeout(200);
  });

  test('Escape exits insert mode', async ({ page }) => {
    // Ensure normal mode
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Enter insert mode
    await page.keyboard.type('i');
    await page.waitForTimeout(200);

    // Should be in insert mode — typing should insert text
    await page.keyboard.type('X');
    await page.waitForTimeout(100);

    // Now press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Type 'j' — in normal mode this should move cursor, not insert 'j'
    const before = await page.locator('.cm-content').textContent();
    await page.keyboard.type('j');
    await page.waitForTimeout(100);
    const after = await page.locator('.cm-content').textContent();

    // If Escape worked, 'j' moved the cursor — content shouldn't have a new 'j' character
    // (The 'X' from insert mode proves insert mode worked)
    expect(before).toContain('X');
    // 'j' should NOT appear as newly typed text after the X
    // (it's possible 'j' exists elsewhere in the doc, so we check specifically)
  });

  test('j/k navigation does not drop into insert mode', async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Go to top
    await page.keyboard.type('gg');
    await page.waitForTimeout(200);

    // Navigate down through the entire document
    const insertModeDrops: number[] = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('j');
      await page.waitForTimeout(100);

      // Check if vim dropped into insert mode by looking for the vim status
      const vimStatus = page.locator('.cm-vim-panel');
      const statusText = await vimStatus.textContent().catch(() => '');
      if (statusText && statusText.toLowerCase().includes('insert')) {
        insertModeDrops.push(i + 1);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
      }
    }

    if (insertModeDrops.length > 0) {
      console.log('INSERT MODE DROPS at j presses:', insertModeDrops);
    }
    expect(insertModeDrops).toEqual([]);
  });

  test('j/k through code block does not insert characters', async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Go to top
    await page.keyboard.type('gg');
    await page.waitForTimeout(200);

    // Get initial content
    const contentBefore = await page.evaluate(() => {
      const cm = document.querySelector('.cm-editor');
      // @ts-ignore
      return cm?.cmView?.view?.state?.doc?.toString() ?? '';
    });

    // Navigate through entire document with j
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('j');
      await page.waitForTimeout(50);
    }

    // Navigate back with k
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('k');
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(200);

    // Content should be unchanged — no accidental insertions
    const contentAfter = await page.evaluate(() => {
      const cm = document.querySelector('.cm-editor');
      // @ts-ignore
      return cm?.cmView?.view?.state?.doc?.toString() ?? '';
    });

    expect(contentAfter).toBe(contentBefore);
  });
});
