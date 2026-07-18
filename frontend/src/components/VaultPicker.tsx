import { createSignal, For, Show, type Component } from 'solid-js';
import type { VaultConfig } from '../api/types';

interface Props {
  vaults: VaultConfig[];
  onSelect: (vault: VaultConfig) => void;
  onAdd: (name: string, path: string, sync: boolean) => void;
  onRemove: (vault: VaultConfig) => void;
  /** Connect a shared vault from a pasted invite link; rejects with a user-facing message. */
  onConnectRemote: (link: string) => Promise<void>;
}

export const VaultPicker: Component<Props> = (props) => {
  const [name, setName] = createSignal('');
  const [inviteLink, setInviteLink] = createSignal('');
  const [connectBusy, setConnectBusy] = createSignal(false);
  const [connectError, setConnectError] = createSignal<string | null>(null);

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
                    <Show when={vault.remote}>
                      {(remote) => (
                        <span
                          class="vault-picker-item-remote"
                          title={`Shared from ${remote().source_url} (${remote().permission === 'write' ? 'can edit' : 'view only'})`}
                        >
                          {' ⇄ '}{new URL(remote().source_url).host}
                        </span>
                      )}
                    </Show>
                  </div>
                </div>
                <div class="vault-picker-item-badges">
                  <button
                    class="vault-picker-remove"
                    title={vault.remote ? 'Disconnect shared vault' : 'Remove vault'}
                    onClick={(e) => {
                      e.stopPropagation();
                      const message = vault.remote
                        ? `Disconnect shared vault "${vault.name}"? The files stay on the other instance.`
                        : `Delete vault "${vault.name}"? All files will be permanently deleted.`;
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

        <div class="vault-picker-add">
          <div class="vault-picker-add-title">Connect a shared vault</div>

          <input
            class="settings-input"
            type="text"
            placeholder="Paste an invite link (https://…/federation/connect?…)"
            value={inviteLink()}
            onInput={(e) => setInviteLink(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
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
