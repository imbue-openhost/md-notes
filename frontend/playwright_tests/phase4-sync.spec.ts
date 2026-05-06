import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const VAULT_PATH = '/tmp/test-vault-sync';
const SERVER_PORT = 8082;

let serverProcess: ChildProcess | null = null;
let vaultName: string;

function api(path: string): string {
  return `http://localhost:${SERVER_PORT}${path}`;
}

test.describe('Phase 4: Yjs Sync', () => {
  test.beforeAll(async () => {
    rmSync(VAULT_PATH, { recursive: true, force: true });
    mkdirSync(VAULT_PATH, { recursive: true });

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const projectRoot = join(__dirname, '..', '..');
    serverProcess = spawn(
      join(projectRoot, '.venv', 'bin', 'python3'),
      ['-m', 'server'],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          MDNOTES_VAULT_PATH: VAULT_PATH,
          MDNOTES_PORT: String(SERVER_PORT),
        },
        stdio: 'pipe',
      },
    );

    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(api('/health'));
        if (res.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }

    const created = await fetch(api('/api/vaults'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sync' }),
    });
    vaultName = (await created.json()).name;

    const vaultDir = join(VAULT_PATH, vaultName);
    mkdirSync(vaultDir, { recursive: true });
    writeFileSync(join(vaultDir, 'sync-test.md'), '# Sync Test\n\nOriginal content.');
  });

  test.afterAll(async () => {
    serverProcess?.kill();
    rmSync(VAULT_PATH, { recursive: true, force: true });
  });

  async function openVault(page: import('@playwright/test').Page): Promise<void> {
    await page.goto(api('/'));
    await page.locator('.vault-picker-item-name', { hasText: 'Sync' }).click();
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
    await page.waitForTimeout(500);
  }

  test('server serves the app with file tree', async ({ page }) => {
    await openVault(page);
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toContainText('sync-test');
  });

  test('clicking a file opens it via Yjs sync', async ({ page }) => {
    await openVault(page);

    const fileItem = page.locator('.sidebar-item[data-type="file"]').first();
    await fileItem.click();

    await page.waitForTimeout(2000);

    const content = page.locator('.cm-content');
    await expect(content).toContainText('Sync Test');
  });

  test('edits sync between two browser tabs', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await openVault(page1);
    await openVault(page2);

    const file1 = page1.locator('.sidebar-item[data-type="file"]').first();
    const file2 = page2.locator('.sidebar-item[data-type="file"]').first();
    await file1.click();
    await page1.waitForTimeout(2000);
    await file2.click();
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
