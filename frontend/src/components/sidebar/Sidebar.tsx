import { createSignal, Show, type Component } from 'solid-js';
import type { SidebarCommonProps } from './types';
import { createFileOps } from './file-ops';
import { FileTree } from './FileTree';
import { VaultSwitcher } from './VaultSwitcher';
import { SyncFooter } from './SyncFooter';
import { OpsDialog } from './OpsDialog';
import { Icon } from './icons';

interface Props extends SidebarCommonProps {
  onSearch?: () => void;
}

const COLLAPSED_KEY = 'mdnotes-sidebar-collapsed';
const WIDTH_KEY = 'mdnotes-sidebar-width';
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;

function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

function loadWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  } catch {}
  return DEFAULT_WIDTH;
}

/** Desktop sidebar: always-visible panel, icon-button header, context menus. */
export const Sidebar: Component<Props> = (props) => {
  const ops = createFileOps({
    onSelect: (p) => props.onSelect(p),
    currentPath: () => props.currentPath,
    onDeleted: props.onDeleted,
  });

  const [collapsed, setCollapsed] = createSignal(loadCollapsed());
  function toggleCollapsed() {
    const next = !collapsed();
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch {}
  }

  const [width, setWidth] = createSignal(loadWidth());
  function startResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width();
    const onMove = (ev: MouseEvent) => {
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + ev.clientX - startX)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('sidebar-resizing');
      try { localStorage.setItem(WIDTH_KEY, String(width())); } catch {}
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.classList.add('sidebar-resizing');
  }

  return (
    <>
      <Show
        when={!collapsed()}
        fallback={
          <div id="sidebar-rail">
            <button class="sidebar-btn" title="Expand sidebar" onClick={toggleCollapsed}>
              <Icon name="panel-left-open" />
            </button>
          </div>
        }
      >
        <div id="sidebar" style={{ width: `${width()}px` }}>
          <div class="sidebar-header">
            <VaultSwitcher
              vaultName={props.vaultName}
              vaults={props.vaults}
              onSwitchToVault={props.onSwitchToVault}
              onManageVaults={props.onManageVaults}
              onRefreshVaults={props.onRefreshVaults}
            />
            <div class="sidebar-header-buttons">
              <Show when={props.onSearch}>
                <button class="sidebar-btn" title="Search vault (⌘⇧F)" onClick={props.onSearch}>
                  <Icon name="search" />
                </button>
              </Show>
              <button class="sidebar-btn" title="New file" onClick={() => ops.startCreate('file')}>
                <Icon name="file-plus" />
              </button>
              <button class="sidebar-btn" title="New folder" onClick={() => ops.startCreate('dir')}>
                <Icon name="folder-plus" />
              </button>
              <Show when={props.onShare}>
                <button
                  class="sidebar-btn"
                  title="Share current file"
                  onClick={() => {
                    if (props.currentPath) props.onShare!(props.currentPath);
                    else alert('Open a file first.');
                  }}
                >
                  <Icon name="share" />
                </button>
              </Show>
              <Show when={props.onSettings}>
                <button class="sidebar-btn" title="Settings" onClick={props.onSettings}>
                  <Icon name="settings" />
                </button>
              </Show>
              <button class="sidebar-btn" title="Collapse sidebar" onClick={toggleCollapsed}>
                <Icon name="panel-left-close" />
              </button>
            </div>
          </div>

          <FileTree ops={ops} currentPath={props.currentPath} onSelect={props.onSelect} />

          <SyncFooter
            showSyncStatus={props.showSyncStatus}
            syncStatus={props.syncStatus}
            syncErrorMsg={props.syncErrorMsg}
            backendStatus={props.backendStatus}
            lastSyncedAt={props.lastSyncedAt}
            idbError={props.idbError}
          />
          <div class="sidebar-resize-handle" onMouseDown={startResize} />
        </div>
      </Show>

      <OpsDialog ops={ops} />
    </>
  );
};
