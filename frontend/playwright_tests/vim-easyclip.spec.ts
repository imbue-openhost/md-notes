import { test, expect, type Page } from '@playwright/test';
import { createVault, deleteVault, createFile, openVault } from './test-helpers';

const VAULT = 'VimEasyclip';

test.beforeAll(async () => {
  await createVault(VAULT);
  await createFile(VAULT, 'test.md', '');
});

test.afterAll(async () => {
  await deleteVault(VAULT);
});

async function editorText(page: Page): Promise<string> {
  return page.locator('.cm-content').first().innerText();
}

async function setContent(page: Page, lines: string[]): Promise<void> {
  await page.keyboard.type('ggVG');
  await page.waitForTimeout(100);
  await page.keyboard.type('d');
  await page.waitForTimeout(100);
  await page.keyboard.type('i');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(lines[i]);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

test.describe('Easyclip: d = black-hole delete, m = cut', () => {
  test.beforeEach(async ({ page }) => {
    await openVault(page, VAULT);
    await page.locator('.cm-content').click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  test('dd deletes a line without yanking it', async ({ page }) => {
    await setContent(page, ['aaa', 'bbb', 'ccc']);

    await page.keyboard.type('gg');
    await page.waitForTimeout(100);
    await page.keyboard.type('yy');
    await page.waitForTimeout(100);
    await page.keyboard.type('j');
    await page.waitForTimeout(100);
    await page.keyboard.type('dd');
    await page.waitForTimeout(300);

    const afterDelete = await editorText(page);
    expect(afterDelete).not.toContain('bbb');
    expect(afterDelete).toContain('aaa');

    await page.keyboard.type('p');
    await page.waitForTimeout(300);

    const afterPaste = await editorText(page);
    expect(afterPaste).not.toContain('bbb');
    const aaaCount = (afterPaste.match(/aaa/g) || []).length;
    expect(aaaCount).toBe(2);
  });

  test('mm cuts a line (delete + yank)', async ({ page }) => {
    await setContent(page, ['aaa', 'bbb', 'ccc']);

    await page.keyboard.type('gg');
    await page.waitForTimeout(100);
    await page.keyboard.type('j');
    await page.waitForTimeout(100);
    await page.keyboard.type('mm');
    await page.waitForTimeout(300);

    const afterCut = await editorText(page);
    expect(afterCut).not.toContain('bbb');

    await page.keyboard.type('p');
    await page.waitForTimeout(300);

    const afterPaste = await editorText(page);
    expect(afterPaste).toContain('bbb');
  });

  test('dw deletes a word without yanking it', async ({ page }) => {
    // Use a marker line so we can distinguish yy content from dw content
    await setContent(page, ['MARKER', 'hello world']);

    await page.keyboard.type('gg');
    await page.waitForTimeout(100);
    await page.keyboard.type('yy');
    await page.waitForTimeout(100);
    await page.keyboard.type('j');
    await page.waitForTimeout(100);
    await page.keyboard.type('0');
    await page.waitForTimeout(100);
    await page.keyboard.type('dw');
    await page.waitForTimeout(300);

    const afterDelete = await editorText(page);
    expect(afterDelete).toContain('world');
    expect(afterDelete).not.toContain('hello');

    // p should paste MARKER (yy'd line), not "hello " (dw'd word)
    await page.keyboard.type('p');
    await page.waitForTimeout(300);

    const afterPaste = await editorText(page);
    expect(afterPaste).toContain('MARKER');
  });

  test('mw cuts a word (delete + yank)', async ({ page }) => {
    await setContent(page, ['hello world']);

    await page.keyboard.type('gg');
    await page.waitForTimeout(100);
    await page.keyboard.type('0');
    await page.waitForTimeout(100);
    await page.keyboard.type('mw');
    await page.waitForTimeout(300);

    const afterCut = await editorText(page);
    expect(afterCut.trim()).toBe('world');

    await page.keyboard.type('p');
    await page.waitForTimeout(300);

    const afterPaste = await editorText(page);
    expect(afterPaste).toContain('hello');
  });

  test('visual-mode d deletes to black hole', async ({ page }) => {
    // Seed register with distinct text so we can verify d uses black hole
    await setContent(page, ['MARKER', 'delete me', 'keep me']);

    await page.keyboard.type('gg');
    await page.waitForTimeout(100);
    await page.keyboard.type('yy');
    await page.waitForTimeout(100);

    // Visual-select line 2 and delete with d
    await page.keyboard.type('j');
    await page.waitForTimeout(100);
    await page.keyboard.type('V');
    await page.waitForTimeout(100);
    await page.keyboard.type('d');
    await page.waitForTimeout(300);

    const afterDelete = await editorText(page);
    expect(afterDelete).not.toContain('delete me');
    expect(afterDelete).toContain('keep me');

    // p should paste MARKER (yy'd line), not "delete me"
    await page.keyboard.type('p');
    await page.waitForTimeout(300);

    const afterPaste = await editorText(page);
    expect(afterPaste).toContain('MARKER');
    expect(afterPaste).not.toContain('delete me');
  });

  test('visual-mode m cuts (delete + yank)', async ({ page }) => {
    await setContent(page, ['cut me', 'keep me']);

    await page.keyboard.type('gg');
    await page.waitForTimeout(100);
    await page.keyboard.type('V');
    await page.waitForTimeout(100);
    await page.keyboard.type('m');
    await page.waitForTimeout(300);

    const afterCut = await editorText(page);
    expect(afterCut).not.toContain('cut me');
    expect(afterCut).toContain('keep me');

    await page.keyboard.type('p');
    await page.waitForTimeout(300);

    const afterPaste = await editorText(page);
    expect(afterPaste).toContain('cut me');
  });

  test('x deletes a character to black hole', async ({ page }) => {
    await setContent(page, ['abcdef']);

    await page.keyboard.type('gg');
    await page.waitForTimeout(100);
    await page.keyboard.type('yy');
    await page.waitForTimeout(100);
    await page.keyboard.type('0');
    await page.waitForTimeout(100);
    await page.keyboard.type('x');
    await page.waitForTimeout(300);

    const afterDelete = await editorText(page);
    expect(afterDelete.trim()).toBe('bcdef');

    await page.keyboard.type('p');
    await page.waitForTimeout(300);

    const afterPaste = await editorText(page);
    expect(afterPaste).toContain('bcdef');
  });

  test('j/k work in visual mode to extend selection', async ({ page }) => {
    await setContent(page, ['line1', 'line2', 'line3']);

    // Enter visual-line mode on line 1, then j to extend to line 2
    await page.keyboard.type('gg');
    await page.waitForTimeout(100);
    await page.keyboard.type('V');
    await page.waitForTimeout(100);
    await page.keyboard.type('j');
    await page.waitForTimeout(100);

    // Cut the selection (visual m = cut)
    await page.keyboard.type('m');
    await page.waitForTimeout(300);

    const afterCut = await editorText(page);
    // Both line1 and line2 should be gone (j extended the selection)
    expect(afterCut).not.toContain('line1');
    expect(afterCut).not.toContain('line2');
    expect(afterCut).toContain('line3');
  });
});
