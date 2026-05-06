import { test, expect } from '@playwright/test';
import { createVault, deleteVault, createFile, openVault } from './test-helpers';

const VAULT = 'VaultSwitchTest';

test.beforeAll(async () => {
  await createVault(VAULT);
  await createFile(VAULT, 'test.md', '');
});

test.afterAll(async () => {
  await deleteVault(VAULT);
});

test.describe('Phase 5: Vault switching', () => {
  test('switch-vault button returns to picker without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await openVault(page, VAULT);
    await expect(page.locator('.cm-editor')).toBeVisible();

    await page.locator('.sidebar-btn[title="Switch vault"]').click();

    await expect(page.locator('.vault-picker')).toBeVisible();
    await expect(page.locator('.vault-picker-item-name', { hasText: VAULT })).toBeVisible();
    await expect(page.locator('.cm-editor')).toHaveCount(0);

    const realErrors = errors.filter(
      (e) =>
        !e.includes('lowlight') &&
        !e.includes('Failed to fetch') &&
        !e.includes('ERR_CONNECTION_REFUSED'),
    );
    expect(realErrors).toEqual([]);
  });

  test('can re-open the same vault after switching', async ({ page }) => {
    await openVault(page, VAULT);
    await page.locator('.sidebar-btn[title="Switch vault"]').click();
    await expect(page.locator('.vault-picker')).toBeVisible();
    await page.locator('.vault-picker-item-name', { hasText: VAULT }).click();
    await page.locator('.sidebar-item[data-type="file"][data-path="test.md"]').click();
    await expect(page.locator('.cm-editor')).toBeVisible();
  });
});
