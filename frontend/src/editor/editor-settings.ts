/**
 * Client-side editor preferences persisted to localStorage.
 *
 * Kept separate from server-stored settings (vimrc) because these are device /
 * browser specific.
 */

const COLLAPSE_HEADERS_DEFAULT_KEY = 'mdnotes-collapse-headers-default';

export function getCollapseHeadersDefault(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_HEADERS_DEFAULT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setCollapseHeadersDefault(value: boolean): void {
  try {
    if (value) localStorage.setItem(COLLAPSE_HEADERS_DEFAULT_KEY, 'true');
    else localStorage.removeItem(COLLAPSE_HEADERS_DEFAULT_KEY);
  } catch {
    // localStorage disabled / quota — not fatal.
  }
}

// Exported for tests.
export const _internal = { COLLAPSE_HEADERS_DEFAULT_KEY };
