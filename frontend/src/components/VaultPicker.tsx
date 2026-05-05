import { createSignal, For, Show, type Component } from 'solid-js';
import type { VaultConfig } from '../api/types';

interface Props {
  vaults: VaultConfig[];
  onSelect: (vault: VaultConfig) => void;
  onAdd: (name: string, path: string, sync: boolean) => void;
  onRemove: (name: string) => void;
}

export const VaultPicker: Component<Props> = (props) => {
  const [name, setName] = createSignal('');

  function handleAdd() {
    const n = name().trim();
    if (!n) return;
    props.onAdd(n, '', true);
  }

  return (
    <div class="vault-picker">
      <div class="vault-picker-card">
        <div class="vault-picker-title">Open a vault</div>

        <Show when={props.vaults.length > 0}>
          <div class="vault-picker-list">
            <For each={props.vaults}>{(vault) => (
              <div class="vault-picker-item">
                <div class="vault-picker-item-info" onClick={() => props.onSelect(vault)}>
                  <div class="vault-picker-item-name">{vault.name}</div>
                </div>
                <div class="vault-picker-item-badges">
                  <button
                    class="vault-picker-remove"
                    title="Remove vault"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete vault "${vault.name}"? All files will be permanently deleted.`))
                        props.onRemove(vault.name);
                    }}
                  >
                    &times;
                  </button>
                </div>
              </div>
            )}</For>
          </div>
        </Show>

        <div class="vault-picker-add">
          <div class="vault-picker-add-title">
            {props.vaults.length > 0 ? 'Add another vault' : 'Add a vault to get started'}
          </div>

          <input
            class="settings-input"
            type="text"
            placeholder="Vault name (e.g., Personal)"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />

          <button class="share-modal-btn share-modal-btn-primary" onClick={handleAdd}>
            Add vault
          </button>
        </div>
      </div>
    </div>
  );
};
