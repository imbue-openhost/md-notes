import { createSignal, createEffect, onMount, onCleanup, For, Show, type Component } from 'solid-js';
import { Dialog } from '@kobalte/core';
import type { SearchHit } from '../api/types';
import { createSearchSession, type SearchSession } from '../api/search-session';
import { serverUrl } from '../config';
import { splitByRanges } from './search-highlight';

interface Props {
  vaultName: string;
  onSelect: (path: string, line: number) => void;
  onClose: () => void;
}

const EXACT_MODE_KEY = 'mdnotes-search-exact';

export const SearchModal: Component<Props> = (props) => {
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<SearchHit[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [sessionError, setSessionError] = createSignal(false);
  const [exactMode, setExactMode] = createSignal(localStorage.getItem(EXACT_MODE_KEY) === '1');
  let inputRef!: HTMLInputElement;
  let listRef: HTMLUListElement | undefined;

  // Every keystroke goes straight to the server; it cancels the superseded
  // scan itself (no client debounce). Results are matched back by id since
  // superseded queries never reply.
  let latestId = 0;
  const session: SearchSession = createSearchSession(
    props.vaultName,
    serverUrl,
    (id, hits) => {
      if (id !== latestId) return;
      setResults(hits);
      setLoading(false);
      setSessionError(false);
    },
    () => {
      setSessionError(true);
      setLoading(false);
    },
  );
  onCleanup(() => session.close());

  createEffect(() => {
    const q = query();
    const exact = exactMode();
    latestId++;
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    session.search(latestId, q, !exact);
  });

  createEffect(() => {
    results();
    setSelected(0);
  });

  // Keep the active row visible while navigating with the keyboard.
  createEffect(() => {
    listRef?.children[selected()]?.scrollIntoView({ block: 'nearest' });
  });

  onMount(() => inputRef.focus());

  function toggleExactMode() {
    const next = !exactMode();
    setExactMode(next);
    try {
      localStorage.setItem(EXACT_MODE_KEY, next ? '1' : '0');
    } catch {}
    inputRef.focus();
  }

  function commit(idx: number) {
    const r = results();
    if (idx < 0 || idx >= r.length) return;
    props.onSelect(r[idx].path, r[idx].line_number);
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

  function emptyMessage(): string {
    if (!query().trim()) return 'Type to search the vault';
    if (loading()) return 'Searching…';
    return sessionError() ? 'Search unavailable — is the server reachable?' : 'No results';
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Dialog.Portal>
        <div class="settings-modal-overlay">
          <Dialog.Content class="quick-open-modal search-modal" onInteractOutside={() => props.onClose()}>
            <div class="search-input-row">
              <input
                ref={inputRef}
                class="quick-open-input"
                type="text"
                placeholder="Search vault..."
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={onKeyDown}
              />
              <button
                class="search-toggle-btn"
                classList={{ active: exactMode() }}
                title="Match case & punctuation"
                onClick={toggleExactMode}
              >Aa</button>
            </div>
            <Show when={results().length > 0} fallback={
              <div class="quick-open-empty">{emptyMessage()}</div>
            }>
              <ul class="search-results" ref={listRef}>
                <For each={results()}>
                  {(hit, idx) => (
                    <li
                      class="search-hit"
                      classList={{ active: idx() === selected() }}
                      onMouseEnter={() => setSelected(idx())}
                      onClick={() => commit(idx())}
                    >
                      <div class="search-hit-snippet">
                        <For each={splitByRanges(hit.text, hit.ranges)}>
                          {(seg) => seg.match
                            ? <mark class="search-hl">{seg.text}</mark>
                            : <>{seg.text}</>}
                        </For>
                      </div>
                      <div class="search-hit-loc">{hit.path}:{hit.line_number}</div>
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
