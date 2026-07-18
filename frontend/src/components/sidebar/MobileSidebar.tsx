import { Show, type Component } from 'solid-js';
import type { SidebarCommonProps } from './types';
import { createFileOps } from './file-ops';
import { FileTree } from './FileTree';
import { VaultSwitcher } from './VaultSwitcher';
import { SyncFooter } from './SyncFooter';
import { OpsDialog } from './OpsDialog';

interface Props extends SidebarCommonProps {
  /** File search (quick open) — rendered as a labeled row, clearly
   * separate from full-text search. */
  onQuickOpen: () => void;
  onSearch?: () => void;
}

/** Mobile sidebar: lives in the shell's slide-in drawer; labeled search
 * rows and per-row "⋯" action menus instead of hover/right-click paths. */
export const MobileSidebar: Component<Props> = (props) => {
  const ops = createFileOps({
    onSelect: (p) => props.onSelect(p),
    currentPath: () => props.currentPath,
  });

  return (
    <>
      <div id="sidebar">
        <div class="sidebar-header">
          <VaultSwitcher
            vaultName={props.vaultName}
            vaults={props.vaults}
            onSwitchToVault={props.onSwitchToVault}
            onManageVaults={props.onManageVaults}
            onRefreshVaults={props.onRefreshVaults}
          />
          <div class="sidebar-header-buttons">
            <button class="sidebar-btn" title="New file" onClick={() => ops.newFile()}>+</button>
            <Show when={props.onSettings}>
              <button class="sidebar-btn" title="Settings" onClick={props.onSettings}>{'⚙️'}</button>
            </Show>
            <Show when={props.onShare}>
              <button
                class="sidebar-btn sidebar-btn-text"
                title="Share current file"
                onClick={() => {
                  if (props.currentPath) props.onShare!(props.currentPath);
                  else alert('Open a file first.');
                }}
              >Share</button>
            </Show>
          </div>
        </div>

        <div class="sidebar-search-rows">
          <button class="sidebar-search-row" onClick={props.onQuickOpen}>
            <span class="sidebar-icon">{'📄'}</span>
            <span>Open note…</span>
          </button>
          <Show when={props.onSearch}>
            <button class="sidebar-search-row" onClick={props.onSearch}>
              <span class="sidebar-icon">{'🔍'}</span>
              <span>Search text…</span>
            </button>
          </Show>
        </div>

        <FileTree ops={ops} currentPath={props.currentPath} onSelect={props.onSelect} rowMenus />

        <SyncFooter
          showSyncStatus={props.showSyncStatus}
          syncStatus={props.syncStatus}
          syncErrorMsg={props.syncErrorMsg}
          backendStatus={props.backendStatus}
          lastSyncedAt={props.lastSyncedAt}
          idbError={props.idbError}
        />
      </div>

      <OpsDialog ops={ops} />
    </>
  );
};
