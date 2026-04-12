/**
 * REST API client for file operations.
 */

import type { FileEntry } from './types';

let baseUrl = '';

/** Set the API base URL (e.g., "http://localhost:8080"). */
export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, '');
}

/** Auto-detect: if served by the Quart server, baseUrl is empty (same-origin). */
export function getApiBaseUrl(): string {
  return baseUrl;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res;
}

export async function listFiles(): Promise<FileEntry[]> {
  const res = await apiFetch('/api/files');
  return res.json();
}

export async function readFile(path: string): Promise<string> {
  const res = await apiFetch(`/api/files/${encodeURIComponent(path)}`);
  return res.text();
}

export async function createFile(path: string, content = '', type: 'file' | 'dir' = 'file'): Promise<void> {
  await apiFetch(`/api/files/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type }),
  });
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  await apiFetch(`/api/files/${encodeURIComponent(oldPath)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPath }),
  });
}

export async function deleteFile(path: string): Promise<void> {
  await apiFetch(`/api/files/${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
}
