import { createSignal, For, Show, type Component } from 'solid-js';
import type { Vault } from '../api/types';

interface Props {
  vaults: Vault[];
  onSelect: (vault: Vault) => void;
  onAdd: (name: string, path: string, sync: boolean) => void;
  onRemove: (vault: Vault) => void;
  /** Connect a shared vault from a pasted invite link; rejects with a user-facing message. */
  onConnectRemote: (link: string) => Promise<void>;
}

export const VaultPicker: Component<Props> = (props) => {
  const [name, setName] = createSignal('');
  const [inviteLink, setInviteLink] = createSignal('');
  const [connectBusy, setConnectBusy] = createSignal(false);
  const [connectError, setConnectError] = createSignal<string | null>(null);
  let nameInputRef!: HTMLInputElement;
  let inviteInputRef!: HTMLInputElement;

  function handleAdd() {
    const n = name().trim();
    if (!n) return;
    props.onAdd(n, '', true);
  }

  async function handleConnect() {
    const link = inviteLink().trim();
    if (!link || connectBusy()) return;
    setConnectBusy(true);
    setConnectError(null);
    try {
      await props.onConnectRemote(link);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnectBusy(false);
    }
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
                  <div class="vault-picker-item-name">
                    {vault.name}
                    <Show when={!vault.owned}>
                      <span
                        class="vault-picker-item-remote"
                        title={`Shared from ${vault.host} (${vault.permission === 'write' ? 'can edit' : vault.permission === 'comment' ? 'can comment' : 'view only'})`}
                      >
                        {' ⇄ '}{new URL(vault.host).host}
                      </span>
                    </Show>
                  </div>
                </div>
                <div class="vault-picker-item-badges">
                  <button
                    class="vault-picker-remove"
                    title={vault.owned ? 'Remove vault' : 'Disconnect shared vault'}
                    onClick={(e) => {
                      e.stopPropagation();
                      const message = vault.owned
                        ? `Delete vault "${vault.name}"? All files will be permanently deleted.`
                        : `Disconnect shared vault "${vault.name}"? The files stay on the other instance.`;
                      if (confirm(message)) props.onRemove(vault);
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

          {/* See QuickOpen: keep password-manager extensions from
              anchoring their autofill dropdown to this field. */}
          <input
            ref={nameInputRef}
            class="settings-input"
            type="text"
            autocomplete="off"
            placeholder="Vault name (e.g., Personal)"
            value={name()}
            on:input={(e) => { e.stopPropagation(); setName(nameInputRef.value); }}
          />

          <button class="share-modal-btn share-modal-btn-primary" onClick={handleAdd}>
            Add vault
          </button>
        </div>

        <div class="vault-picker-add">
          <div class="vault-picker-add-title">Connect a shared vault</div>

          {/* See QuickOpen: keep password-manager extensions from
              anchoring their autofill dropdown to this field. */}
          <input
            ref={inviteInputRef}
            class="settings-input"
            type="text"
            autocomplete="off"
            placeholder="Paste an invite link (https://…/federation/connect?…)"
            value={inviteLink()}
            on:input={(e) => { e.stopPropagation(); setInviteLink(inviteInputRef.value); }}
            on:keydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleConnect(); }}
          />

          <button class="share-modal-btn" disabled={connectBusy()} onClick={handleConnect}>
            {connectBusy() ? 'Connecting…' : 'Connect'}
          </button>

          <Show when={connectError()}>
            <div class="share-modal-error">{connectError()}</div>
          </Show>
        </div>
      </div>
    </div>
  );
};
