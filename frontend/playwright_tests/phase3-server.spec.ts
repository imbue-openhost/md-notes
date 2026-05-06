import { test, expect } from '@playwright/test';
import { createVault, deleteVault, createFile, fileUrl, listUrl, openVault, backendUrl } from './test-helpers';

let vaultName: string;

test.beforeAll(async () => {
  vaultName = await createVault('ServerTest');
  await createFile(vaultName, 'hello.md', '# Hello World\n\nThis is a test note.');
  await createFile(vaultName, 'subfolder/nested.md', '# Nested Note');
});

test.afterAll(async () => {
  await deleteVault(vaultName);
});

test.describe('Phase 3: Server + File Management', () => {
  test('API: list files returns vault contents', async () => {
    const res = await fetch(listUrl(vaultName));
    expect(res.ok).toBe(true);
    const files = await res.json();
    expect(files).toBeInstanceOf(Array);
    const names = files.map((f: any) => f.name);
    expect(names).toContain('hello.md');
    expect(names).toContain('subfolder');
  });

  test('API: read file returns content', async () => {
    const res = await fetch(fileUrl(vaultName, 'hello.md'));
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain('# Hello World');
  });

  test('API: create and delete file', async () => {
    const createRes = await fetch(fileUrl(vaultName, 'new-note.md'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# New Note' }),
    });
    expect(createRes.status).toBe(201);

    const readRes = await fetch(fileUrl(vaultName, 'new-note.md'));
    expect(readRes.ok).toBe(true);
    expect(await readRes.text()).toBe('# New Note');

    const deleteRes = await fetch(fileUrl(vaultName, 'new-note.md'), { method: 'DELETE' });
    expect(deleteRes.ok).toBe(true);
  });

  test('API: rename file', async () => {
    await fetch(fileUrl(vaultName, 'rename-me.md'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Rename Test' }),
    });

    const renameRes = await fetch(fileUrl(vaultName, 'rename-me.md'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath: 'renamed.md' }),
    });
    expect(renameRes.ok).toBe(true);

    const readRes = await fetch(fileUrl(vaultName, 'renamed.md'));
    expect(readRes.ok).toBe(true);

    await fetch(fileUrl(vaultName, 'renamed.md'), { method: 'DELETE' });
  });

  test('API: path traversal is blocked', async () => {
    const res = await fetch(fileUrl(vaultName, '../../etc/passwd'));
    expect([400, 403, 404]).toContain(res.status);
  });

  test('API: frontend is served', async () => {
    const res = await fetch(backendUrl('/'));
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain('<!doctype html>');
  });

  test('sidebar shows file tree after selecting vault', async ({ page }) => {
    await openVault(page, vaultName, 'hello.md');
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toContainText('hello');
  });
});
