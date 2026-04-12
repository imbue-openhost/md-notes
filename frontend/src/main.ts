import './style.css';
import { createEditor } from './editor/editor';
import { createSidebar, refreshSidebar, setCurrentFile } from './ui/sidebar';
import { setApiBaseUrl, createShareLink } from './api/client';
import { isDevServer, serverUrl, getShareConfig } from './config';

const DEFAULT_VIMRC = `
" Default vimrc (based on ~/.ideavimrc)

" Use jk for esc in insert mode
inoremap jk <Esc>
inoremap Jk <Esc>
inoremap JK <Esc>
inoremap jK <Esc>

" Case insensitive search (smart: case-sensitive if uppercase used)
set ignorecase
set smartcase
set incsearch

" Use Q for formatting
map Q gq

" Vim-easyclip emulation: d/x delete to black hole, m cuts
nnoremap d "_d
xnoremap d "_d
nnoremap dd "_dd
nnoremap D "_D
xnoremap D "_D
nnoremap x "_x
xnoremap x "_x
nnoremap m d
nnoremap mm dd
xnoremap m d

" Editor settings
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

  createSidebar(app, handleFileSelect);
  app.appendChild(editorContainer);

  // Share button in a toolbar above the editor
  const toolbar = document.createElement('div');
  toolbar.id = 'editor-toolbar';

  const shareBtn = document.createElement('button');
  shareBtn.className = 'toolbar-btn';
  shareBtn.textContent = 'Share';
  shareBtn.title = 'Generate a share link for this document';
  shareBtn.addEventListener('click', async () => {
    if (!currentDocPath) {
      alert('Open a file first.');
      return;
    }
    const permission = confirm('Allow editing? (OK = read-write, Cancel = read-only)')
      ? 'write' : 'read';
    try {
      const uuid = await createShareLink(currentDocPath, permission as 'read' | 'write');
      const link = `${window.location.origin}/share/${uuid}`;
      await navigator.clipboard.writeText(link);
      alert(`Share link copied to clipboard:\n${link}\n\nPermission: ${permission}`);
    } catch (e) {
      alert(`Failed to create share link: ${e}`);
    }
  });
  toolbar.appendChild(shareBtn);

  editorContainer.insertAdjacentElement('beforebegin', toolbar);

  // Start with the sample doc (no sync)
  createEditor(editorContainer, { vimrcContent: DEFAULT_VIMRC });

  // Load file tree
  refreshSidebar().catch(() => {});
}
