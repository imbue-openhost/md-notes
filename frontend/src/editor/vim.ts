/**
 * Vim mode for CodeMirror 6 via @replit/codemirror-vim.
 *
 * Includes a vimrc parser that supports:
 *   - map / noremap (with optional mode prefixes: nmap, imap, vmap, etc.)
 *   - set option=value / set option / set nooption
 *
 * Supported set options:
 *   number, relativenumber, tabstop, shiftwidth, expandtab, wrap, scrolloff
 */

import { vim, Vim } from '@replit/codemirror-vim';
import { EditorView } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';

// ── Vimrc parser ──────────────────────────────────────────────────────────

/** A parsed map command. */
export interface VimMapping {
  lhs: string;
  rhs: string;
  /** "" = all modes, "normal", "visual", "insert" */
  context: string;
  noremap: boolean;
}

/** A parsed set command. */
export interface VimSetting {
  name: string;
  value: string | number | boolean;
}

export interface VimrcResult {
  mappings: VimMapping[];
  settings: VimSetting[];
}

/**
 * Map from vim command prefixes to context strings expected by
 * @replit/codemirror-vim.
 */
const MODE_MAP: Record<string, string> = {
  map: '',
  noremap: '',
  nmap: 'normal',
  nnoremap: 'normal',
  vmap: 'visual',
  vnoremap: 'visual',
  imap: 'insert',
  inoremap: 'insert',
};

const NOREMAP_CMDS = new Set([
  'noremap', 'nnoremap', 'vnoremap', 'inoremap',
]);

/**
 * Boolean options that can be toggled with `set X` / `set noX`.
 */
const BOOLEAN_OPTIONS = new Set([
  'number', 'relativenumber', 'expandtab', 'wrap',
]);

/**
 * Numeric options that take `set X=N`.
 */
const NUMERIC_OPTIONS = new Set([
  'tabstop', 'shiftwidth', 'scrolloff',
]);

/**
 * Parse a vimrc string into mappings and settings.
 *
 * Ignores blank lines, comment lines (starting with `"`), and
 * unrecognised commands.
 */
export function parseVimrc(content: string): VimrcResult {
  const mappings: VimMapping[] = [];
  const settings: VimSetting[] = [];

  for (const raw of content.split('\n')) {
    const line = raw.trim();

    // Skip blanks and comments
    if (!line || line.startsWith('"')) continue;

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    // ── map / noremap variants ──────────────────────────────────────
    if (cmd in MODE_MAP && parts.length >= 3) {
      mappings.push({
        lhs: parts[1],
        rhs: parts.slice(2).join(' '),
        context: MODE_MAP[cmd],
        noremap: NOREMAP_CMDS.has(cmd),
      });
      continue;
    }

    // ── set ──────────────────────────────────────────────────────────
    if (cmd === 'set' && parts.length >= 2) {
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i];

        // set option=value (numeric)
        const eqMatch = token.match(/^(\w+)=(\d+)$/);
        if (eqMatch) {
          const [, name, val] = eqMatch;
          if (NUMERIC_OPTIONS.has(name)) {
            settings.push({ name, value: parseInt(val, 10) });
          }
          continue;
        }

        // set nooption (boolean off)
        if (token.startsWith('no')) {
          const name = token.slice(2);
          if (BOOLEAN_OPTIONS.has(name)) {
            settings.push({ name, value: false });
          }
          continue;
        }

        // set option (boolean on)
        if (BOOLEAN_OPTIONS.has(token)) {
          settings.push({ name: token, value: true });
          continue;
        }
      }
      continue;
    }
  }

  return { mappings, settings };
}

// ── Apply to editor ───────────────────────────────────────────────────────

/**
 * Apply parsed mappings via Vim.map / Vim.noremap.
 */
export function applyMappings(mappings: VimMapping[]): void {
  for (const m of mappings) {
    if (m.noremap) {
      Vim.noremap(m.lhs, m.rhs, m.context);
    } else {
      Vim.map(m.lhs, m.rhs, m.context);
    }
  }
}

/**
 * Convert parsed settings to CM6 extensions.
 *
 * Some settings (number, relativenumber) are applied via Vim.setOption;
 * others map to CM6 state facets.
 */
export function settingsToExtensions(settings: VimSetting[]): Extension[] {
  const extensions: Extension[] = [];

  for (const s of settings) {
    switch (s.name) {
      case 'number':
        Vim.setOption('number', s.value);
        break;
      case 'relativenumber':
        Vim.setOption('relativenumber', s.value);
        break;
      case 'tabstop':
        extensions.push(EditorState.tabSize.of(s.value as number));
        break;
      case 'shiftwidth':
        Vim.setOption('shiftwidth', s.value);
        break;
      case 'expandtab':
        Vim.setOption('expandtab', s.value);
        break;
      case 'wrap':
        extensions.push(
          s.value ? EditorView.lineWrapping : []
        );
        break;
      case 'scrolloff':
        Vim.setOption('scrolloff', s.value);
        break;
    }
  }

  return extensions;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns the vim mode extension. If vimrc content is provided,
 * it is parsed and the resulting mappings/settings are applied.
 */
export function vimMode(vimrcContent?: string): Extension[] {
  const extensions: Extension[] = [vim({ status: true })];

  if (vimrcContent) {
    const result = parseVimrc(vimrcContent);
    applyMappings(result.mappings);
    extensions.push(...settingsToExtensions(result.settings));
  }

  return extensions;
}
