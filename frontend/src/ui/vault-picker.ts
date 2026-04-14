/**
 * Vault picker — full-page UI for selecting or adding a vault.
 */

import type { VaultConfig } from '../api/types';

export interface VaultPickerCallbacks {
  onSelect: (vault: VaultConfig) => void;
  onAdd: (name: string, path: string, sync: boolean) => void;
  onRemove: (id: string) => void;
}

async function pickFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ directory: true, multiple: false });
  return selected as string | null;
}

export function showVaultPicker(
  vaults: VaultConfig[],
  callbacks: VaultPickerCallbacks,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'vault-picker';

  const card = document.createElement('div');
  card.className = 'vault-picker-card';

  const title = document.createElement('div');
  title.className = 'vault-picker-title';
  title.textContent = 'Open a vault';
  card.appendChild(title);

  // Vault list
  if (vaults.length > 0) {
    const list = document.createElement('div');
    list.className = 'vault-picker-list';

    for (const vault of vaults) {
      const row = document.createElement('div');
      row.className = 'vault-picker-item';

      const info = document.createElement('div');
      info.className = 'vault-picker-item-info';
      info.addEventListener('click', () => callbacks.onSelect(vault));

      const name = document.createElement('div');
      name.className = 'vault-picker-item-name';
      name.textContent = vault.name;
      info.appendChild(name);

      const path = document.createElement('div');
      path.className = 'vault-picker-item-path';
      path.textContent = vault.path;
      info.appendChild(path);

      row.appendChild(info);

      const badges = document.createElement('div');
      badges.className = 'vault-picker-item-badges';

      const badge = document.createElement('span');
      badge.className = `vault-picker-badge ${vault.sync ? 'vault-picker-badge-sync' : ''}`;
      badge.textContent = vault.sync ? 'Synced' : 'Local';
      badges.appendChild(badge);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'vault-picker-remove';
      removeBtn.textContent = '\u00D7'; // ×
      removeBtn.title = 'Remove vault';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Remove "${vault.name}" from the list? Files on disk will not be deleted.`)) {
          callbacks.onRemove(vault.id);
        }
      });
      badges.appendChild(removeBtn);

      row.appendChild(badges);
      list.appendChild(row);
    }

    card.appendChild(list);
  }

  // Add vault section
  const addSection = document.createElement('div');
  addSection.className = 'vault-picker-add';

  const addTitle = document.createElement('div');
  addTitle.className = 'vault-picker-add-title';
  addTitle.textContent = vaults.length > 0 ? 'Add another vault' : 'Add a vault to get started';
  addSection.appendChild(addTitle);

  // Name input
  const nameInput = document.createElement('input');
  nameInput.className = 'settings-input';
  nameInput.type = 'text';
  nameInput.placeholder = 'Vault name (e.g., Personal)';
  addSection.appendChild(nameInput);

  // Folder picker row
  const pathRow = document.createElement('div');
  pathRow.className = 'vault-picker-path-row';

  const pathDisplay = document.createElement('div');
  pathDisplay.className = 'vault-picker-path-display';
  pathDisplay.textContent = 'No folder selected';
  pathRow.appendChild(pathDisplay);

  let selectedPath = '';

  const browseBtn = document.createElement('button');
  browseBtn.className = 'share-modal-btn';
  browseBtn.textContent = 'Browse...';
  browseBtn.addEventListener('click', async () => {
    try {
      const folder = await pickFolder();
      if (folder) {
        selectedPath = folder;
        pathDisplay.textContent = folder;
        pathDisplay.classList.add('vault-picker-path-selected');
        // Auto-fill name from folder name if empty
        if (!nameInput.value.trim()) {
          const folderName = folder.split('/').pop() || folder;
          nameInput.value = folderName.charAt(0).toUpperCase() + folderName.slice(1);
        }
      }
    } catch (e) {
      console.error('Folder picker error:', e);
      alert(`Failed to open folder picker: ${e}`);
    }
  });
  pathRow.appendChild(browseBtn);

  addSection.appendChild(pathRow);

  // Sync toggle
  const syncRow = document.createElement('label');
  syncRow.className = 'vault-picker-sync-row';
  const syncCheck = document.createElement('input');
  syncCheck.type = 'checkbox';
  syncCheck.checked = true;
  syncRow.appendChild(syncCheck);
  const syncLabel = document.createElement('span');
  syncLabel.textContent = 'Sync to remote server';
  syncRow.appendChild(syncLabel);
  addSection.appendChild(syncRow);

  // Add button
  const addBtn = document.createElement('button');
  addBtn.className = 'share-modal-btn share-modal-btn-primary';
  addBtn.textContent = 'Add vault';
  addBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    if (!selectedPath) { browseBtn.click(); return; }
    callbacks.onAdd(name, selectedPath, syncCheck.checked);
  });
  addSection.appendChild(addBtn);

  card.appendChild(addSection);
  el.appendChild(card);
  return el;
}
