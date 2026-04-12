import './style.css';
import { createEditor } from './editor/editor';

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

const editorContainer = document.createElement('div');
editorContainer.id = 'editor-container';
app.appendChild(editorContainer);

createEditor(editorContainer, { vimrcContent: DEFAULT_VIMRC });
