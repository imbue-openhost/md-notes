import type { Page } from '@playwright/test';

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:9000';

export function backendUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

export async function createVault(name: string): Promise<string> {
  const res = await fetch(backendUrl('/api/vaults'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create vault "${name}": ${res.status} ${body}`);
  }
  return (await res.json()).name;
}

export async function deleteVault(name: string): Promise<void> {
  await fetch(backendUrl(`/api/vaults/${encodeURIComponent(name)}`), { method: 'DELETE' });
}

export function fileUrl(vaultName: string, path: string): string {
  return backendUrl(`/api/docs/${encodeURIComponent(vaultName)}/file?path=${encodeURIComponent(path)}`);
}

export function listUrl(vaultName: string): string {
  return backendUrl(`/api/docs/${encodeURIComponent(vaultName)}`);
}

export async function createFile(vaultName: string, path: string, content: string): Promise<void> {
  const res = await fetch(fileUrl(vaultName, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to create file: ${res.status}`);
}

export async function openVault(page: Page, vaultName: string, filePath = 'test.md'): Promise<void> {
  await page.goto('/');
  await page.locator('.vault-picker-item-name', { hasText: vaultName }).click();
  await page.locator(`.sidebar-item[data-type="file"][data-path="${filePath}"]`).click();
  await page.waitForSelector('.cm-editor', { timeout: 5000 });
  await page.waitForTimeout(500);
}
