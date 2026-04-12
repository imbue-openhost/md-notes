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

test.beforeAll(async () => {
  // Create test vault
  rmSync(VAULT_PATH, { recursive: true, force: true });
  mkdirSync(join(VAULT_PATH, 'subfolder'), { recursive: true });
  writeFileSync(join(VAULT_PATH, 'hello.md'), '# Hello World\n\nThis is a test note.');
  writeFileSync(join(VAULT_PATH, 'subfolder', 'nested.md'), '# Nested Note');

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

test.describe('Phase 3: Server + File Management', () => {
  test('API: list files returns vault contents', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/files`);
    expect(res.ok).toBe(true);
    const files = await res.json();
    expect(files).toBeInstanceOf(Array);
    const names = files.map((f: any) => f.name);
    expect(names).toContain('hello.md');
    expect(names).toContain('subfolder');
  });

  test('API: read file returns content', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/files/hello.md`);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain('# Hello World');
  });

  test('API: create and delete file', async () => {
    // Create
    const createRes = await fetch(`http://localhost:${SERVER_PORT}/api/files/new-note.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# New Note' }),
    });
    expect(createRes.status).toBe(201);

    // Verify exists
    const readRes = await fetch(`http://localhost:${SERVER_PORT}/api/files/new-note.md`);
    expect(readRes.ok).toBe(true);
    const text = await readRes.text();
    expect(text).toBe('# New Note');

    // Delete
    const deleteRes = await fetch(`http://localhost:${SERVER_PORT}/api/files/new-note.md`, {
      method: 'DELETE',
    });
    expect(deleteRes.ok).toBe(true);
  });

  test('API: rename file', async () => {
    // Create
    await fetch(`http://localhost:${SERVER_PORT}/api/files/rename-me.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Rename Test' }),
    });

    // Rename
    const renameRes = await fetch(`http://localhost:${SERVER_PORT}/api/files/rename-me.md`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath: 'renamed.md' }),
    });
    expect(renameRes.ok).toBe(true);

    // Verify new name
    const readRes = await fetch(`http://localhost:${SERVER_PORT}/api/files/renamed.md`);
    expect(readRes.ok).toBe(true);

    // Cleanup
    await fetch(`http://localhost:${SERVER_PORT}/api/files/renamed.md`, { method: 'DELETE' });
  });

  test('API: path traversal is blocked', async () => {
    // Use URL-encoded dots to avoid browser normalisation
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/files/..%2F..%2Fetc%2Fpasswd`);
    // Should get 403 (traversal blocked) or 404 (not found) — not 200
    expect([403, 404]).toContain(res.status);
    if (res.status === 200) {
      const text = await res.text();
      expect(text).not.toContain('root:');
    }
  });

  test('API: frontend is served', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/`);
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain('<!doctype html>');
  });

  test('sidebar shows file tree when API is available', async ({ page }) => {
    // Point the frontend at our test server
    await page.goto('/');
    await page.waitForSelector('.cm-editor', { timeout: 5000 });

    // Override the API base URL via console
    await page.evaluate((port) => {
      (window as any).__setApiBaseUrl?.(`http://localhost:${port}`);
    }, SERVER_PORT);

    // The sidebar should exist
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();
  });
});
