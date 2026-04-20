/**
 * Editor layout — manages split panes, each with its own tab bar.
 *
 * Layout structure:
 *   .editor-layout
 *     .pane
 *       .tab-bar
 *         .tab .tab .tab ...
 *         .tab-bar-actions
 *       .pane-content
 *         [EditorView containers, one visible at a time]
 *     .split-divider
 *     .pane
 *       ...
 */

import type { EditorInstance } from '../editor/editor';

interface Tab {
  path: string;
  name: string;
  instance: EditorInstance;
  container: HTMLElement;
  tabEl: HTMLElement;
}

interface Pane {
  id: string;
  tabs: Map<string, Tab>;
  activeTabPath: string | null;
  element: HTMLElement;
  tabBar: HTMLElement;
  contentArea: HTMLElement;
}

export type CreateEditorFn = (path: string, container: HTMLElement) => EditorInstance;

let panes: Pane[] = [];
let activePaneId: string | null = null;
let layoutEl: HTMLElement | null = null;
let createEditorForPath: CreateEditorFn | null = null;
let onActiveFileChange: ((path: string | null) => void) | null = null;

let paneIdCounter = 0;
function nextPaneId(): string {
  return `pane-${++paneIdCounter}`;
}

export interface LayoutOptions {
  createEditor: CreateEditorFn;
  onActiveFileChange?: (path: string | null) => void;
}

export function createLayout(parent: HTMLElement, opts: LayoutOptions): HTMLElement {
  createEditorForPath = opts.createEditor;
  onActiveFileChange = opts.onActiveFileChange ?? null;

  layoutEl = document.createElement('div');
  layoutEl.className = 'editor-layout';

  const pane = createPane();
  panes.push(pane);
  activePaneId = pane.id;
  layoutEl.appendChild(pane.element);

  parent.appendChild(layoutEl);
  return layoutEl;
}

export function destroyLayout(): void {
  for (const pane of panes) {
    for (const tab of pane.tabs.values()) {
      tab.instance.destroy();
    }
  }
  panes = [];
  activePaneId = null;
  layoutEl?.remove();
  layoutEl = null;
}

export function openFile(path: string): void {
  const pane = getActivePane();
  if (!pane) return;

  const existing = pane.tabs.get(path);
  if (existing) {
    switchToTab(pane, path);
    return;
  }

  addTab(pane, path);
}

export function getActivePath(): string | null {
  const pane = getActivePane();
  return pane?.activeTabPath ?? null;
}

export function splitPane(): void {
  if (!layoutEl) return;
  const current = getActivePane();
  if (!current) return;

  const newPane = createPane();
  panes.push(newPane);

  const divider = createDivider();

  layoutEl.appendChild(divider);
  layoutEl.appendChild(newPane.element);

  setActivePane(newPane.id);

  if (current.activeTabPath) {
    openFile(current.activeTabPath);
  }
}

// ── Internal ────────────────────────────────────────────────────────────

function getActivePane(): Pane | undefined {
  return panes.find((p) => p.id === activePaneId);
}

function setActivePane(id: string): void {
  activePaneId = id;
  for (const pane of panes) {
    pane.element.classList.toggle('pane-active', pane.id === id);
  }
}

function createPane(): Pane {
  const id = nextPaneId();

  const element = document.createElement('div');
  element.className = 'pane pane-active';
  element.addEventListener('mousedown', () => setActivePane(id));

  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';

  const tabList = document.createElement('div');
  tabList.className = 'tab-list';
  tabBar.appendChild(tabList);

  const actions = document.createElement('div');
  actions.className = 'tab-bar-actions';

  const splitBtn = document.createElement('button');
  splitBtn.className = 'tab-bar-btn';
  splitBtn.title = 'Split pane';
  splitBtn.innerHTML = '&#x2502;&#x2502;'; // ││
  splitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setActivePane(id);
    splitPane();
  });
  actions.appendChild(splitBtn);

  tabBar.appendChild(actions);
  element.appendChild(tabBar);

  const contentArea = document.createElement('div');
  contentArea.className = 'pane-content';
  element.appendChild(contentArea);

  return { id, tabs: new Map(), activeTabPath: null, element, tabBar, contentArea };
}

function addTab(pane: Pane, path: string): void {
  const container = document.createElement('div');
  container.className = 'editor-tab-content';
  pane.contentArea.appendChild(container);

  const instance = createEditorForPath!(path, container);

  const name = path.replace(/\.md$/, '').split('/').pop() || path;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.title = path;

  const label = document.createElement('span');
  label.className = 'tab-label';
  label.textContent = name;
  tabEl.appendChild(label);

  const closeBtn = document.createElement('span');
  closeBtn.className = 'tab-close';
  closeBtn.textContent = '\u00D7'; // ×
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(pane, path);
  });
  // Middle-click to close
  tabEl.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(pane, path);
    }
  });
  tabEl.appendChild(closeBtn);

  tabEl.addEventListener('click', () => {
    setActivePane(pane.id);
    switchToTab(pane, path);
  });

  const tabList = pane.tabBar.querySelector('.tab-list')!;
  tabList.appendChild(tabEl);

  const tab: Tab = { path, name, instance, container, tabEl };
  pane.tabs.set(path, tab);

  switchToTab(pane, path);
}

function switchToTab(pane: Pane, path: string): void {
  pane.activeTabPath = path;

  for (const [p, tab] of pane.tabs) {
    const isActive = p === path;
    tab.tabEl.classList.toggle('tab-active', isActive);
    tab.container.style.display = isActive ? '' : 'none';
  }

  const tab = pane.tabs.get(path);
  if (tab) {
    tab.instance.view.focus();
  }

  onActiveFileChange?.(path);
}

function closeTab(pane: Pane, path: string): void {
  const tab = pane.tabs.get(path);
  if (!tab) return;

  tab.instance.destroy();
  tab.container.remove();
  tab.tabEl.remove();
  pane.tabs.delete(path);

  if (pane.activeTabPath === path) {
    const remaining = [...pane.tabs.keys()];
    if (remaining.length > 0) {
      switchToTab(pane, remaining[remaining.length - 1]);
    } else {
      pane.activeTabPath = null;
      onActiveFileChange?.(null);

      if (panes.length > 1) {
        removePaneFromLayout(pane);
      }
    }
  }
}

function removePaneFromLayout(pane: Pane): void {
  if (!layoutEl) return;

  for (const tab of pane.tabs.values()) {
    tab.instance.destroy();
  }

  const idx = panes.indexOf(pane);
  if (idx < 0) return;
  panes.splice(idx, 1);

  // Remove the pane element and its adjacent divider
  const prevDivider = pane.element.previousElementSibling;
  const nextDivider = pane.element.nextElementSibling;
  if (prevDivider?.classList.contains('split-divider')) {
    prevDivider.remove();
  } else if (nextDivider?.classList.contains('split-divider')) {
    nextDivider.remove();
  }
  pane.element.remove();

  if (activePaneId === pane.id && panes.length > 0) {
    setActivePane(panes[0].id);
  }
}

// ── Split divider with drag-to-resize ───────────────────────────────────

function createDivider(): HTMLElement {
  const divider = document.createElement('div');
  divider.className = 'split-divider';

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const layout = layoutEl!;
    const layoutRect = layout.getBoundingClientRect();
    const children = [...layout.children].filter(
      (c) => c.classList.contains('pane'),
    ) as HTMLElement[];

    // Find which two panes this divider sits between
    const dividerIndex = [...layout.children].indexOf(divider);
    const leftPanes = children.filter(
      (c) => [...layout.children].indexOf(c) < dividerIndex,
    );
    const rightPanes = children.filter(
      (c) => [...layout.children].indexOf(c) > dividerIndex,
    );
    const leftPane = leftPanes[leftPanes.length - 1];
    const rightPane = rightPanes[0];
    if (!leftPane || !rightPane) return;

    const totalWidth = leftPane.offsetWidth + rightPane.offsetWidth;
    const minWidth = 200;

    const onMouseMove = (ev: MouseEvent) => {
      const x = ev.clientX - layoutRect.left;
      const leftStart = leftPane.offsetLeft;
      let leftWidth = x - leftStart;
      leftWidth = Math.max(minWidth, Math.min(totalWidth - minWidth, leftWidth));
      const rightWidth = totalWidth - leftWidth;

      leftPane.style.flex = `0 0 ${leftWidth}px`;
      rightPane.style.flex = `0 0 ${rightWidth}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  return divider;
}
