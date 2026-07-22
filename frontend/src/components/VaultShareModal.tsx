import { createResource, createSignal, For, Show, type Component } from 'solid-js';
import { Dialog } from '@kobalte/core';
import { createVaultShare, listVaultShares, revokeVaultShare, type VaultShare } from '../api/client';
import type { Permission } from '../api/types';

const PERMISSION_LABELS: Record<Permission, string> = {
  read: 'View only',
  comment: 'Can comment',
  write: 'Can edit',
};

interface Props {
  vaultName: string;
  onClose: () => void;
}

/** Vault-level sharing: named federation shares, each with an invite URL for another instance. */
export const VaultShareModal: Component<Props> = (props) => {
  const [shares, { refetch }] = createResource(() => props.vaultName, (v) => listVaultShares(v));
  const [newName, setNewName] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  async function handleCreate(permission: Permission) {
    const name = newName().trim();
    if (!name) {
      setError('Give this share a name (e.g. who it’s for) so you can revoke it later.');
      return;
    }
    setError(null);
    try {
      await createVaultShare(props.vaultName, name, permission);
      setNewName('');
      refetch();
    } catch (e) {
      setError(`Failed to create share: ${e}`);
    }
  }

  async function handleRevoke(share: VaultShare) {
    if (!confirm(`Revoke the share "${share.share_name}"? Their instance will lose access immediately.`)) return;
    try {
      await revokeVaultShare(share.secret);
      refetch();
    } catch (e) {
      setError(`Failed to revoke: ${e}`);
    }
  }

  function copyToClipboard(text: string, btn: HTMLButtonElement) {
    navigator.clipboard.writeText(text);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy invite'; }, 1500);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Dialog.Portal>
        <div class="settings-modal-overlay">
          {/* Dismiss on pointer-outside only: this dialog opens from the vault menu, whose close
              sequence restores focus to its trigger — a focus-outside dismissal would close the
              dialog the instant it opens. */}
          <Dialog.Content
            class="share-modal"
            onPointerDownOutside={props.onClose}
            onFocusOutside={(e: Event) => e.preventDefault()}
          >
            <Dialog.Title class="share-modal-title">
              Share vault with another md-notes user: {props.vaultName}
            </Dialog.Title>
            <div class="share-modal-body">
              <p class="share-modal-hint">
                This connects the whole vault to someone else's md-notes instance. Send them the
                invite link and have them: open their own md-notes → <em>Manage vaults…</em> →
                paste the link under <em>Connect a shared vault</em>. The vault then shows up next
                to their own vaults. Name each share after its recipient so you can revoke it
                later — revoking cuts off that instance immediately.
              </p>
              <Show when={!shares.loading} fallback="Loading...">
                <Show when={shares() && shares()!.length > 0} fallback={
                  <div class="share-modal-empty">No active vault shares.</div>
                }>
                  <div class="share-link-list">
                    <For each={shares()!}>{(share) => (
                      <div class="share-link-row">
                        <div class="share-link-info">
                          <span class="share-link-name">{share.share_name}</span>
                          <span class={`share-link-badge ${share.permission === 'write' ? 'share-link-badge-write' : ''} ${share.permission === 'comment' ? 'share-link-badge-comment' : ''}`}>
                            {PERMISSION_LABELS[share.permission]}
                          </span>
                          <span class="share-link-date">
                            {new Date(share.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <input
                          class="share-modal-link"
                          type="text"
                          value={share.invite_url}
                          readOnly
                          onClick={(e) => e.currentTarget.select()}
                        />
                        <div class="share-link-actions">
                          <button
                            class="share-modal-btn share-modal-btn-sm"
                            onClick={(e) => copyToClipboard(share.invite_url, e.currentTarget)}
                          >Copy invite</button>
                          <button
                            class="share-modal-btn share-modal-btn-sm share-modal-btn-danger"
                            onClick={() => handleRevoke(share)}
                          >Revoke</button>
                        </div>
                      </div>
                    )}</For>
                  </div>
                </Show>

                <div class="share-new-section">
                  <div class="share-modal-label">New share</div>
                  <input
                    class="settings-input"
                    type="text"
                    placeholder={'Name (e.g. "bob")'}
                    value={newName()}
                    onInput={(e) => setNewName(e.currentTarget.value)}
                  />
                  <div class="share-modal-buttons">
                    <button class="share-modal-btn" onClick={() => handleCreate('read')}>View only</button>
                    <button class="share-modal-btn" onClick={() => handleCreate('comment')}>Can comment</button>
                    <button class="share-modal-btn share-modal-btn-primary" onClick={() => handleCreate('write')}>Can edit</button>
                  </div>
                </div>

                <Show when={error()}>
                  <div class="share-modal-error">{error()}</div>
                </Show>
              </Show>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
