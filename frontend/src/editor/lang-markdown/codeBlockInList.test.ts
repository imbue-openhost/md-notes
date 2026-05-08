import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type Transaction } from '@codemirror/state';
import { markdown, markdownLanguage, insertNewlineInListCodeBlock } from './index';

function run(initial: string, anchor: number) {
  let state = EditorState.create({
    doc: initial,
    selection: EditorSelection.cursor(anchor),
    extensions: [markdown({ base: markdownLanguage })],
  });
  // Trigger one update so the parser settles.
  state = state.update({}).state;
  const captured: { tr?: Transaction; ran: boolean } = { ran: false };
  captured.ran = insertNewlineInListCodeBlock({
    state,
    dispatch: (tr) => {
      captured.tr = tr as Transaction;
    },
  });
  return {
    ran: captured.ran,
    doc: captured.tr ? captured.tr.newDoc.toString() : state.doc.toString(),
    cursor: captured.tr ? captured.tr.newSelection.main.head : anchor,
  };
}

describe('insertNewlineInListCodeBlock', () => {
  it('ignores cursor outside a code block', () => {
    const r = run('- foo', 5);
    expect(r.ran).toBe(false);
  });

  it('ignores top-level (non-nested) code blocks', () => {
    const doc = '```python\nx = 1\n```\n';
    // Cursor at end of "x = 1" — pos 15
    const r = run(doc, 15);
    expect(r.ran).toBe(false);
  });

  it('preserves indent on Enter inside a list-nested code block', () => {
    // `- ` + ```python\n  x = 1\n  ```
    // Layout (col): "- ```python\n  x = 1\n  ```\n"
    // Cursor at end of "  x = 1" line.
    const doc = '- ```python\n  x = 1\n  ```\n';
    const cursor = doc.indexOf('x = 1') + 'x = 1'.length;
    const r = run(doc, cursor);
    expect(r.ran).toBe(true);
    expect(r.doc).toBe('- ```python\n  x = 1\n  \n  ```\n');
  });

  it('exits the code block and opens a new bullet on Enter at the closing fence', () => {
    const doc = '- ```python\n  x = 1\n  ```';
    // Cursor on the closing-fence line, at end.
    const cursor = doc.length;
    const r = run(doc, cursor);
    expect(r.ran).toBe(true);
    // New bullet at parent indent (here col 0).
    expect(r.doc).toBe('- ```python\n  x = 1\n  ```\n- ');
    // Cursor lands right after the new bullet.
    expect(r.cursor).toBe(r.doc.length);
  });

  it('opens new bullet at the parent indent for nested lists', () => {
    // Nested list: outer "- a", inner "  - ```python\n    x\n    ```"
    const doc = '- a\n  - ```python\n    x\n    ```';
    const cursor = doc.length;
    const r = run(doc, cursor);
    expect(r.ran).toBe(true);
    expect(r.doc).toBe('- a\n  - ```python\n    x\n    ```\n  - ');
  });

  it('continues with deeper indent if the line is already indented past content column', () => {
    // line has extra indent (4 spaces) — should mirror it.
    const doc = '- ```python\n    deep = 1\n  ```\n';
    const cursor = doc.indexOf('deep = 1') + 'deep = 1'.length;
    const r = run(doc, cursor);
    expect(r.ran).toBe(true);
    expect(r.doc).toBe('- ```python\n    deep = 1\n    \n  ```\n');
  });
});
