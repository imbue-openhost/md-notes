/**
 * Client-side editor preferences persisted to localStorage.
 *
 * Kept separate from server-stored settings (vimrc) because these are device /
 * browser specific.
 */

const COLLAPSE_HEADERS_DEFAULT_KEY = 'mdnotes-collapse-headers-default';
const EDITOR_KIND_KEY = 'mdnotes-editor-kind';

/**
 * Which editor component to use. 'live-preview' is the default;
 * 'live-preview-vim' is the same editor with vim keybindings.
 * 'live-preview-mobile' is the touch variant used by the mobile shell —
 * never stored as a preference, so it isn't offered in settings.
 */
export type EditorKind = 'live-preview' | 'live-preview-vim' | 'live-preview-mobile';

export function getEditorKind(): EditorKind {
  try {
    return localStorage.getItem(EDITOR_KIND_KEY) === 'live-preview-vim' ? 'live-preview-vim' : 'live-preview';
  } catch {
    return 'live-preview';
  }
}

export function setEditorKind(kind: EditorKind): void {
  try {
    if (kind === 'live-preview-vim') localStorage.setItem(EDITOR_KIND_KEY, kind);
    else localStorage.removeItem(EDITOR_KIND_KEY);
  } catch {
    // localStorage disabled / quota — not fatal.
  }
}

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
export const _internal = { COLLAPSE_HEADERS_DEFAULT_KEY, EDITOR_KIND_KEY };
