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
    const permission = confirm('Allow editing? (OK = read-write, Cancel = read-only)')
      ? 'write' : 'read';
    try {
      const uuid = await createShareLink(path, permission as 'read' | 'write');
      const link = `${window.location.origin}/share/${uuid}`;
      await navigator.clipboard.writeText(link);
      alert(`Share link copied to clipboard:\n${link}\n\nPermission: ${permission}`);
    } catch (e) {
      alert(`Failed to create share link: ${e}`);
    }
  }

  createSidebar(app, handleFileSelect, handleShare);
  app.appendChild(editorContainer);

  // Start with the sample doc (no sync)
  createEditor(editorContainer, { vimrcContent: DEFAULT_VIMRC });

  // Load file tree
  refreshSidebar().catch(() => {});
}
