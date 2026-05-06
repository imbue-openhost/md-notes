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
import { unfoldAll, toggleFold, foldCode, unfoldCode, syntaxTree } from '@codemirror/language';
import { foldAllRecursive } from './folding';

function toggleTaskAtCursor(view: EditorView): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const tree = syntaxTree(state);

  let from = -1;
  let to = -1;
  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (from !== -1) return false;
      if (node.name === 'TaskMarker') {
        from = node.from;
        to = node.to;
        return false;
      }
    },
  });

  if (from !== -1) {
    const checked = /^\[[xX]\]$/.test(state.doc.sliceString(from, to));
    view.dispatch({
      changes: { from, to, insert: checked ? '[ ]' : '[x]' },
    });
    return true;
  }

  // No TaskMarker: if this is a bullet/numbered list item, insert `[ ] `
  // right after the bullet.
  const lineText = state.doc.sliceString(line.from, line.to);
  const bulletMatch = lineText.match(/^\s*(?:[-*+]|\d+[.)])\s+/);
  if (!bulletMatch) return false;
  const insertAt = line.from + bulletMatch[0].length;
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: '[ ] ' },
  });
  return true;
}

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

export interface VimExmap {
  name: string;
  action: string;
}

export interface VimrcResult {
  mappings: VimMapping[];
  settings: VimSetting[];
  exmaps: VimExmap[];
  errors: string[];
  mapleader: string;
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
  xmap: 'visual',    // xmap = visual mode (like vmap)
  xnoremap: 'visual',
  imap: 'insert',
  inoremap: 'insert',
};

const NOREMAP_CMDS = new Set([
  'noremap', 'nnoremap', 'vnoremap', 'xnoremap', 'inoremap',
]);

/**
 * Boolean options that can be toggled with `set X` / `set noX`.
 */
const BOOLEAN_OPTIONS = new Set([
  'number', 'relativenumber', 'expandtab', 'wrap',
  'ignorecase', 'smartcase', 'incsearch',
]);

/**
 * Numeric options that take `set X=N`.
 */
const NUMERIC_OPTIONS = new Set([
  'tabstop', 'shiftwidth', 'scrolloff',
]);

/**
 * Built-in editor actions that can be bound via `exmap`.
 *
 * Usage in vimrc:
 *   exmap togglefold toggle-fold
 *   nmap za :togglefold<CR>
 */
const BUILTIN_ACTIONS: Record<string, (view: EditorView) => boolean> = {
  'toggle-fold': (view) => toggleFold(view),
  'fold-all': (view) => foldAllRecursive(view),
  'unfold-all': (view) => unfoldAll(view),
  'fold-at-cursor': (view) => foldCode(view),
  'unfold-at-cursor': (view) => unfoldCode(view),
  'toggle-task': (view) => toggleTaskAtCursor(view),
};

/**
 * Parse a vimrc string into mappings and settings.
 *
 * Ignores blank lines, comment lines (starting with `"`), and
 * unrecognised commands.
 */
export function parseVimrc(content: string): VimrcResult {
  const mappings: VimMapping[] = [];
  const settings: VimSetting[] = [];
  const exmaps: VimExmap[] = [];
  const errors: string[] = [];
  let mapleader = '\\';  // vim default leader

  const lines = content.split('\n');
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum].trim();

    // Skip blanks and comments
    if (!line || line.startsWith('"')) continue;

    const parts = line.split(/\s+/);
    // Strip leading colon (`:inoremap` → `inoremap`)
    const cmd = parts[0].replace(/^:/, '');

    // ── let mapleader ───────────────────────────────────────────────
    if (cmd === 'let') {
      if (parts.length >= 3 && parts[1] === 'mapleader') {
        const rhs = parts.slice(2).join(' ').replace(/^=\s*/, '');
        mapleader = rhs.replace(/^["']|["']$/g, '');
      } else {
        errors.push(`vimrc:${lineNum + 1}: unsupported let command: ${line}`);
      }
      continue;
    }

    // ── exmap — define ex commands bound to built-in actions ────────
    if (cmd === 'exmap') {
      if (parts.length >= 3) {
        const name = parts[1];
        const action = parts.slice(2).join(' ');
        if (action in BUILTIN_ACTIONS) {
          exmaps.push({ name, action });
        } else {
          errors.push(`vimrc:${lineNum + 1}: unknown action '${action}'. Available: ${Object.keys(BUILTIN_ACTIONS).join(', ')}`);
        }
      } else {
        errors.push(`vimrc:${lineNum + 1}: exmap needs a name and action: ${line}`);
      }
      continue;
    }

    // ── map / noremap variants ──────────────────────────────────────
    if (cmd in MODE_MAP) {
      if (parts.length >= 3) {
        const lhs = parts[1].replace(/<[Ll]eader>/g, mapleader);
        const rhs = parts.slice(2).join(' ').replace(/<[Ll]eader>/g, mapleader);
        mappings.push({
          lhs,
          rhs,
          context: MODE_MAP[cmd],
          noremap: NOREMAP_CMDS.has(cmd),
        });
      } else {
        errors.push(`vimrc:${lineNum + 1}: map command needs lhs and rhs: ${line}`);
      }
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
          } else {
            errors.push(`vimrc:${lineNum + 1}: unsupported set option: ${name}`);
          }
          continue;
        }

        // set option+=value (skip with no error — vim syntax we don't need)
        if (token.includes('+=') || token.includes('-=')) {
          continue;
        }

        // set nooption (boolean off)
        if (token.startsWith('no')) {
          const name = token.slice(2);
          if (BOOLEAN_OPTIONS.has(name)) {
            settings.push({ name, value: false });
          } else {
            errors.push(`vimrc:${lineNum + 1}: unsupported set option: ${token}`);
          }
          continue;
        }

        // set option (boolean on)
        if (BOOLEAN_OPTIONS.has(token)) {
          settings.push({ name: token, value: true });
          continue;
        }

        errors.push(`vimrc:${lineNum + 1}: unsupported set option: ${token}`);
      }
      continue;
    }

    // Unrecognised command
    errors.push(`vimrc:${lineNum + 1}: unsupported command: ${line}`);
  }

  return { mappings, settings, exmaps, errors, mapleader };
}

// ── Apply to editor ───────────────────────────────────────────────────────

/**
 * Register ex commands from exmap declarations via Vim.defineEx.
 */
export function applyExmaps(exmaps: VimExmap[]): void {
  for (const { name, action } of exmaps) {
    const fn = BUILTIN_ACTIONS[action];
    if (!fn) continue;
    Vim.defineEx(name, name, (cm: any) => {
      fn(cm.cm6);
    });
  }
}

/**
 * Apply parsed mappings via Vim.map / Vim.noremap.
 *
 * If any mapping uses `mapleader` as a prefix, also unmap the leader's
 * default action so it doesn't shadow the leader-prefixed sequence.
 * codemirror-vim's matcher returns the first *full* match before
 * checking partial matches, so e.g. typing `,` triggers the default
 * `,` (repeat-char-search-reverse) before the buffered `,x` mapping
 * has a chance to match.
 */
export function applyMappings(mappings: VimMapping[], mapleader?: string): void {
  if (mapleader && mapleader.length === 1) {
    const usedAsPrefix = mappings.some(
      (m) => m.lhs.length > 1 && m.lhs.startsWith(mapleader),
    );
    // Pass undefined ctx (despite the .d.ts requiring string): default
    // mappings have no context field, and unmap uses strict equality, so
    // ctx must be undefined to match them.
    if (usedAsPrefix) (Vim.unmap as (lhs: string, ctx?: string) => unknown)(mapleader);
  }
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
      case 'ignorecase':
      case 'smartcase':
      case 'incsearch':
        // These are handled by the vim plugin directly
        Vim.setOption(s.name, s.value);
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
    for (const err of result.errors) {
      console.error(err);
    }
    applyExmaps(result.exmaps);
    applyMappings(result.mappings, result.mapleader);
    extensions.push(...settingsToExtensions(result.settings));
  }

  return extensions;
}
