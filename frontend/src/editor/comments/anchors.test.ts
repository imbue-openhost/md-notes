import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { encodeAnchors, resolveAnchors } from './anchors';

function makeDoc(content: string): { ydoc: Y.Doc; ytext: Y.Text } {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  ytext.insert(0, content);
  return { ydoc, ytext };
}

describe('comment anchors', () => {
  it('round-trips a span', () => {
    const { ydoc, ytext } = makeDoc('hello brave new world');
    const { anchorStart, anchorEnd } = encodeAnchors(ytext, 6, 15);
    expect(resolveAnchors(ydoc, anchorStart, anchorEnd)).toEqual({ from: 6, to: 15 });
  });

  it('tracks edits before and inside the span', () => {
    const { ydoc, ytext } = makeDoc('hello brave new world');
    const { anchorStart, anchorEnd } = encodeAnchors(ytext, 6, 15); // "brave new"
    ytext.insert(0, 'XYZ '); // shift right by 4
    expect(resolveAnchors(ydoc, anchorStart, anchorEnd)).toEqual({ from: 10, to: 19 });
    ytext.insert(12, '!!'); // inside the span: grows
    expect(resolveAnchors(ydoc, anchorStart, anchorEnd)).toEqual({ from: 10, to: 21 });
  });

  it('does not grow when text is inserted at the span edges', () => {
    const { ydoc, ytext } = makeDoc('hello brave new world');
    const { anchorStart, anchorEnd } = encodeAnchors(ytext, 6, 15);
    ytext.insert(6, 'AT-START '); // right before the span
    ytext.insert(24 + 9 - 9, ''); // no-op, keep math obvious
    const resolved = resolveAnchors(ydoc, anchorStart, anchorEnd)!;
    expect(ytext.toString().slice(resolved.from, resolved.to)).toBe('brave new');
    ytext.insert(resolved.to, ' AT-END');
    const after = resolveAnchors(ydoc, anchorStart, anchorEnd)!;
    expect(ytext.toString().slice(after.from, after.to)).toBe('brave new');
  });

  it('returns null when the whole span is deleted', () => {
    const { ydoc, ytext } = makeDoc('hello brave new world');
    const { anchorStart, anchorEnd } = encodeAnchors(ytext, 6, 15);
    ytext.delete(6, 10); // "brave new " gone
    expect(resolveAnchors(ydoc, anchorStart, anchorEnd)).toBeNull();
  });

  it('survives partial deletion of the span', () => {
    const { ydoc, ytext } = makeDoc('hello brave new world');
    const { anchorStart, anchorEnd } = encodeAnchors(ytext, 6, 15);
    ytext.delete(6, 6); // "brave " gone, "new" remains
    expect(resolveAnchors(ydoc, anchorStart, anchorEnd)).toEqual({ from: 6, to: 9 });
  });

  it('returns null on garbage input', () => {
    const { ydoc } = makeDoc('hello');
    expect(resolveAnchors(ydoc, '!!!not-base64!!!', 'AAAA')).toBeNull();
  });
});
