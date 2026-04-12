import './style.css';
import { createEditor } from './editor/editor';
import { createSidebar, refreshSidebar, setCurrentFile } from './ui/sidebar';
import { setApiBaseUrl, createShareLink, listShareLinks, deleteShareLink } from './api/client';
import { isDevServer, serverUrl, getShareConfig } from './config';

import DEFAULT_VIMRC from './default.vimrc?raw';

const app = document.getElementById('app')!;

if (isDevServer) {
  setApiBaseUrl('http://localhost:8080');
}

// ── Check for share mode ──────────────────────────────────────────────────
const shareConfig = getShareConfig();

if (shareConfig) {
  // Share mode — open the shared document directly
  const editorContainer = document.createElement('div');
  editorContainer.id = 'editor-container';
  app.appendChild(editorContainer);

  createEditor(editorContainer, {
    vimrcContent: DEFAULT_VIMRC,
    syncDocPath: shareConfig.docPath,
    syncServerUrl: serverUrl,
    readOnly: shareConfig.permission === 'read',
  });
} else {
  // Normal mode — sidebar + editor
  const editorContainer = document.createElement('div');
  editorContainer.id = 'editor-container';

  let currentDocPath: string | null = null;

  function handleFileSelect(path: string): void {
    currentDocPath = path;
    setCurrentFile(path);
    createEditor(editorContainer, {
      vimrcContent: DEFAULT_VIMRC,
      syncDocPath: path,
      syncServerUrl: serverUrl,
    });
  }

  async function handleShare(path: string): Promise<void> {
    showShareModal(path);
  }

  function showShareModal(path: string): void {
    document.querySelector('.share-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'share-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'share-modal';

    const title = document.createElement('div');
    title.className = 'share-modal-title';
    title.textContent = `Share: ${path.replace(/\.md$/, '')}`;
    modal.appendChild(title);

    const body = document.createElement('div');
    body.className = 'share-modal-body';
    body.textContent = 'Loading...';
    modal.appendChild(body);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);

    renderShareBody(path, body);
  }

  async function renderShareBody(path: string, body: HTMLElement): Promise<void> {
    body.innerHTML = '';

    let links;
    try {
      links = await listShareLinks(path);
    } catch (e) {
      body.innerHTML = `<div class="share-modal-error">Failed to load links: ${e}</div>`;
      return;
    }

    // Existing links
    if (links.length > 0) {
      const list = document.createElement('div');
      list.className = 'share-link-list';

      for (const link of links) {
        const url = `${window.location.origin}/share/${link.uuid}`;
        const row = document.createElement('div');
        row.className = 'share-link-row';

        const info = document.createElement('div');
        info.className = 'share-link-info';

        const badge = document.createElement('span');
        badge.className = `share-link-badge ${link.permission === 'write' ? 'share-link-badge-write' : ''}`;
        badge.textContent = link.permission === 'write' ? 'Can edit' : 'View only';
        info.appendChild(badge);

        const date = document.createElement('span');
        date.className = 'share-link-date';
        date.textContent = new Date(link.created_at).toLocaleDateString();
        info.appendChild(date);

        row.appendChild(info);

        const input = document.createElement('input');
        input.className = 'share-modal-link';
        input.type = 'text';
        input.value = url;
        input.readOnly = true;
        input.addEventListener('click', () => input.select());
        row.appendChild(input);

        const actions = document.createElement('div');
        actions.className = 'share-link-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'share-modal-btn share-modal-btn-sm';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', async () => {
          await navigator.clipboard.writeText(url);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
        actions.appendChild(copyBtn);

        const revokeBtn = document.createElement('button');
        revokeBtn.className = 'share-modal-btn share-modal-btn-sm share-modal-btn-danger';
        revokeBtn.textContent = 'Revoke';
        revokeBtn.addEventListener('click', async () => {
          try {
            await deleteShareLink(link.uuid);
            renderShareBody(path, body);
          } catch (e) {
            alert(`Failed to revoke: ${e}`);
          }
        });
        actions.appendChild(revokeBtn);

        row.appendChild(actions);
        list.appendChild(row);
      }
      body.appendChild(list);
    } else {
      const empty = document.createElement('div');
      empty.className = 'share-modal-empty';
      empty.textContent = 'No active share links.';
      body.appendChild(empty);
    }

    // Create new link section
    const newSection = document.createElement('div');
    newSection.className = 'share-new-section';

    const newLabel = document.createElement('div');
    newLabel.className = 'share-modal-label';
    newLabel.textContent = 'Create new link';
    newSection.appendChild(newLabel);

    const newBtns = document.createElement('div');
    newBtns.className = 'share-modal-buttons';

    const readBtn = document.createElement('button');
    readBtn.className = 'share-modal-btn';
    readBtn.textContent = 'View only';
    readBtn.addEventListener('click', async () => {
      await createShareLink(path, 'read');
      renderShareBody(path, body);
    });
    newBtns.appendChild(readBtn);

    const writeBtn = document.createElement('button');
    writeBtn.className = 'share-modal-btn share-modal-btn-primary';
    writeBtn.textContent = 'Can edit';
    writeBtn.addEventListener('click', async () => {
      await createShareLink(path, 'write');
      renderShareBody(path, body);
    });
    newBtns.appendChild(writeBtn);

    newSection.appendChild(newBtns);
    body.appendChild(newSection);
  }

  createSidebar(app, handleFileSelect, handleShare);
  app.appendChild(editorContainer);

  // Start with the sample doc (no sync)
  createEditor(editorContainer, { vimrcContent: DEFAULT_VIMRC });

  // Load file tree
  refreshSidebar().catch(() => {});
}
