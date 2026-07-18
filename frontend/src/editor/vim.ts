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

import {
  vim,
  Vim,
  type CodeMirrorV,
  type MotionArgs,
  type MotionFn,
  type Pos,
  type vimState,
} from '@replit/codemirror-vim';
import { EditorView } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { unfoldAll, toggleFold, foldCode, unfoldCode } from '@codemirror/language';
import { foldAllRecursive } from './folding';
import { toggleTaskAtSelection, type ActionLineRange } from './tasks';
import { syncAwareUndo, syncAwareRedo } from './undo-redo';

/**
 * Replacement for the built-in `moveByDisplayLines` motion (gj/gk — and j/k
 * when remapped to them, as in the default vimrc).
 *
 * The built-in motion has a CM5-era edge case: when findPosV reports hitSide
 * (cursor clipped at a document edge), it re-derives the target from pixel
 * coordinates via coordsChar, whose CM6 adapter falls back to offset 0 when
 * posAtCoords returns null — so gj with the cursor at the very end of the
 * document teleports it to the top. The CM6 findPosV already returns a
 * properly clamped position, so use it directly.
 *
 * Invoked as a method on codemirror-vim's motions table; `this` is used to
 * recognize whether the previous motion was also vertical, in which case the
 * horizontal goal position (lastHSPos) is preserved.
 */
export function moveByDisplayLines(
  this: unknown,
  cm: CodeMirrorV,
  head: Pos,
  motionArgs: MotionArgs,
  vim: vimState,
): Pos {
  const motions = (this ?? {}) as Record<string, MotionFn | undefined>;
  const verticalMotions = [
    motions.moveByDisplayLines,
    motions.moveByScroll,
    motions.moveByLines,
    motions.moveToColumn,
    motions.moveToEol,
  ];
  if (!vim.lastMotion || !verticalMotions.includes(vim.lastMotion)) {
    vim.lastHSPos = cm.charCoords(head, 'div').left;
  }
  const repeat = motionArgs.repeat;
  const res = cm.findPosV(head, motionArgs.forward ? repeat : -repeat, 'line', vim.lastHSPos);
  vim.lastHPos = res.ch;
  return res;
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
      (other) => other.lhs.length > 1 && other.lhs[0] === m.lhs
        && (other.context === m.context || other.context === '' || m.context === ''),
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

// Override the built-in u/Ctrl-r actions so undo/redo works on synced docs.
Vim.defineAction('undo', (cm: any, actionArgs: any) => {
  for (let i = 0; i < (actionArgs.repeat || 1); i++) {
    syncAwareUndo(cm.cm6);
  }
});

Vim.defineAction('redo', (cm: any, actionArgs: any) => {
  for (let i = 0; i < (actionArgs.repeat || 1); i++) {
    syncAwareRedo(cm.cm6);
  }
});

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

  // Register `m` as a direct delete operator for normal mode (easyclip
  // "cut" key). This can't be done via vimrc keyToKey mapping because
  // codemirror-vim's key matcher fires full matches immediately — a
  // `noremap m d` would always consume `m` before `mm` could match.
  // As a direct operator, `mm` works via processOperator's "same
  // operator twice = linewise" logic, same as the built-in `dd`.
  Vim.mapCommand('m', 'operator', 'delete', {}, {});

  Vim.defineMotion('moveByDisplayLines', moveByDisplayLines);

  return extensions;
}
