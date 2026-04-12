import './style.css';
import { createEditor } from './editor/editor';

const app = document.getElementById('app')!;

const editorContainer = document.createElement('div');
editorContainer.id = 'editor-container';
app.appendChild(editorContainer);

createEditor(editorContainer);
