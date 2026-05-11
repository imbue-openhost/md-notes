// StateField holding the currently detected indent unit, re-derived from
// doc content. Also exposes a compute hookup for CodeMirror's `indentUnit`
// facet so `indentMore`/`indentLess`/`indentString` use the detected unit.

import { EditorState, Extension, StateField } from '@codemirror/state';
import { indentUnit as cmIndentUnit } from '@codemirror/language';
import {
  DEFAULT_INDENT_UNIT,
  IndentUnit,
  detectIndentUnit,
  indentUnitString,
} from './detectIndent';

function unitEq(a: IndentUnit, b: IndentUnit): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'tab' || b.kind === 'tab') return a.kind === b.kind;
  return a.width === b.width;
}

// Detection runs on first load only: either at field creation (if the
// doc is already non-empty) or on the first docChange that transitions
// the doc from empty → non-empty (the async sync-session load case).
// After that the unit stays fixed, so editing doesn't flip it mid-stream.
export const indentUnitField = StateField.define<IndentUnit>({
  create: (state) =>
    state.doc.length > 0 ? detectIndentUnit(state.doc) : DEFAULT_INDENT_UNIT,
  update(value, tr) {
    if (!tr.docChanged) return value;
    if (tr.startState.doc.length > 0 || tr.state.doc.length === 0) return value;
    const next = detectIndentUnit(tr.state.doc);
    return unitEq(value, next) ? value : next;
  },
});

export function indentUnitOf(state: EditorState): IndentUnit {
  return state.field(indentUnitField, false) ?? DEFAULT_INDENT_UNIT;
}

export function indentDetection(): Extension {
  return [
    indentUnitField,
    cmIndentUnit.compute([indentUnitField], (state) =>
      indentUnitString(state.field(indentUnitField)),
    ),
  ];
}
