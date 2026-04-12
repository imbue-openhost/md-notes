import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const VAULT_PATH = '/tmp/test-vault-share';
const SERVER_PORT = 8083;

let serverProcess: ChildProcess | null = null;

test.describe('Phase 5: Sharing', () => {
  test.beforeAll(async () => {
    rmSync(VAULT_PATH, { recursive: true, force: true });
    mkdirSync(VAULT_PATH, { recursive: true });
    writeFileSync(join(VAULT_PATH, 'shared-doc.md'), '# Shared Document\n\nThis is shared content.');

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

  test('create and list share links via API', async () => {
    // Create a read link
    const createRes = await fetch(`http://localhost:${SERVER_PORT}/api/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docPath: 'shared-doc.md', permission: 'read' }),
    });
    expect(createRes.status).toBe(201);
    const { uuid: readUuid } = await createRes.json();
    expect(readUuid).toBeTruthy();

    // Create a write link
    const writeRes = await fetch(`http://localhost:${SERVER_PORT}/api/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docPath: 'shared-doc.md', permission: 'write' }),
    });
    expect(writeRes.status).toBe(201);
    const { uuid: writeUuid } = await writeRes.json();

    // List links
    const listRes = await fetch(`http://localhost:${SERVER_PORT}/api/share?docPath=shared-doc.md`);
    const links = await listRes.json();
    expect(links.length).toBe(2);

    // Cleanup
    await fetch(`http://localhost:${SERVER_PORT}/api/share/${readUuid}`, { method: 'DELETE' });
    await fetch(`http://localhost:${SERVER_PORT}/api/share/${writeUuid}`, { method: 'DELETE' });
  });

  test('share page serves the frontend', async () => {
    // Create a link
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docPath: 'shared-doc.md', permission: 'read' }),
    });
    const { uuid } = await res.json();

    // Access the share page
    const pageRes = await fetch(`http://localhost:${SERVER_PORT}/share/${uuid}`);
    expect(pageRes.ok).toBe(true);
    const html = await pageRes.text();
    expect(html).toContain('__SHARE_CONFIG__');
    expect(html).toContain(uuid);

    // Cleanup
    await fetch(`http://localhost:${SERVER_PORT}/api/share/${uuid}`, { method: 'DELETE' });
  });

  test('revoked share link returns 404', async () => {
    // Create and delete a link
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docPath: 'shared-doc.md', permission: 'read' }),
    });
    const { uuid } = await res.json();
    await fetch(`http://localhost:${SERVER_PORT}/api/share/${uuid}`, { method: 'DELETE' });

    // Should be 404 now
    const pageRes = await fetch(`http://localhost:${SERVER_PORT}/share/${uuid}`);
    expect(pageRes.status).toBe(404);
  });

  test('invalid share link returns 404', async () => {
    const res = await fetch(`http://localhost:${SERVER_PORT}/share/nonexistent`);
    expect(res.status).toBe(404);
  });
});
