import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const VAULT_PATH = '/tmp/test-vault-sync';
const SERVER_PORT = 8082;

let serverProcess: ChildProcess | null = null;

test.describe('Phase 4: Yjs Sync', () => {
  test.beforeAll(async () => {
    // Create test vault
    rmSync(VAULT_PATH, { recursive: true, force: true });
    mkdirSync(VAULT_PATH, { recursive: true });
    writeFileSync(join(VAULT_PATH, 'sync-test.md'), '# Sync Test\n\nOriginal content.');

    // Start Quart server
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

    // Wait for server to be ready
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://localhost:${SERVER_PORT}/api/files`);
        if (res.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test.afterAll(async () => {
    serverProcess?.kill();
    rmSync(VAULT_PATH, { recursive: true, force: true });
  });
  test('server serves the app with file tree', async ({ page }) => {
    await page.goto(`http://localhost:${SERVER_PORT}/`);
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
    await page.waitForTimeout(500);

    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toContainText('sync-test');
  });

  test('clicking a file opens it via Yjs sync', async ({ page }) => {
    await page.goto(`http://localhost:${SERVER_PORT}/`);
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
    await page.waitForTimeout(500);

    // Click the file in the sidebar
    const fileItem = page.locator('.sidebar-item[data-type="file"]').first();
    await fileItem.click();

    // Wait for sync to load content
    await page.waitForTimeout(2000);

    // The editor should now contain the file's content
    const content = page.locator('.cm-content');
    await expect(content).toContainText('Sync Test');
  });

  test('edits sync between two browser tabs', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Open the same file in both tabs
    await page1.goto(`http://localhost:${SERVER_PORT}/`);
    await page2.goto(`http://localhost:${SERVER_PORT}/`);
    await page1.waitForSelector('.cm-editor', { timeout: 5000 });
    await page2.waitForSelector('.cm-editor', { timeout: 5000 });
    await page1.waitForTimeout(500);
    await page2.waitForTimeout(500);

    // Click the file in both tabs
    const file1 = page1.locator('.sidebar-item[data-type="file"]').first();
    const file2 = page2.locator('.sidebar-item[data-type="file"]').first();
    await file1.click();
    await page1.waitForTimeout(2000);
    await file2.click();
    await page2.waitForTimeout(2000);

    // Type in tab 1
    const content1 = page1.locator('.cm-content');
    await content1.click();
    await page1.keyboard.press('Escape');
    // Go to end and add text
    await page1.keyboard.type('G');
    await page1.keyboard.type('o');
    await page1.keyboard.type('SYNCED_FROM_TAB1');
    await page1.keyboard.press('Escape');

    // Wait for sync to propagate
    await page1.waitForTimeout(2000);

    // Tab 2 should see the text (awareness cursors may inject widgets between chars)
    const content2 = page2.locator('.cm-content');
    await expect(content2).toContainText('SYNCED_FROM_TAB', { timeout: 5000 });

    await context1.close();
    await context2.close();
  });
});
