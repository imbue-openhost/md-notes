import { test, expect } from '@playwright/test';
import { createVault, deleteVault, createFile, backendUrl } from './test-helpers';

let vaultName: string;
let docPath: string;

test.beforeAll(async () => {
  vaultName = await createVault('ShareTest');
  await createFile(vaultName, 'shared-doc.md', '# Shared Document\n\nThis is shared content.');
  docPath = `${vaultName}/shared-doc.md`;
});

test.afterAll(async () => {
  await deleteVault(vaultName);
});

test.describe('Phase 5: Sharing', () => {
  test('create and list share links via API', async () => {
    const createRes = await fetch(backendUrl('/api/share'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docPath, permission: 'read' }),
    });
    expect(createRes.status).toBe(201);
    const { uuid: readUuid } = await createRes.json();
    expect(readUuid).toBeTruthy();

    const writeRes = await fetch(backendUrl('/api/share'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docPath, permission: 'write' }),
    });
    expect(writeRes.status).toBe(201);
    const { uuid: writeUuid } = await writeRes.json();

    const listRes = await fetch(backendUrl(`/api/share?docPath=${encodeURIComponent(docPath)}`));
    const links = await listRes.json();
    expect(links.length).toBe(2);

    await fetch(backendUrl(`/api/share/${readUuid}`), { method: 'DELETE' });
    await fetch(backendUrl(`/api/share/${writeUuid}`), { method: 'DELETE' });
  });

  test('share page serves the SPA shell', async () => {
    const res = await fetch(backendUrl('/api/share'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docPath, permission: 'read' }),
    });
    const { uuid } = await res.json();

    const pageRes = await fetch(backendUrl(`/share/${uuid}`));
    expect(pageRes.ok).toBe(true);
    const html = await pageRes.text();
    expect(html.toLowerCase()).toContain('<!doctype html>');

    await fetch(backendUrl(`/api/share/${uuid}`), { method: 'DELETE' });
  });

  test('GET /api/share/<uuid> returns metadata for valid uuid', async () => {
    const res = await fetch(backendUrl('/api/share'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docPath, permission: 'read' }),
    });
    const { uuid } = await res.json();

    const metaRes = await fetch(backendUrl(`/api/share/${uuid}`));
    expect(metaRes.ok).toBe(true);
    const meta = await metaRes.json();
    expect(meta.uuid).toBe(uuid);
    expect(meta.doc_path).toBe(docPath);
    expect(meta.permission).toBe('read');

    await fetch(backendUrl(`/api/share/${uuid}`), { method: 'DELETE' });
  });

  test('revoked share link returns 404 from API', async () => {
    const res = await fetch(backendUrl('/api/share'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docPath, permission: 'read' }),
    });
    const { uuid } = await res.json();
    await fetch(backendUrl(`/api/share/${uuid}`), { method: 'DELETE' });

    const metaRes = await fetch(backendUrl(`/api/share/${uuid}`));
    expect(metaRes.status).toBe(404);
  });

  test('invalid share link returns 404 from API', async () => {
    const res = await fetch(backendUrl(`/api/share/nonexistent`));
    expect(res.status).toBe(404);
  });
});
