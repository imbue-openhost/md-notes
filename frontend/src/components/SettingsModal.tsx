import { type Component } from 'solid-js';
import { Dialog } from '@kobalte/core';

interface WebSettingsProps {
  onClose: () => void;
}

export const WebSettingsModal: Component<WebSettingsProps> = (props) => {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Dialog.Portal>
        <div class="settings-modal-overlay">
          <Dialog.Content class="settings-modal">
            <Dialog.Title class="settings-modal-title">Settings</Dialog.Title>
            <div class="settings-form">
              <p style={{ color: 'var(--fg-muted)', margin: '0' }}>No settings to configure.</p>
            </div>
            <div class="settings-buttons">
              <button class="share-modal-btn" onClick={props.onClose}>Close</button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
