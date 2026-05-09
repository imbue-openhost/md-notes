import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { setSpaceWidth, spaceWidth, spaceWidthField } from './spaceWidth';

describe('spaceWidthField', () => {
  it('returns the default before any measurement is dispatched', () => {
    const state = EditorState.create({ extensions: [spaceWidthField] });
    expect(spaceWidth(state)).toBe(4);
  });

  it('falls back to the default when the field is not installed', () => {
    const state = EditorState.create({ doc: 'hi' });
    expect(spaceWidth(state)).toBe(4);
  });

  it('updates when setSpaceWidth is dispatched', () => {
    const initial = EditorState.create({ extensions: [spaceWidthField] });
    const next = initial.update({ effects: setSpaceWidth.of(7.25) }).state;
    expect(spaceWidth(next)).toBe(7.25);
  });
});
