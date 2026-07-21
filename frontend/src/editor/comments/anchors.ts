/**
 * Comment span anchors: Yjs relative positions, base64-encoded for storage.
 *
 * Relative positions reference character identities (clientID + clock), not offsets, so they stay glued to
 * the commented text through concurrent edits and are replica-independent — the server stores and resolves
 * them without needing this client's state. When the whole span is deleted both anchors resolve to the same
 * offset, which callers treat as "orphaned".
 */

import * as Y from 'yjs';

export interface AnchorPair {
  anchorStart: string;
  anchorEnd: string;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encode [from, to) as anchors that hug the span: insertions just outside it don't grow the highlight. */
export function encodeAnchors(ytext: Y.Text, from: number, to: number): AnchorPair {
  const start = Y.createRelativePositionFromTypeIndex(ytext, from, 0);
  const end = Y.createRelativePositionFromTypeIndex(ytext, to, -1);
  return {
    anchorStart: toBase64(Y.encodeRelativePosition(start)),
    anchorEnd: toBase64(Y.encodeRelativePosition(end)),
  };
}

/** Resolve anchors to current offsets; null when undecodable or when the span no longer exists. */
export function resolveAnchors(
  ydoc: Y.Doc,
  anchorStart: string,
  anchorEnd: string,
): { from: number; to: number } | null {
  let start: Y.AbsolutePosition | null;
  let end: Y.AbsolutePosition | null;
  try {
    start = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(anchorStart)), ydoc);
    end = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(anchorEnd)), ydoc);
  } catch {
    return null;
  }
  if (!start || !end) return null;
  if (start.index >= end.index) return null;
  return { from: start.index, to: end.index };
}
