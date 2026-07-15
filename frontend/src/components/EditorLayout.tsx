import { createSignal, onMount, onCleanup, Show, type Component } from 'solid-js';
import {
  DockviewSolid,
  themeLight,
  type DockviewApi,
  type DockviewGroupPanel,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
  type DockviewReadyEvent,
} from '@arminmajerie/dockview-solid';
import '@arminmajerie/dockview-solid/dist/styles/dockview.css';
import { EditorView } from '@codemirror/view';
import type { EditorInstance } from '../editor/editor';

export interface EditorLayoutHandle {
  openFile: (path: string) => void;
  openFileAt: (path: string, line: number) => void;
  splitPane: () => void;
  toggleCollapseActivePane: () => void;
  focusGroupLeft: () => void;
  focusGroupRight: () => void;
  focusTabLeft: () => void;
  focusTabRight: () => void;
}

type CreateEditorFn = (
  path: string,
  container: HTMLElement,
  onSyncFailed: (error: Error) => void,
) => EditorInstance;

interface Props {
  createEditor: CreateEditorFn;
  onActiveFileChange: (path: string | null) => void;
  /** Notified when a panel's initial sync handshake fails. Caller decides
   * what UI to surface (e.g. a "can't reach backend" modal). The panel is
   * closed before this fires. */
  onSyncFailed?: (path: string, error: Error) => void;
  vaultName: string;
  ref?: (handle: EditorLayoutHandle) => void;
}

let panelCounter = 0;

const editorInstances = new Map<string, EditorInstance>();
const panelScrollTops = new Map<string, number>();
// Line to jump to once a freshly created panel's editor has synced, keyed by panel id.
const pendingJumps = new Map<string, number>();

function jumpToLine(panelId: string, instance: EditorInstance, line: number) {
  // The panel may have been closed while we awaited sync.
  if (editorInstances.get(panelId) !== instance) return;
  const { view } = instance;
  // The search result came from disk, which can lag the live doc — clamp.
  const n = Math.max(1, Math.min(line, view.state.doc.lines));
  const pos = view.state.doc.line(n).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  view.focus();
}

function layoutStorageKey(vaultName: string): string {
  return `mdnotes-layout-${vaultName}`;
}

function collapsedStorageKey(vaultName: string): string {
  return `mdnotes-collapsed-${vaultName}`;
}

const COLLAPSED_PANE_WIDTH = 28;
// Dockview's default group minimum width, restored on expand.
const GROUP_MIN_WIDTH = 100;

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
  let containerEl!: HTMLDivElement;

  const [groupCount, setGroupCount] = createSignal(1);
  const collapsedIds = new Set<string>();
  const expandedWidths = new Map<string, number>(); // group id -> width to restore on expand
  // Scroll position of a collapsed group's visible editor. display:none zeroes the scroller's
  // scrollTop, so it's snapshotted at collapse time and restored on expand.
  const collapsedScrollTops = new Map<string, number>();
  const strips = new Map<string, { el: HTMLElement; dispose: () => void }>();

  function paneSide(group: DockviewGroupPanel): 'left' | 'right' {
    const rect = group.element.getBoundingClientRect();
    const container = containerEl.getBoundingClientRect();
    return rect.left + rect.width / 2 < container.left + container.width / 2 ? 'left' : 'right';
  }

  function mountStrip(group: DockviewGroupPanel) {
    const strip = document.createElement('div');
    strip.className = 'pane-collapsed-strip';
    strip.title = 'Expand pane';
    const chevron = document.createElement('span');
    chevron.className = 'pane-collapsed-chevron';
    chevron.textContent = paneSide(group) === 'left' ? '»' : '«';
    const label = document.createElement('span');
    label.className = 'pane-collapsed-label';
    const updateLabel = () => { label.textContent = group.activePanel?.title ?? ''; };
    updateLabel();
    const titleDisp = group.api.onDidActivePanelChange(updateLabel);
    strip.append(chevron, label);
    strip.addEventListener('click', () => expandGroup(group));
    group.element.appendChild(strip);
    strips.set(group.id, { el: strip, dispose: () => titleDisp.dispose() });
  }

  function removeStrip(groupId: string) {
    const strip = strips.get(groupId);
    if (!strip) return;
    strip.dispose();
    strip.el.remove();
    strips.delete(groupId);
  }

  function applyCollapse(group: DockviewGroupPanel) {
    collapsedIds.add(group.id);
    const active = group.activePanel;
    if (active) {
      const instance = editorInstances.get(active.id);
      if (instance) collapsedScrollTops.set(active.id, instance.view.scrollDOM.scrollTop);
    }
    group.api.setConstraints({ minimumWidth: COLLAPSED_PANE_WIDTH, maximumWidth: COLLAPSED_PANE_WIDTH });
    group.api.setSize({ width: COLLAPSED_PANE_WIDTH });
    group.element.classList.add('pane-collapsed');
    mountStrip(group);
  }

  function collapseGroup(group: DockviewGroupPanel) {
    if (!api || collapsedIds.has(group.id)) return;
    const expanded = api.groups.filter((g) => !collapsedIds.has(g.id));
    if (expanded.length < 2) return; // always keep one pane usable
    expandedWidths.set(group.id, group.width);
    applyCollapse(group);
    api.groups.find((g) => !collapsedIds.has(g.id))?.api.setActive();
    persistCollapsed();
  }

  function expandGroup(group: DockviewGroupPanel, focus = true) {
    if (!collapsedIds.has(group.id)) return;
    collapsedIds.delete(group.id);
    removeStrip(group.id);
    group.element.classList.remove('pane-collapsed');
    group.api.setConstraints({ minimumWidth: GROUP_MIN_WIDTH, maximumWidth: Number.POSITIVE_INFINITY });
    const width = expandedWidths.get(group.id);
    if (width !== undefined) group.api.setSize({ width });
    expandedWidths.delete(group.id);
    const active = group.activePanel;
    if (active) {
      const saved = collapsedScrollTops.get(active.id);
      const instance = editorInstances.get(active.id);
      if (saved !== undefined && instance) {
        panelScrollTops.set(active.id, saved);
        requestAnimationFrame(() => { instance.view.scrollDOM.scrollTop = saved; });
      }
      collapsedScrollTops.delete(active.id);
    }
    if (focus) group.api.setActive();
    persistCollapsed();
  }

  function persistCollapsed() {
    try {
      const data: Record<string, number> = {};
      for (const id of collapsedIds) data[id] = expandedWidths.get(id) ?? GROUP_MIN_WIDTH * 4;
      localStorage.setItem(collapsedStorageKey(props.vaultName), JSON.stringify(data));
    } catch {}
  }

  function restoreCollapsed() {
    if (!api) return;
    let data: Record<string, number>;
    try {
      const raw = localStorage.getItem(collapsedStorageKey(props.vaultName));
      if (!raw) return;
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const saved = api.groups.filter((g) => data[g.id] !== undefined);
    // Never restore into a state where every pane is collapsed.
    const toCollapse = saved.length < api.groups.length ? saved : saved.slice(1);
    for (const group of toCollapse) {
      expandedWidths.set(group.id, data[group.id]);
      applyCollapse(group);
    }
    const active = api.activeGroup;
    if (active && collapsedIds.has(active.id)) {
      api.groups.find((g) => !collapsedIds.has(g.id))?.api.setActive();
    }
    persistCollapsed();
  }

  function PaneHeaderActions(actionProps: IDockviewHeaderActionsProps) {
    const [side, setSide] = createSignal<'left' | 'right'>('right');
    onMount(() => {
      const update = () => setSide(paneSide(actionProps.group));
      update();
      const disp = actionProps.containerApi.onDidLayoutChange(update);
      onCleanup(() => disp.dispose());
    });
    return (
      <Show when={groupCount() > 1}>
        <button
          class="pane-collapse-btn"
          title="Collapse pane"
          onClick={() => collapseGroup(actionProps.group)}
        >
          {side() === 'left' ? '«' : '»'}
        </button>
      </Show>
    );
  }

  function openPanel(path: string, line?: number) {
    if (!api) return;
    for (const panel of api.panels) {
      if ((panel.params as any)?.filePath === path) {
        if (line !== undefined) {
          const instance = editorInstances.get(panel.id);
          if (instance) {
            // Suppress the visibility-restore scroll (it would race the jump
            // and yank the view back to the pre-jump position).
            panelScrollTops.delete(panel.id);
            collapsedScrollTops.delete(panel.id);
            instance.ready.then(() => jumpToLine(panel.id, instance, line));
          } else {
            // Panel exists but its editor hasn't mounted yet (e.g. layout
            // just restored); let onMount perform the jump.
            pendingJumps.set(panel.id, line);
          }
        }
        panel.api.setActive();
        return;
      }
    }
    const panelId = `file-${++panelCounter}`;
    if (line !== undefined) pendingJumps.set(panelId, line);
    const name = path.replace(/\.md$/, '').split('/').pop() || path;
    api.addPanel({
      id: panelId,
      component: 'editor',
      title: name,
      params: { filePath: path },
    });
  }

  const handle: EditorLayoutHandle = {
    openFile(path: string) {
      openPanel(path);
    },
    openFileAt(path: string, line: number) {
      openPanel(path, line);
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
    toggleCollapseActivePane() {
      if (!api) return;
      const group = api.activeGroup;
      if (!group) return;
      if (collapsedIds.has(group.id)) expandGroup(group);
      else collapseGroup(group);
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
      const filePath = panelProps.params.filePath;
      const instance = props.createEditor(filePath, container, (err) => {
        // Close the panel first, then notify the host. Closing first means
        // the host's UI (e.g. a modal) is the only thing left on screen and
        // the user doesn't have to dismiss a dead editor pane.
        try { panelProps.api.close(); } catch {}
        props.onSyncFailed?.(filePath, err);
      });
      const panelId = panelProps.api.id;
      editorInstances.set(panelId, instance);

      const pendingLine = pendingJumps.get(panelId);
      if (pendingLine !== undefined) {
        pendingJumps.delete(panelId);
        instance.ready.then(() => jumpToLine(panelId, instance, pendingLine));
      }

      // Capture scroll on every scroll event. Reading scrollTop in
      // onDidActivePanelChange is unreliable — by then dockview may have
      // already detached the panel DOM, leaving scrollTop at 0.
      const scrollDOM = instance.view.scrollDOM;
      const onScroll = () => panelScrollTops.set(panelId, scrollDOM.scrollTop);
      scrollDOM.addEventListener('scroll', onScroll, { passive: true });

      // Restore scroll when the panel becomes visible again. Dockview
      // detaches/reattaches the panel DOM on tab switches, which resets
      // scrollTop to 0.
      const restoreScroll = () => {
        const saved = panelScrollTops.get(panelId);
        if (saved === undefined) return;
        requestAnimationFrame(() => {
          scrollDOM.scrollTop = saved;
        });
      };
      const visDisp = panelProps.api.onDidVisibilityChange((e) => {
        if (e.isVisible) restoreScroll();
      });

      onCleanup(() => {
        scrollDOM.removeEventListener('scroll', onScroll);
        visDisp.dispose();
      });
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

    api.onDidActivePanelChange((panel) => {
      props.onActiveFileChange((panel?.params as any)?.filePath ?? null);
      if (panel) {
        const entry = editorInstances.get(panel.id);
        if (entry?.view) {
          requestAnimationFrame(() => entry.view.focus());
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
      collapsedScrollTops.delete(panel.id);
    });

    const updateGroupCount = () => setGroupCount(api!.groups.length);
    api.onDidAddGroup(updateGroupCount);
    api.onDidRemoveGroup((group) => {
      updateGroupCount();
      removeStrip(group.id);
      if (collapsedIds.delete(group.id)) {
        expandedWidths.delete(group.id);
        persistCollapsed();
      }
      // If closing the last expanded pane left only collapsed ones, bring them back.
      const groups = api!.groups;
      if (groups.length > 0 && groups.every((g) => collapsedIds.has(g.id))) {
        groups.forEach((g) => expandGroup(g, false));
      }
    });
    // Focusing a collapsed pane (e.g. ctrl+h/l group navigation) brings it back.
    api.onDidActiveGroupChange((group) => {
      if (group && collapsedIds.has(group.id)) expandGroup(group, false);
    });

    try {
      const saved = localStorage.getItem(layoutStorageKey(props.vaultName));
      if (saved) {
        api.fromJSON(JSON.parse(saved));
        syncPanelCounter(api);
        restoreCollapsed();
      }
    } catch {}
    updateGroupCount();

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
    pendingJumps.clear();
  });

  return (
    <div id="editor-container" ref={containerEl}>
      <DockviewSolid
        theme={themeLight}
        components={{ editor: EditorPanel }}
        rightHeaderActionsComponent={PaneHeaderActions}
        onReady={handleReady}
      />
    </div>
  );
};
