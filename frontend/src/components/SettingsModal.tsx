import { createSignal, createResource, onMount, type Component } from 'solid-js';
import { getServerApiKey } from '../api/client';

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

interface AppConfig {
  server_url: string;
  api_key: string;
}

interface SettingsProps {
  onSaved: () => void;
  onClose: () => void;
}

export const SettingsModal: Component<SettingsProps> = (props) => {
  const [serverUrl, setServerUrl] = createSignal('');
  const [apiKeyVal, setApiKeyVal] = createSignal('');

  onMount(async () => {
    try {
      const config = await invoke<AppConfig>('get_config');
      setServerUrl(config.server_url);
      setApiKeyVal(config.api_key);
    } catch (e) {
      alert(`Failed to load config: ${e}`);
      props.onClose();
    }
  });

  async function handleSave() {
    const sv = serverUrl().trim() || undefined;
    const ak = apiKeyVal().trim() || undefined;
    try {
      await invoke('save_config', { serverUrl: sv, apiKey: ak });
      props.onSaved();
    } catch (e) { alert(`Failed to save: ${e}`); }
  }

  return (
    <div class="settings-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="settings-modal">
        <div class="settings-modal-title">Settings</div>
        <div class="settings-form">
          <div class="settings-field">
            <label class="settings-label">Remote server</label>
            <input
              class="settings-input"
              type="text"
              placeholder="http://localhost:8080"
              value={serverUrl()}
              onInput={(e) => setServerUrl(e.currentTarget.value)}
            />
          </div>
          <div class="settings-field">
            <label class="settings-label">API key</label>
            <input
              class="settings-input"
              type="password"
              value={apiKeyVal()}
              onInput={(e) => setApiKeyVal(e.currentTarget.value)}
            />
          </div>
        </div>
        <div class="settings-buttons">
          <button class="share-modal-btn" onClick={props.onClose}>Cancel</button>
          <button class="share-modal-btn share-modal-btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
};

interface WebSettingsProps {
  onClose: () => void;
}

export const WebSettingsModal: Component<WebSettingsProps> = (props) => {
  const [apiKey] = createResource(getServerApiKey);

  function handleCopy(btn: HTMLButtonElement) {
    const key = apiKey();
    if (key) {
      navigator.clipboard.writeText(key);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    }
  }

  return (
    <div class="settings-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="settings-modal">
        <div class="settings-modal-title">Settings</div>
        <div class="settings-form">
          <div class="settings-field">
            <label class="settings-label">API key (for desktop app)</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                class="settings-input"
                type="password"
                readOnly
                value={apiKey.loading ? 'Loading...' : (apiKey() || '(no key configured)')}
                style={{ flex: '1' }}
              />
              <button class="share-modal-btn share-modal-btn-sm" onClick={(e) => handleCopy(e.currentTarget)}>
                Copy
              </button>
            </div>
          </div>
        </div>
        <div class="settings-buttons">
          <button class="share-modal-btn" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
