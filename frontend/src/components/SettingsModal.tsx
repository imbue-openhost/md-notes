import { createSignal, Show, type Component } from 'solid-js';
import { Dialog } from '@kobalte/core';
import { saveServerVimrc } from '../api/client';
import {
  getCollapseHeadersDefault,
  setCollapseHeadersDefault,
  getEditorKind,
  setEditorKind,
  type EditorKind,
} from '../editor/editor-settings';
import {
  getShellPreference,
  setShellPreference,
  detectShellKind,
  type ShellPreference,
} from '../app-settings';

interface WebSettingsProps {
  initialVimrc: string;
  onSaved: (vimrc: string, editorKind: EditorKind) => void;
  onClose: () => void;
}

export const WebSettingsModal: Component<WebSettingsProps> = (props) => {
  const [vimrc, setVimrc] = createSignal(props.initialVimrc);
  const [editorKind, setEditorKindValue] = createSignal<EditorKind>(getEditorKind());
  const [shellPref, setShellPref] = createSignal<ShellPreference>(getShellPreference());
  const [collapseHeaders, setCollapseHeaders] = createSignal(getCollapseHeadersDefault());
  const [saving, setSaving] = createSignal(false);

  async function handleSave() {
    const value = vimrc();
    setSaving(true);
    try {
      await saveServerVimrc(value);
      setEditorKind(editorKind());
      setShellPreference(shellPref());
      setCollapseHeadersDefault(collapseHeaders());
      props.onSaved(value, editorKind());
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
                <label class="settings-label">App layout</label>
                <select
                  class="settings-input"
                  value={shellPref()}
                  onChange={(e) => setShellPref(e.currentTarget.value as ShellPreference)}
                >
                  <option value="auto">{`Auto (this device: ${detectShellKind()})`}</option>
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile</option>
                </select>
              </div>
              <div class="settings-field">
                <label class="settings-label">Editor preference</label>
                <select
                  class="settings-input"
                  value={editorKind()}
                  onChange={(e) => setEditorKindValue(e.currentTarget.value as EditorKind)}
                >
                  <option value="live-preview">Live preview</option>
                  <option value="live-preview-vim">Live preview (vim keybindings)</option>
                </select>
                <span class="settings-hint">Reload the editor for changes to take effect.</span>
              </div>
              <Show when={editorKind() === 'live-preview-vim'}>
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
              </Show>
              <div class="settings-field">
                <label class="settings-label">
                  <input
                    type="checkbox"
                    checked={collapseHeaders()}
                    onChange={(e) => setCollapseHeaders(e.currentTarget.checked)}
                  />
                  {' '}Open new docs with headers collapsed by default
                </label>
                <span class="settings-hint">
                  Only applies to docs you haven't folded before; existing fold state takes precedence.
                </span>
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
