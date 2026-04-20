import { createSignal, For, Show, type Component } from 'solid-js';
import type { VaultConfig } from '../api/types';
import { isTauri } from '../config';

async function pickFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  return open({ directory: true, multiple: false }) as Promise<string | null>;
}

interface Props {
  vaults: VaultConfig[];
  onSelect: (vault: VaultConfig) => void;
  onAdd: (name: string, path: string, sync: boolean) => void;
  onRemove: (id: string) => void;
}

export const VaultPicker: Component<Props> = (props) => {
  const [name, setName] = createSignal('');
  const [selectedPath, setSelectedPath] = createSignal('');
  const [sync, setSync] = createSignal(true);

  async function handleBrowse() {
    try {
      const folder = await pickFolder();
      if (folder) {
        setSelectedPath(folder);
        if (!name()) {
          const folderName = folder.split('/').pop() || folder;
          setName(folderName.charAt(0).toUpperCase() + folderName.slice(1));
        }
      }
    } catch (e) {
      alert(`Failed to open folder picker: ${e}`);
    }
  }

  function handleAdd() {
    const n = name().trim();
    if (!n) return;
    if (isTauri && !selectedPath()) { handleBrowse(); return; }
    props.onAdd(n, selectedPath(), sync());
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
                  <div class="vault-picker-item-path">{vault.path}</div>
                </div>
                <div class="vault-picker-item-badges">
                  <span class={`vault-picker-badge ${vault.sync ? 'vault-picker-badge-sync' : ''}`}>
                    {vault.sync ? 'Synced' : 'Local'}
                  </span>
                  <button
                    class="vault-picker-remove"
                    title="Remove vault"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove "${vault.name}" from the list? Files on disk will not be deleted.`))
                        props.onRemove(vault.id);
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

          <Show when={isTauri}>
            <div class="vault-picker-path-row">
              <div class={`vault-picker-path-display ${selectedPath() ? 'vault-picker-path-selected' : ''}`}>
                {selectedPath() || 'No folder selected'}
              </div>
              <button class="share-modal-btn" onClick={handleBrowse}>Browse...</button>
            </div>
            <label class="vault-picker-sync-row">
              <input type="checkbox" checked={sync()} onChange={(e) => setSync(e.currentTarget.checked)} />
              <span>Sync to remote server</span>
            </label>
          </Show>

          <button class="share-modal-btn share-modal-btn-primary" onClick={handleAdd}>
            Add vault
          </button>
        </div>
      </div>
    </div>
  );
};
