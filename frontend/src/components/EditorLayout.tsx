import { createSignal, createEffect, onCleanup, For, Show, type Component } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { EditorInstance } from '../editor/editor';

export interface EditorLayoutHandle {
  openFile: (path: string) => void;
  splitPane: () => void;
}

type CreateEditorFn = (path: string, container: HTMLElement) => EditorInstance;

interface TabState {
  path: string;
  name: string;
}

interface PaneState {
  id: string;
  tabs: TabState[];
  activeTabPath: string | null;
}

interface Props {
  createEditor: CreateEditorFn;
  onActiveFileChange: (path: string | null) => void;
  ref?: (handle: EditorLayoutHandle) => void;
}

let paneIdCounter = 0;
function nextPaneId(): string { return `pane-${++paneIdCounter}`; }

// Imperative state: maps paneId+path to EditorInstance and container
const editorInstances = new Map<string, { instance: EditorInstance; container: HTMLElement }>();
function editorKey(paneId: string, path: string) { return `${paneId}::${path}`; }

export const EditorLayout: Component<Props> = (props) => {
  const initialPaneId = nextPaneId();

  const [panes, setPanes] = createStore<PaneState[]>([
    { id: initialPaneId, tabs: [], activeTabPath: null },
  ]);
  const [activePaneId, setActivePaneId] = createSignal(initialPaneId);

  const handle: EditorLayoutHandle = {
    openFile(path: string) {
      const pane = panes.find((p) => p.id === activePaneId());
      if (!pane) return;

      if (pane.tabs.some((t) => t.path === path)) {
        switchToTab(pane.id, path);
        return;
      }
      addTab(pane.id, path);
    },
    splitPane() {
      doSplitPane();
    },
  };

  props.ref?.(handle);

  onCleanup(() => {
    for (const { instance } of editorInstances.values()) {
      instance.destroy();
    }
    editorInstances.clear();
  });

  function addTab(paneId: string, path: string) {
    const name = path.replace(/\.md$/, '').split('/').pop() || path;

    setPanes(
      (p) => p.id === paneId,
      produce((pane) => {
        pane.tabs.push({ path, name });
        pane.activeTabPath = path;
      }),
    );
  }

  function switchToTab(paneId: string, path: string) {
    setPanes(
      (p) => p.id === paneId,
      'activeTabPath',
      path,
    );

    const entry = editorInstances.get(editorKey(paneId, path));
    if (entry) entry.instance.view.focus();

    props.onActiveFileChange(path);
  }

  function closeTab(paneId: string, path: string) {
    const entry = editorInstances.get(editorKey(paneId, path));
    if (entry) {
      entry.instance.destroy();
      entry.container.remove();
      editorInstances.delete(editorKey(paneId, path));
    }

    const pane = panes.find((p) => p.id === paneId);
    if (!pane) return;

    const tabIndex = pane.tabs.findIndex((t) => t.path === path);
    const wasActive = pane.activeTabPath === path;

    setPanes(
      (p) => p.id === paneId,
      produce((pane) => {
        pane.tabs.splice(tabIndex, 1);
        if (wasActive) {
          if (pane.tabs.length > 0) {
            pane.activeTabPath = pane.tabs[pane.tabs.length - 1].path;
          } else {
            pane.activeTabPath = null;
          }
        }
      }),
    );

    if (wasActive) {
      const updated = panes.find((p) => p.id === paneId)!;
      if (updated.activeTabPath) {
        const e = editorInstances.get(editorKey(paneId, updated.activeTabPath));
        if (e) e.instance.view.focus();
        props.onActiveFileChange(updated.activeTabPath);
      } else if (panes.length > 1) {
        removePane(paneId);
      } else {
        props.onActiveFileChange(null);
      }
    }
  }

  function removePane(paneId: string) {
    for (const [key, { instance }] of editorInstances) {
      if (key.startsWith(`${paneId}::`)) {
        instance.destroy();
        editorInstances.delete(key);
      }
    }

    setPanes((prev) => prev.filter((p) => p.id !== paneId));

    if (activePaneId() === paneId) {
      const remaining = panes.filter((p) => p.id !== paneId);
      if (remaining.length > 0) setActivePaneId(remaining[0].id);
    }
  }

  function doSplitPane() {
    const current = panes.find((p) => p.id === activePaneId());
    const newId = nextPaneId();

    setPanes((prev) => [...prev, { id: newId, tabs: [], activeTabPath: null }]);
    setActivePaneId(newId);

    if (current?.activeTabPath) {
      addTab(newId, current.activeTabPath);
    }
  }

  function mountEditor(paneId: string, path: string, container: HTMLElement) {
    const key = editorKey(paneId, path);
    if (editorInstances.has(key)) return;

    const instance = props.createEditor(path, container);
    editorInstances.set(key, { instance, container });
  }

  return (
    <div id="editor-container">
      <div class="editor-layout">
        <For each={panes}>{(pane, paneIndex) => (
          <>
            <Show when={paneIndex() > 0}>
              <SplitDivider />
            </Show>
            <div
              class="pane"
              classList={{ 'pane-active': pane.id === activePaneId() }}
              onMouseDown={() => setActivePaneId(pane.id)}
            >
              <div class="tab-bar">
                <div class="tab-list">
                  <For each={pane.tabs}>{(tab) => (
                    <div
                      class="tab"
                      classList={{ 'tab-active': tab.path === pane.activeTabPath }}
                      title={tab.path}
                      onClick={() => { setActivePaneId(pane.id); switchToTab(pane.id, tab.path); }}
                      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(pane.id, tab.path); } }}
                    >
                      <span class="tab-label">{tab.name}</span>
                      <span
                        class="tab-close"
                        onClick={(e) => { e.stopPropagation(); closeTab(pane.id, tab.path); }}
                      >&times;</span>
                    </div>
                  )}</For>
                </div>
                <div class="tab-bar-actions">
                  <button
                    class="tab-bar-btn"
                    title="Split pane"
                    onClick={(e) => { e.stopPropagation(); setActivePaneId(pane.id); doSplitPane(); }}
                  >&#x2502;&#x2502;</button>
                </div>
              </div>
              <div class="pane-content">
                <For each={pane.tabs}>{(tab) => (
                  <div
                    class="editor-tab-content"
                    style={{ display: tab.path === pane.activeTabPath ? '' : 'none' }}
                    ref={(el) => mountEditor(pane.id, tab.path, el)}
                  />
                )}</For>
              </div>
            </div>
          </>
        )}</For>
      </div>
    </div>
  );
};

const SplitDivider: Component = () => {
  function onMouseDown(e: MouseEvent) {
    e.preventDefault();
    const divider = e.currentTarget as HTMLElement;
    const layout = divider.parentElement!;
    const layoutRect = layout.getBoundingClientRect();
    const children = [...layout.children].filter((c) => c.classList.contains('pane')) as HTMLElement[];

    const dividerIndex = [...layout.children].indexOf(divider);
    const left = children.filter((c) => [...layout.children].indexOf(c) < dividerIndex);
    const right = children.filter((c) => [...layout.children].indexOf(c) > dividerIndex);
    const leftPane = left[left.length - 1];
    const rightPane = right[0];
    if (!leftPane || !rightPane) return;

    const totalWidth = leftPane.offsetWidth + rightPane.offsetWidth;
    const minWidth = 200;

    const onMove = (ev: MouseEvent) => {
      const x = ev.clientX - layoutRect.left;
      const leftStart = leftPane.offsetLeft;
      let leftWidth = Math.max(minWidth, Math.min(totalWidth - minWidth, x - leftStart));
      leftPane.style.flex = `0 0 ${leftWidth}px`;
      rightPane.style.flex = `0 0 ${totalWidth - leftWidth}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return <div class="split-divider" onMouseDown={onMouseDown} />;
};
