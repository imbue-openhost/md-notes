/**
 * Settings modal for configuring the desktop app.
 * Reads/writes config via Tauri commands to ~/.md_notes/config.json.
 */

import { isTauri } from '../config';

interface AppConfig {
  server_url: string;
  api_key: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function showSettingsModal(onSaved?: () => void): Promise<void> {
  if (!isTauri) return;

  document.querySelector('.settings-modal-overlay')?.remove();

  let config: AppConfig;
  try {
    config = await invoke<AppConfig>('get_config');
  } catch (e) {
    alert(`Failed to load config: ${e}`);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'settings-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'settings-modal';

  const title = document.createElement('div');
  title.className = 'settings-modal-title';
  title.textContent = 'Settings';
  modal.appendChild(title);

  const form = document.createElement('div');
  form.className = 'settings-form';

  // Server URL
  const serverGroup = createField('Remote server', config.server_url, 'http://localhost:8080');
  form.appendChild(serverGroup.group);

  // API Key
  const apiKeyGroup = createField('API key', config.api_key, '');
  apiKeyGroup.input.type = 'password';
  form.appendChild(apiKeyGroup.group);

  modal.appendChild(form);

  // Buttons
  const buttons = document.createElement('div');
  buttons.className = 'settings-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'share-modal-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => overlay.remove());
  buttons.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'share-modal-btn share-modal-btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const serverUrl = serverGroup.input.value.trim() || undefined;
    const apiKey = apiKeyGroup.input.value.trim() || undefined;
    try {
      await invoke('save_config', { serverUrl, apiKey });
      overlay.remove();
      onSaved?.();
    } catch (e) {
      alert(`Failed to save: ${e}`);
    }
  });
  buttons.appendChild(saveBtn);

  modal.appendChild(buttons);
  overlay.appendChild(modal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

function createField(
  label: string,
  value: string,
  placeholder: string,
): { group: HTMLElement; input: HTMLInputElement } {
  const group = document.createElement('div');
  group.className = 'settings-field';

  const lbl = document.createElement('label');
  lbl.className = 'settings-label';
  lbl.textContent = label;
  group.appendChild(lbl);

  const input = document.createElement('input');
  input.className = 'settings-input';
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  group.appendChild(input);

  return { group, input };
}
