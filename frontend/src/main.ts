import './style.css';
import { createEditor, setEditorContent } from './editor/editor';
import { createSidebar, refreshSidebar, setCurrentFile } from './ui/sidebar';
import { readFile, setApiBaseUrl } from './api/client';

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

// Detect whether we're running on the Quart server (same-origin)
// or on the Vite dev server (need to proxy to Quart).
const isDevServer = location.port === '5173' || location.port === '5174';
if (isDevServer) {
  setApiBaseUrl('http://localhost:8080');
}

// ── Sidebar ───────────────────────────────────────────────────────────────
async function handleFileSelect(path: string): Promise<void> {
  try {
    const content = await readFile(path);
    setEditorContent(content);
    setCurrentFile(path);
  } catch (e) {
    console.error('Failed to open file:', e);
  }
}

createSidebar(app, handleFileSelect);

// ── Editor ────────────────────────────────────────────────────────────────
const editorContainer = document.createElement('div');
editorContainer.id = 'editor-container';
app.appendChild(editorContainer);

createEditor(editorContainer, { vimrcContent: DEFAULT_VIMRC });

// Try to load the file tree (will silently fail if server isn't running)
refreshSidebar().catch(() => {});
