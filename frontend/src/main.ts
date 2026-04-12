import './style.css';
import { createEditor } from './editor/editor';
import { createSidebar, refreshSidebar, setCurrentFile } from './ui/sidebar';
import { setApiBaseUrl, createShareLink } from './api/client';
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
    // Remove any existing modal
    document.querySelector('.share-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'share-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'share-modal';

    const title = document.createElement('div');
    title.className = 'share-modal-title';
    title.textContent = `Share: ${path}`;
    modal.appendChild(title);

    const btnRow = document.createElement('div');
    btnRow.className = 'share-modal-buttons';

    async function generate(permission: 'read' | 'write') {
      try {
        const uuid = await createShareLink(path, permission);
        const link = `${window.location.origin}/share/${uuid}`;

        // Show the link
        btnRow.innerHTML = '';
        const result = document.createElement('div');
        result.className = 'share-modal-result';

        const label = document.createElement('div');
        label.className = 'share-modal-label';
        label.textContent = permission === 'read' ? 'Read-only link:' : 'Editable link:';
        result.appendChild(label);

        const input = document.createElement('input');
        input.className = 'share-modal-link';
        input.type = 'text';
        input.value = link;
        input.readOnly = true;
        input.addEventListener('click', () => input.select());
        result.appendChild(input);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'share-modal-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', async () => {
          await navigator.clipboard.writeText(link);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
        result.appendChild(copyBtn);

        modal.appendChild(result);
      } catch (e) {
        btnRow.innerHTML = `<div class="share-modal-error">Failed: ${e}</div>`;
      }
    }

    const readBtn = document.createElement('button');
    readBtn.className = 'share-modal-btn';
    readBtn.textContent = 'Read-only link';
    readBtn.addEventListener('click', () => generate('read'));
    btnRow.appendChild(readBtn);

    const writeBtn = document.createElement('button');
    writeBtn.className = 'share-modal-btn share-modal-btn-primary';
    writeBtn.textContent = 'Editable link';
    writeBtn.addEventListener('click', () => generate('write'));
    btnRow.appendChild(writeBtn);

    modal.appendChild(btnRow);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  createSidebar(app, handleFileSelect, handleShare);
  app.appendChild(editorContainer);

  // Start with the sample doc (no sync)
  createEditor(editorContainer, { vimrcContent: DEFAULT_VIMRC });

  // Load file tree
  refreshSidebar().catch(() => {});
}
