import { test, expect } from '@playwright/test';

/**
 * Phase 3 tests run against both the Vite dev server (frontend)
 * and the Quart server (API). The Quart server must be running
 * on port 8080 with MDNOTES_VAULT_PATH pointing to a test vault.
 *
 * Setup is handled by the test — we start the server as a child process.
 */

import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const VAULT_PATH = '/tmp/test-vault-pw';
const SERVER_PORT = 8081;

let serverProcess: ChildProcess | null = null;
let vaultName: string;

function api(path: string): string {
  return `http://localhost:${SERVER_PORT}${path}`;
}

function filesApi(path: string = ''): string {
  const suffix = path ? `/${path}` : '';
  return api(`/api/vaults/${vaultName}/files${suffix}`);
}

test.beforeAll(async () => {
  rmSync(VAULT_PATH, { recursive: true, force: true });
  mkdirSync(VAULT_PATH, { recursive: true });

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

  // Wait for server to be ready (health is public — no auth)
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(api('/health'));
      if (res.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  // Create the test vault and seed its files
  const created = await fetch(api('/api/vaults'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test' }),
  });
  vaultName = (await created.json()).name;

  const vaultDir = join(VAULT_PATH, vaultName);
  mkdirSync(join(vaultDir, 'subfolder'), { recursive: true });
  writeFileSync(join(vaultDir, 'hello.md'), '# Hello World\n\nThis is a test note.');
  writeFileSync(join(vaultDir, 'subfolder', 'nested.md'), '# Nested Note');
});

test.afterAll(async () => {
  serverProcess?.kill();
  rmSync(VAULT_PATH, { recursive: true, force: true });
});

test.describe('Phase 3: Server + File Management', () => {
  test('API: list files returns vault contents', async () => {
    const res = await fetch(filesApi());
    expect(res.ok).toBe(true);
    const files = await res.json();
    expect(files).toBeInstanceOf(Array);
    const names = files.map((f: any) => f.name);
    expect(names).toContain('hello.md');
    expect(names).toContain('subfolder');
  });

  test('API: read file returns content', async () => {
    const res = await fetch(filesApi('hello.md'));
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain('# Hello World');
  });

  test('API: create and delete file', async () => {
    const createRes = await fetch(filesApi('new-note.md'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# New Note' }),
    });
    expect(createRes.status).toBe(201);

    const readRes = await fetch(filesApi('new-note.md'));
    expect(readRes.ok).toBe(true);
    expect(await readRes.text()).toBe('# New Note');

    const deleteRes = await fetch(filesApi('new-note.md'), { method: 'DELETE' });
    expect(deleteRes.ok).toBe(true);
  });

  test('API: rename file', async () => {
    await fetch(filesApi('rename-me.md'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Rename Test' }),
    });

    const renameRes = await fetch(filesApi('rename-me.md'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath: 'renamed.md' }),
    });
    expect(renameRes.ok).toBe(true);

    const readRes = await fetch(filesApi('renamed.md'));
    expect(readRes.ok).toBe(true);

    await fetch(filesApi('renamed.md'), { method: 'DELETE' });
  });

  test('API: path traversal is blocked', async () => {
    const res = await fetch(filesApi('..%2F..%2Fetc%2Fpasswd'));
    expect([403, 404]).toContain(res.status);
    if (res.status === 200) {
      const text = await res.text();
      expect(text).not.toContain('root:');
    }
  });

  test('API: frontend is served', async () => {
    const res = await fetch(api('/'));
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain('<!doctype html>');
  });

  test('sidebar shows file tree after selecting vault', async ({ page }) => {
    await page.goto(api('/'));
    // Web boot lands on the vault picker — pick the test vault
    await page.locator('.vault-picker-item-name', { hasText: 'Test' }).click();
    await page.waitForSelector('.cm-editor', { timeout: 5000 });
    await page.waitForTimeout(500);

    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toContainText('hello');
  });
});
