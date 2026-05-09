// Standalone screenshot harness: mounts an editor with arbitrary content
// and exposes window.mountEditor / window.moveCursor for playwright.
//
// Used by playwright_tests/list-screenshots.spec.ts to capture rendered
// list/task/code-block visuals without requiring the full e2e stack.

import { createEditor, type EditorInstance } from './editor/editor';
import { EditorSelection } from '@codemirror/state';

declare global {
  interface Window {
    mountEditor: (content: string, label?: string) => Promise<void>;
    moveCursor: (pos: number) => Promise<void>;
    __editor?: EditorInstance;
  }
}

const host = document.getElementById('host')!;
const label = document.getElementById('label')!;

window.mountEditor = async (content: string, labelText = '') => {
  if (window.__editor) {
    window.__editor.destroy();
    window.__editor = undefined;
  }
  host.innerHTML = '';
  label.textContent = labelText;
  const editor = createEditor(host);
  editor.view.dispatch({
    changes: { from: 0, to: editor.view.state.doc.length, insert: content },
  });
  window.__editor = editor;
  // Two animation frames so styling, syntax tree, and measure-phase all settle.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};

window.moveCursor = async (pos: number) => {
  const e = window.__editor;
  if (!e) throw new Error('no editor mounted');
  e.view.dispatch({ selection: EditorSelection.cursor(pos) });
  e.view.focus();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};
