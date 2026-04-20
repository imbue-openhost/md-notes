import { createResource, For, Show, type Component } from 'solid-js';
import { Dialog } from '@kobalte/core';
import { createShareLink, listShareLinks, deleteShareLink } from '../api/client';

interface Props {
  path: string;
  vaultName?: string;
  onClose: () => void;
}

export const ShareModal: Component<Props> = (props) => {
  const serverPath = () => props.vaultName ? `${props.vaultName}/${props.path}` : props.path;
  const [links, { refetch }] = createResource(serverPath, (sp) => listShareLinks(sp));

  async function handleCreate(permission: 'read' | 'write') {
    await createShareLink(serverPath(), permission);
    refetch();
  }

  async function handleRevoke(uuid: string) {
    try {
      await deleteShareLink(uuid);
      refetch();
    } catch (e) { alert(`Failed to revoke: ${e}`); }
  }

  function copyToClipboard(text: string, btn: HTMLButtonElement) {
    navigator.clipboard.writeText(text);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <Dialog.Portal>
        <div class="settings-modal-overlay">
          <Dialog.Content class="share-modal" onInteractOutside={props.onClose}>
            <Dialog.Title class="share-modal-title">
              Share: {props.path.replace(/\.md$/, '')}
            </Dialog.Title>
            <div class="share-modal-body">
              <Show when={!links.loading} fallback="Loading...">
                <Show when={links() && links()!.length > 0} fallback={
                  <div class="share-modal-empty">No active share links.</div>
                }>
                  <div class="share-link-list">
                    <For each={links()!}>{(link) => {
                      const url = `${window.location.origin}/share/${link.uuid}`;
                      return (
                        <div class="share-link-row">
                          <div class="share-link-info">
                            <span class={`share-link-badge ${link.permission === 'write' ? 'share-link-badge-write' : ''}`}>
                              {link.permission === 'write' ? 'Can edit' : 'View only'}
                            </span>
                            <span class="share-link-date">
                              {new Date(link.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <input
                            class="share-modal-link"
                            type="text"
                            value={url}
                            readOnly
                            onClick={(e) => e.currentTarget.select()}
                          />
                          <div class="share-link-actions">
                            <button
                              class="share-modal-btn share-modal-btn-sm"
                              onClick={(e) => copyToClipboard(url, e.currentTarget)}
                            >Copy</button>
                            <button
                              class="share-modal-btn share-modal-btn-sm share-modal-btn-danger"
                              onClick={() => handleRevoke(link.uuid)}
                            >Revoke</button>
                          </div>
                        </div>
                      );
                    }}</For>
                  </div>
                </Show>

                <div class="share-new-section">
                  <div class="share-modal-label">Create new link</div>
                  <div class="share-modal-buttons">
                    <button class="share-modal-btn" onClick={() => handleCreate('read')}>View only</button>
                    <button class="share-modal-btn share-modal-btn-primary" onClick={() => handleCreate('write')}>Can edit</button>
                  </div>
                </div>
              </Show>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
