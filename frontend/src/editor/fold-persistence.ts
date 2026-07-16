/**
 * Persist fold state across page reloads, keyed by vault + file path.
 *
 * Fold ranges are serialized as parent-heading paths (e.g. ["# Design",
 * "## backend"]) rather than character offsets so they survive upstream
 * edits made by other collaborators while the page was closed. On load,
 * each path is re-resolved against the current syntax tree; folds whose
 * heading was removed or renamed silently drop.
 */

import { ViewPlugin, type ViewUpdate, type EditorView } from '@codemirror/view';
import { type Extension, type EditorState } from '@codemirror/state';
import {
  ensureSyntaxTree,
  foldEffect,
  foldedRanges,
  foldable,
  foldState,
} from '@codemirror/language';
import { foldAllRecursive, UNBOUNDED_PARSE_MS } from './folding';
import { getCollapseHeadersDefault } from './editor-settings';

export interface FoldPersistOpts {
  vault: string;
  filePath: string;
}

const STORAGE_PREFIX = 'mdnotes-folds:';
const SAVE_DEBOUNCE_MS = 300;
const PATH_SEP = '\x00';

function storageKey(opts: FoldPersistOpts): string {
  return `${STORAGE_PREFIX}${opts.vault}:${opts.filePath}`;
}

interface HeadingInfo {
  level: number;
  /** Heading line text, trimmed. Used as path segment. */
  text: string;
  lineFrom: number;
  lineTo: number;
  /** Parent-heading path including self. */
  path: string[];
}

/**
 * Walk the syntax tree, build a parent-heading path for every ATXHeading.
 *
 * The classic stack-walk: for each heading, pop ancestors with level >= self,
 * then push self. Path = ancestor stack + self.
 */
function collectHeadings(state: EditorState): HeadingInfo[] {
  // Force the parse to completion (no-op once parsed): a partially parsed doc would yield a truncated heading
  // list, silently dropping folds during both apply and save.
  const tree = ensureSyntaxTree(state, state.doc.length, UNBOUNDED_PARSE_MS);
  if (!tree) throw new Error('fold persistence requires a language parser');
  const result: HeadingInfo[] = [];
  const stack: HeadingInfo[] = [];

  tree.iterate({
    enter: (node) => {
      const m = node.name.match(/^ATXHeading(\d)$/);
      if (!m) return;
      const level = parseInt(m[1], 10);
      const line = state.doc.lineAt(node.from);
      const text = state.doc.sliceString(line.from, line.to).trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const info: HeadingInfo = {
        level,
        text,
        lineFrom: line.from,
        lineTo: line.to,
        path: [...stack.map((h) => h.text), text],
      };
      stack.push(info);
      result.push(info);
      return false;
    },
  });
  return result;
}

function loadPaths(opts: FoldPersistOpts): string[][] {
  try {
    const raw = localStorage.getItem(storageKey(opts));
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((p) => Array.isArray(p) && p.every((s) => typeof s === 'string'));
  } catch {
    return [];
  }
}

/**
 * Distinguishes "user has interacted with folds (key present, even if empty)"
 * from "first time opening this doc" (key absent). The collapse-by-default
 * preference only kicks in for the latter — once a user has explicitly
 * unfolded everything, that empty state should stick.
 */
function hasStoredState(opts: FoldPersistOpts): boolean {
  try {
    return localStorage.getItem(storageKey(opts)) !== null;
  } catch {
    return false;
  }
}

function savePaths(opts: FoldPersistOpts, paths: string[][]): void {
  try {
    const key = storageKey(opts);
    if (paths.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(paths));
  } catch {
    // localStorage disabled / quota — not fatal.
  }
}

function currentFoldedPaths(state: EditorState): string[][] {
  const field = state.field(foldState, false);
  if (!field || field.size === 0) return [];

  const headings = collectHeadings(state);
  const byFoldStart = new Map<number, string[]>();
  for (const h of headings) byFoldStart.set(h.lineTo, h.path);

  const result: string[][] = [];
  field.between(0, state.doc.length, (from) => {
    const path = byFoldStart.get(from);
    if (path) result.push(path);
  });
  return result;
}

function applyPaths(view: EditorView, paths: string[][]): void {
  if (paths.length === 0) return;
  const headings = collectHeadings(view.state);
  const byPath = new Map<string, HeadingInfo>();
  for (const h of headings) byPath.set(h.path.join(PATH_SEP), h);

  const effects = [];
  for (const p of paths) {
    const h = byPath.get(p.join(PATH_SEP));
    if (!h) continue;
    const range = foldable(view.state, h.lineFrom, h.lineTo);
    if (!range) continue;
    effects.push(foldEffect.of(range));
  }
  if (effects.length) view.dispatch({ effects });
}

class FoldPersistencePlugin {
  private applied = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private view: EditorView, private opts: FoldPersistOpts) {}

  update(u: ViewUpdate) {
    // First hydration: doc was empty (or unparsed) and now has headings.
    // Apply saved folds once and stop trying.
    if (!this.applied && u.state.doc.length > 0) {
      const headings = collectHeadings(u.state);
      if (headings.length > 0) {
        this.applied = true;
        if (hasStoredState(this.opts)) {
          const paths = loadPaths(this.opts);
          if (paths.length > 0) {
            // Defer dispatch — can't dispatch synchronously from inside update().
            queueMicrotask(() => applyPaths(this.view, paths));
          }
        } else if (getCollapseHeadersDefault()) {
          // No prior fold state for this doc. Apply the user's
          // collapse-by-default preference.
          queueMicrotask(() => foldAllRecursive(this.view));
        }
      }
    }

    if (!this.applied) return;

    const prev = u.startState.field(foldState, false);
    const next = u.state.field(foldState, false);
    if (prev === next) return;

    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      savePaths(this.opts, currentFoldedPaths(this.view.state));
    }, SAVE_DEBOUNCE_MS);
  }

  destroy() {
    // Flush a pending debounce so a fold-then-immediately-close-tab still saves.
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (this.applied) savePaths(this.opts, currentFoldedPaths(this.view.state));
    }
  }
}

export function foldPersistence(opts: FoldPersistOpts): Extension {
  return ViewPlugin.define((view) => new FoldPersistencePlugin(view, opts));
}

// Exported for tests.
export const _internal = {
  collectHeadings,
  currentFoldedPaths,
  applyPaths,
  storageKey,
  hasStoredState,
  loadPaths,
};
