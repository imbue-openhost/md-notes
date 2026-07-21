import { For, Show, type Component } from 'solid-js';
import { DropdownMenu } from '@kobalte/core';
import type { VaultConfig } from '../../api/types';
import { Icon } from './icons';

interface Props {
  vaultName?: string;
  vaults?: VaultConfig[];
  isRemote?: boolean;
  readOnly?: boolean;
  onShareVault?: () => void;
  onSwitchToVault?: (v: VaultConfig) => void;
  onManageVaults?: () => void;
  onRefreshVaults?: () => void;
}

export const VaultSwitcher: Component<Props> = (props) => (
  <DropdownMenu.Root
    onOpenChange={(open) => { if (open) props.onRefreshVaults?.(); }}
  >
    <DropdownMenu.Trigger class="sidebar-vault-trigger" title="Switch vault">
      <span class="sidebar-vault-name">{props.vaultName || 'No vault'}</span>
      <Show when={props.isRemote}>
        <span class="sidebar-vault-remote-badge" title={props.readOnly ? 'Shared from another instance (read-only)' : 'Shared from another instance'}>
          {props.readOnly ? '⇄ read-only' : '⇄'}
        </span>
      </Show>
      <span class="sidebar-vault-chevron" aria-hidden>
        <Icon name="chevrons-up-down" size={13} />
      </span>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content class="sidebar-vault-menu">
        <div class="sidebar-vault-menu-label">Vaults</div>
        <For each={props.vaults ?? []}>
          {(v) => (
            <DropdownMenu.Item
              class="sidebar-vault-item"
              classList={{ 'sidebar-vault-item-active': v.name === props.vaultName }}
              onSelect={() => {
                if (v.name !== props.vaultName) props.onSwitchToVault?.(v);
              }}
            >
              <span class="sidebar-vault-check">
                <Show when={v.name === props.vaultName}>
                  <Icon name="check" size={13} />
                </Show>
              </span>
              <span class="sidebar-vault-item-name">{v.name}</span>
              <Show when={v.remote}>
                <span class="sidebar-vault-remote-badge" title="Shared from another instance">⇄</span>
              </Show>
            </DropdownMenu.Item>
          )}
        </For>
        <Show when={(props.vaults?.length ?? 0) > 0}>
          <DropdownMenu.Separator class="sidebar-vault-sep" />
        </Show>
        <Show when={props.onShareVault}>
          <DropdownMenu.Item
            class="sidebar-vault-item sidebar-vault-manage"
            onSelect={() => props.onShareVault?.()}
          >
            <span class="sidebar-vault-check">
              <Icon name="share" size={13} />
            </span>
            <span>Share this vault with another md-notes user…</span>
          </DropdownMenu.Item>
        </Show>
        <DropdownMenu.Item
          class="sidebar-vault-item sidebar-vault-manage"
          onSelect={() => props.onManageVaults?.()}
        >
          <span class="sidebar-vault-check">
            <Icon name="settings" size={13} />
          </span>
          <span>Manage vaults…</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);
