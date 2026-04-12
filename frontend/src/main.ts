import './style.css';
import { createEditor } from './editor/editor';
import { createSidebar, refreshSidebar, setCurrentFile } from './ui/sidebar';
import { setApiBaseUrl } from './api/client';
import { isDevServer, serverUrl, getShareConfig } from './config';

const DEFAULT_VIMRC = `
" Default vimrc
set number
set relativenumber
set tabstop=4
set shiftwidth=2
set expandtab
set wrap
set scrolloff=5
`.trim();

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
  });
} else {
  // Normal mode — sidebar + editor
  const editorContainer = document.createElement('div');
  editorContainer.id = 'editor-container';

  function handleFileSelect(path: string): void {
    setCurrentFile(path);
    createEditor(editorContainer, {
      vimrcContent: DEFAULT_VIMRC,
      syncDocPath: path,
      syncServerUrl: serverUrl,
    });
  }

  createSidebar(app, handleFileSelect);
  app.appendChild(editorContainer);

  // Start with the sample doc (no sync)
  createEditor(editorContainer, { vimrcContent: DEFAULT_VIMRC });

  // Load file tree
  refreshSidebar().catch(() => {});
}
