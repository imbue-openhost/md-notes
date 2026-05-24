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
import { unfoldAll, toggleFold, foldCode, unfoldCode } from '@codemirror/language';
import { foldAllRecursive } from './folding';
import { installVimClipboardSync } from './clipboard-sync';

/**
 * Line range from a parsed `:` ex command. `start` and `end` are 0-based
 * CodeMirror line numbers (matching `params.selectionLine` /
 * `selectionLineEnd` from @replit/codemirror-vim).
 */
export interface ActionLineRange {
  start: number;
  end?: number;
}

/**
 * Toggle bullet/task state across the current selection.
 *
 * Scans every line in the selection that starts with a bullet (`-`, `*`, `+`,
 * or numbered like `1.` / `1)`). Each matched line has one of three statuses,
 * ordered lowest → highest:
 *
 *   bullet (`- foo`)  <  unchecked (`- [ ] foo`)  <  checked (`- [x] foo`)
 *
 * If every matched line shares a status, each advances:
 *   bullet → unchecked, unchecked → checked, checked → unchecked.
 * If the selection mixes statuses, only the lines at the lowest present
 * status advance one step; the rest are left untouched.
 *
 * With no selection (cursor on a single line) this reduces to the
 * single-line toggle behaviour.
 *
 * When invoked from a vim visual-mode mapping, codemirror-vim exits visual
 * mode (clearing the CM selection) before the ex handler runs, so the line
 * range is passed in via `range` instead of read from `state.selection`.
 */
export function toggleTaskAtSelection(view: EditorView, range?: ActionLineRange): boolean {
  const { state } = view;

  let startLineNum: number;
  let endLineNum: number;
  if (range) {
    // 0-based → 1-based for state.doc.line()
    startLineNum = range.start + 1;
    endLineNum = (range.end ?? range.start) + 1;
  } else {
    const sel = state.selection.main;
    const startLine = state.doc.lineAt(sel.from);
    const endLine = state.doc.lineAt(sel.to);
    startLineNum = startLine.number;
    // Visual-line selections often end at the start of the line *after* the
    // last visually-selected line. Don't treat that trailing line as selected.
    endLineNum =
      sel.to > sel.from && sel.to === endLine.from && endLine.number > startLine.number
        ? endLine.number - 1
        : endLine.number;
  }

  type Item = {
    prefixEnd: number;
    marker?: { from: number; to: number; checked: boolean };
  };
  const items: Item[] = [];
  for (let n = startLineNum; n <= endLineNum; n++) {
    const line = state.doc.line(n);
    const text = state.doc.sliceString(line.from, line.to);
    const m = text.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(\[([ xX])\]\s+)?/);
    if (!m) continue;
    const prefixEnd = line.from + m[1].length;
    if (!m[2]) {
      items.push({ prefixEnd });
    } else {
      items.push({
        prefixEnd,
        marker: {
          from: prefixEnd,
          to: prefixEnd + 3,
          checked: m[3] !== ' ',
        },
      });
    }
  }

  if (items.length === 0) return false;

  // 0 = bullet, 1 = unchecked, 2 = checked
  const statusOf = (it: Item) => (!it.marker ? 0 : it.marker.checked ? 2 : 1);
  const statuses = items.map(statusOf);
  const minStatus = Math.min(...statuses);
  const allSame = statuses.every((s) => s === minStatus);

  const changes: { from: number; to: number; insert: string }[] = [];
  for (const it of items) {
    if (!allSame && statusOf(it) !== minStatus) continue;
    if (!it.marker) {
      changes.push({ from: it.prefixEnd, to: it.prefixEnd, insert: '[ ] ' });
    } else if (!it.marker.checked) {
      changes.push({ from: it.marker.from, to: it.marker.to, insert: '[x]' });
    } else {
      // Only reached when every selected item is checked.
      changes.push({ from: it.marker.from, to: it.marker.to, insert: '[ ]' });
    }
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes });
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
type BuiltinAction = (view: EditorView, range?: ActionLineRange) => boolean;

const BUILTIN_ACTIONS: Record<string, BuiltinAction> = {
  'toggle-fold': (view) => toggleFold(view),
  'fold-all': (view) => foldAllRecursive(view),
  'unfold-all': (view) => unfoldAll(view),
  'fold-at-cursor': (view) => foldCode(view),
  'unfold-at-cursor': (view) => unfoldCode(view),
  'toggle-task': (view, range) => toggleTaskAtSelection(view, range),
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
    Vim.defineEx(name, name, (cm: any, params: { selectionLine?: number; selectionLineEnd?: number }) => {
      const range =
        params && typeof params.selectionLine === 'number'
          ? { start: params.selectionLine, end: params.selectionLineEnd }
          : undefined;
      fn(cm.cm6, range);
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
// Operator keys enter operator-pending mode and naturally wait for a
// motion, so `dd`/`cc`/`yy` work without unmapping. Unmapping these
// would destroy the operator binding that noremap rhs keys depend on
// (e.g. `noremap d "_d` needs the built-in `d` operator to exist).
const NATIVE_OPERATORS = new Set(['d', 'c', 'y', '>', '<', '!', '=']);

export function applyMappings(mappings: VimMapping[], mapleader?: string): void {
  // Non-operator built-in keys (like `m` for set-mark, or the leader
  // key) fire immediately on press, consuming the next character before
  // the key matcher can recognize a multi-char mapping. Unmapping the
  // built-in first lets the matcher wait for the full sequence.
  const keysToUnmap = new Set<string>();
  if (mapleader && mapleader.length === 1) {
    const usedAsPrefix = mappings.some(
      (m) => m.lhs.length > 1 && m.lhs.startsWith(mapleader),
    );
    if (usedAsPrefix) keysToUnmap.add(mapleader);
  }
  for (const m of mappings) {
    if (m.lhs.length !== 1) continue;
    if (NATIVE_OPERATORS.has(m.lhs)) continue;
    const isPrefix = mappings.some(
      (other) => other.lhs.length > 1 && other.lhs[0] === m.lhs,
    );
    if (isPrefix) keysToUnmap.add(m.lhs);
  }
  // Pass undefined ctx (despite the .d.ts requiring string): default
  // mappings have no context field, and unmap uses strict equality, so
  // ctx must be undefined to match them.
  for (const key of keysToUnmap) {
    try {
      (Vim.unmap as (lhs: string, ctx?: string) => unknown)(key);
    } catch {}
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
  installVimClipboardSync();
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

  // Register `m` as a direct delete operator for normal mode (easyclip
  // "cut" key). This can't be done via vimrc keyToKey mapping because
  // codemirror-vim's key matcher fires full matches immediately — a
  // `noremap m d` would always consume `m` before `mm` could match.
  // As a direct operator, `mm` works via processOperator's "same
  // operator twice = linewise" logic, same as the built-in `dd`.
  Vim.mapCommand('m', 'operator', 'delete', {}, {});

  return extensions;
}
