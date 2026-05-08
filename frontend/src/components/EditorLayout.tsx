import { onMount, onCleanup, type Component } from 'solid-js';
import {
  DockviewSolid,
  themeLight,
  type DockviewApi,
  type IDockviewPanelProps,
  type DockviewReadyEvent,
} from '@arminmajerie/dockview-solid';
import '@arminmajerie/dockview-solid/dist/styles/dockview.css';
import type { EditorInstance } from '../editor/editor';

export interface EditorLayoutHandle {
  openFile: (path: string) => void;
  splitPane: () => void;
  focusGroupLeft: () => void;
  focusGroupRight: () => void;
  focusTabLeft: () => void;
  focusTabRight: () => void;
}

type CreateEditorFn = (path: string, container: HTMLElement) => EditorInstance;

interface Props {
  createEditor: CreateEditorFn;
  onActiveFileChange: (path: string | null) => void;
  vaultName: string;
  ref?: (handle: EditorLayoutHandle) => void;
}

let panelCounter = 0;

const editorInstances = new Map<string, EditorInstance>();
const panelScrollTops = new Map<string, number>();

function layoutStorageKey(vaultName: string): string {
  return `mdnotes-layout-${vaultName}`;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function saveLayout(api: DockviewApi, vaultName: string) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(layoutStorageKey(vaultName), JSON.stringify(api.toJSON()));
    } catch {}
  }, 500);
}

function syncPanelCounter(api: DockviewApi) {
  let max = panelCounter;
  for (const panel of api.panels) {
    const m = panel.id.match(/^file-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  panelCounter = max;
}

export const EditorLayout: Component<Props> = (props) => {
  let api: DockviewApi | undefined;

  const handle: EditorLayoutHandle = {
    openFile(path: string) {
      if (!api) return;
      for (const panel of api.panels) {
        if ((panel.params as any)?.filePath === path) {
          panel.api.setActive();
          return;
        }
      }
      const panelId = `file-${++panelCounter}`;
      const name = path.replace(/\.md$/, '').split('/').pop() || path;
      api.addPanel({
        id: panelId,
        component: 'editor',
        title: name,
        params: { filePath: path },
      });
    },
    splitPane() {
      if (!api) return;
      const active = api.activePanel;
      if (!active) return;
      const filePath = (active.params as any)?.filePath;
      if (!filePath) return;
      const panelId = `file-${++panelCounter}`;
      const name = filePath.replace(/\.md$/, '').split('/').pop() || filePath;
      api.addPanel({
        id: panelId,
        component: 'editor',
        title: name,
        params: { filePath },
        position: { referencePanel: active, direction: 'right' },
      });
    },
    focusGroupLeft() {
      if (!api) return;
      const groups = api.groups;
      const idx = groups.findIndex((g) => g.api.isActive);
      if (idx > 0) groups[idx - 1].api.setActive();
    },
    focusGroupRight() {
      if (!api) return;
      const groups = api.groups;
      const idx = groups.findIndex((g) => g.api.isActive);
      if (idx >= 0 && idx < groups.length - 1) groups[idx + 1].api.setActive();
    },
    focusTabLeft() {
      if (!api) return;
      const group = api.activeGroup;
      if (!group) return;
      const panels = group.panels;
      const active = group.activePanel;
      if (!active || panels.length < 2) return;
      const idx = panels.indexOf(active);
      if (idx > 0) panels[idx - 1].api.setActive();
    },
    focusTabRight() {
      if (!api) return;
      const group = api.activeGroup;
      if (!group) return;
      const panels = group.panels;
      const active = group.activePanel;
      if (!active || panels.length < 2) return;
      const idx = panels.indexOf(active);
      if (idx < panels.length - 1) panels[idx + 1].api.setActive();
    },
  };

  props.ref?.(handle);

  function EditorPanel(panelProps: IDockviewPanelProps<{ filePath: string }>) {
    let container!: HTMLDivElement;

    onMount(() => {
      const instance = props.createEditor(panelProps.params.filePath, container);
      editorInstances.set(panelProps.api.id, instance);
    });

    onCleanup(() => {
      const instance = editorInstances.get(panelProps.api.id);
      if (instance) {
        instance.destroy();
        editorInstances.delete(panelProps.api.id);
      }
    });

    return <div ref={container} style={{ width: '100%', height: '100%' }} />;
  }

  function handleReady(event: DockviewReadyEvent) {
    api = event.api;

    let lastActivePanelId: string | undefined;

    api.onDidActivePanelChange((panel) => {
      // Save scroll position of the panel we're leaving so it can be restored later.
      if (lastActivePanelId && lastActivePanelId !== panel?.id) {
        const prev = editorInstances.get(lastActivePanelId);
        if (prev?.view) {
          panelScrollTops.set(lastActivePanelId, prev.view.scrollDOM.scrollTop);
        }
      }
      lastActivePanelId = panel?.id;

      props.onActiveFileChange((panel?.params as any)?.filePath ?? null);
      if (panel) {
        const entry = editorInstances.get(panel.id);
        if (entry?.view) {
          // Restore on next frame: dockview may detach/reattach the panel DOM,
          // which resets CM6's scrollDOM scrollTop to 0.
          const saved = panelScrollTops.get(panel.id);
          requestAnimationFrame(() => {
            entry.view.focus();
            if (saved !== undefined) {
              entry.view.scrollDOM.scrollTop = saved;
            }
          });
        }
      }
    });

    api.onDidRemovePanel((panel) => {
      const instance = editorInstances.get(panel.id);
      if (instance) {
        instance.destroy();
        editorInstances.delete(panel.id);
      }
      panelScrollTops.delete(panel.id);
    });

    try {
      const saved = localStorage.getItem(layoutStorageKey(props.vaultName));
      if (saved) {
        api.fromJSON(JSON.parse(saved));
        syncPanelCounter(api);
      }
    } catch {}

    api.onDidLayoutChange(() => saveLayout(api!, props.vaultName));
  }

  onCleanup(() => {
    // api.dispose() cascades through onDidRemovePanel -> destroy each editor instance.
    // Dockview's own teardown can throw "resource already disposed" from internal
    // double-dispose paths; swallow so the unmount completes and the picker can render.
    try {
      api?.dispose();
    } catch (e) {
      console.warn('dockview dispose threw:', e);
    }
    editorInstances.clear();
    panelScrollTops.clear();
  });

  return (
    <div id="editor-container">
      <DockviewSolid
        theme={themeLight}
        components={{ editor: EditorPanel }}
        onReady={handleReady}
      />
    </div>
  );
};
