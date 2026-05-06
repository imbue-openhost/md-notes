import { test, expect } from '@playwright/test';
import { createVault, deleteVault, createFile, openVault } from './test-helpers';

let vaultName: string;
const FILE = 'sync-test.md';

test.beforeAll(async () => {
  vaultName = await createVault('SyncTest');
  await createFile(vaultName, FILE, '# Sync Test\n\nOriginal content.');
});

test.afterAll(async () => {
  await deleteVault(vaultName);
});

test.describe('Phase 4: Yjs Sync', () => {
  test('server serves the app with file tree', async ({ page }) => {
    await openVault(page, vaultName, FILE);
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toContainText('sync-test');
  });

  test('clicking a file opens it via Yjs sync', async ({ page }) => {
    await openVault(page, vaultName, FILE);

    await page.waitForTimeout(2000);

    const content = page.locator('.cm-content');
    await expect(content).toContainText('Sync Test');
  });

  test('edits sync between two browser tabs', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await openVault(page1, vaultName, FILE);
    await openVault(page2, vaultName, FILE);

    await page1.waitForTimeout(2000);
    await page2.waitForTimeout(2000);

    const content1 = page1.locator('.cm-content');
    await content1.click();
    await page1.keyboard.press('Escape');
    await page1.keyboard.type('G');
    await page1.keyboard.type('o');
    await page1.keyboard.type('SYNCED_FROM_TAB1');
    await page1.keyboard.press('Escape');

    await page1.waitForTimeout(2000);

    const content2 = page2.locator('.cm-content');
    await expect(content2).toContainText('SYNCED_FROM_TAB', { timeout: 5000 });

    await context1.close();
    await context2.close();
  });
});
