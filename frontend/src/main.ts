import './style.css';
import { createEditor } from './editor/editor';
import { createSidebar, refreshSidebar, setCurrentFile } from './ui/sidebar';
import { setApiBaseUrl, getApiBaseUrl } from './api/client';

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

// Detect whether we're running on the Vite dev server (need to proxy to Quart).
const isDevServer = location.port === '5173' || location.port === '5174';
const serverUrl = isDevServer ? 'http://localhost:8080' : window.location.origin;
if (isDevServer) {
  setApiBaseUrl('http://localhost:8080');
}

// ── Editor container ──────────────────────────────────────────────────────
const editorContainer = document.createElement('div');
editorContainer.id = 'editor-container';

// ── Sidebar ───────────────────────────────────────────────────────────────
function handleFileSelect(path: string): void {
  setCurrentFile(path);
  // Re-create the editor with Yjs sync for this file
  createEditor(editorContainer, {
    vimrcContent: DEFAULT_VIMRC,
    syncDocPath: path,
    syncServerUrl: serverUrl,
  });
}

createSidebar(app, handleFileSelect);
app.appendChild(editorContainer);

// Start with the sample doc (no sync) — user clicks a file to open it synced
createEditor(editorContainer, { vimrcContent: DEFAULT_VIMRC });

// Try to load the file tree
refreshSidebar().catch(() => {});
