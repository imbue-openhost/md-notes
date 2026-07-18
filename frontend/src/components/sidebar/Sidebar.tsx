import { Show, type Component } from 'solid-js';
import type { SidebarCommonProps } from './types';
import { createFileOps } from './file-ops';
import { FileTree } from './FileTree';
import { VaultSwitcher } from './VaultSwitcher';
import { SyncFooter } from './SyncFooter';
import { OpsDialog } from './OpsDialog';

interface Props extends SidebarCommonProps {
  onSearch?: () => void;
}

/** Desktop sidebar: always-visible panel, icon-button header, context menus. */
export const Sidebar: Component<Props> = (props) => {
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
            isRemote={props.isRemote}
            readOnly={props.readOnly}
            onShareVault={props.onShareVault}
            onSwitchToVault={props.onSwitchToVault}
            onManageVaults={props.onManageVaults}
            onRefreshVaults={props.onRefreshVaults}
          />
          <div class="sidebar-header-buttons">
            <Show when={props.onSearch}>
              <button class="sidebar-btn" title="Search vault (⌘⇧F)" onClick={props.onSearch}>{'🔍'}</button>
            </Show>
            <Show when={!props.readOnly}>
              <button class="sidebar-btn" title="New file" onClick={() => ops.newFile()}>+</button>
            </Show>
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

        <FileTree ops={ops} currentPath={props.currentPath} onSelect={props.onSelect} readOnly={props.readOnly} />

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
