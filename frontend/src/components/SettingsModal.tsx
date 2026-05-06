import { createSignal, type Component } from 'solid-js';
import { Dialog } from '@kobalte/core';
import { saveServerVimrc } from '../api/client';

interface WebSettingsProps {
  initialVimrc: string;
  onSaved: (vimrc: string) => void;
  onClose: () => void;
}

export const WebSettingsModal: Component<WebSettingsProps> = (props) => {
  const [vimrc, setVimrc] = createSignal(props.initialVimrc);
  const [saving, setSaving] = createSignal(false);

  async function handleSave() {
    const value = vimrc();
    setSaving(true);
    try {
      await saveServerVimrc(value);
      props.onSaved(value);
    } catch (e) {
      alert(`Failed to save: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Dialog.Portal>
        <div class="settings-modal-overlay">
          <Dialog.Content class="settings-modal settings-modal-wide">
            <Dialog.Title class="settings-modal-title">Settings</Dialog.Title>
            <div class="settings-form">
              <div class="settings-field">
                <label class="settings-label">Vimrc</label>
                <textarea
                  class="settings-input settings-vimrc"
                  value={vimrc()}
                  onInput={(e) => setVimrc(e.currentTarget.value)}
                  spellcheck={false}
                />
                <span class="settings-hint">Reload the editor for changes to take effect.</span>
              </div>
            </div>
            <div class="settings-buttons">
              <button class="share-modal-btn" onClick={props.onClose}>Cancel</button>
              <button
                class="share-modal-btn share-modal-btn-primary"
                onClick={handleSave}
                disabled={saving()}
              >
                {saving() ? 'Saving…' : 'Save'}
              </button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
