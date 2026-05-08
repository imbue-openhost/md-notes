import { createSignal, createMemo, createResource, onMount, For, Show, type Component } from 'solid-js';
import { Dialog } from '@kobalte/core';
import type { FileEntry } from '../api/types';
import { listFiles } from '../api/vault-ops';

interface Props {
  onSelect: (path: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 10;

function flattenFiles(entries: FileEntry[]): string[] {
  const out: string[] = [];
  function walk(es: FileEntry[]) {
    for (const e of es) {
      if (e.type === 'file') out.push(e.path);
      if (e.children) walk(e.children);
    }
  }
  walk(entries);
  return out;
}

/**
 * Score a path against a query using a weighted subsequence/substring match.
 * Returns null if no match. Higher scores are better.
 *
 * Heuristics:
 *   - Exact substring of full path: big bonus, scaled by tightness.
 *   - Substring match in basename: extra bonus (filename matches matter most).
 *   - Subsequence fallback: rewards consecutive chars and matches at word starts.
 */
function fuzzyScore(query: string, path: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const basename = p.split('/').pop() ?? p;

  let score = 0;
  const subIdx = p.indexOf(q);
  if (subIdx !== -1) {
    score += 1000 - subIdx; // earlier matches score higher
    if (basename.includes(q)) score += 500;
    return score;
  }

  // Subsequence match
  let pi = 0;
  let lastMatch = -1;
  let consecutive = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (pi < p.length) {
      if (p[pi] === ch) { found = pi; pi++; break; }
      pi++;
    }
    if (found === -1) return null;
    if (found === lastMatch + 1) {
      consecutive++;
      score += 10 + consecutive * 5;
    } else {
      consecutive = 0;
      score += 1;
    }
    if (found === 0 || p[found - 1] === '/' || p[found - 1] === '-' || p[found - 1] === '_' || p[found - 1] === ' ' || p[found - 1] === '.') {
      score += 8; // word-start bonus
    }
    lastMatch = found;
  }
  // Prefer shorter paths
  score -= Math.floor(p.length / 4);
  return score;
}

export const QuickOpen: Component<Props> = (props) => {
  const [allFiles] = createResource(async () => flattenFiles(await listFiles()));
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal(0);
  let inputRef!: HTMLInputElement;

  const results = createMemo(() => {
    const files = allFiles() ?? [];
    const q = query();
    const scored: { path: string; score: number }[] = [];
    for (const f of files) {
      const s = fuzzyScore(q, f);
      if (s === null) continue;
      scored.push({ path: f, score: s });
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return scored.slice(0, MAX_RESULTS).map((r) => r.path);
  });

  // Reset selection when results change
  createMemo(() => {
    results();
    setSelected(0);
  });

  onMount(() => inputRef.focus());

  function commit(idx: number) {
    const r = results();
    if (idx < 0 || idx >= r.length) return;
    props.onSelect(r[idx]);
    props.onClose();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const len = results().length;
      if (len > 0) setSelected((s) => (s + 1) % len);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const len = results().length;
      if (len > 0) setSelected((s) => (s - 1 + len) % len);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(selected());
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Dialog.Portal>
        <div class="settings-modal-overlay">
          <Dialog.Content class="quick-open-modal" onInteractOutside={() => props.onClose()}>
            <input
              ref={inputRef}
              class="quick-open-input"
              type="text"
              placeholder="Search files..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            <Show when={results().length > 0} fallback={
              <div class="quick-open-empty">{allFiles.loading ? 'Loading...' : 'No matches'}</div>
            }>
              <ul class="quick-open-list">
                <For each={results()}>
                  {(path, idx) => (
                    <li
                      class="quick-open-item"
                      classList={{ active: idx() === selected() }}
                      onMouseEnter={() => setSelected(idx())}
                      onClick={() => commit(idx())}
                    >
                      {path}
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
