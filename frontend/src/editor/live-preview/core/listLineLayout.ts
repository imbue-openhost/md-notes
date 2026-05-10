// Shared per-line layout for list lines (bullets, ordered, tasks).
//
// A list line is rendered as up to three regions:
//
//   [indent span][marker span][text]
//
// - The indent span replaces the leading whitespace with a widget whose
//   DOM contains 2× the source whitespace (so 2 spaces in source → 4
//   space chars in DOM). Source/clipboard text is unchanged; only the
//   visual width grows.
// - The marker span is owned by the calling plugin (bullet renders `-`,
//   task renders a checkbox). This module returns the source bounds the
//   plugin should replace and the depth class it should attach.
// - The line itself gets a hanging indent via inline `text-indent` and
//   `padding-inline-start`, computed in CSS px from the measured space
//   width. Wrapped continuation lines align under the bullet's text
//   column.

import { EditorState, Range } from '@codemirror/state';
import { Decoration, WidgetType } from '@codemirror/view';
import { spaceWidth } from './spaceWidth';

// Natural left padding of `.cm-line` in the editor theme (`padding: 0 16px`).
// List lines need to *add* their hanging-indent prefix to this rather than
// replace it, so the bullet on a list line sits at the same column as the
// first character of a non-list line. Kept in sync with theme/default.ts.
const CM_LINE_PADDING_PX = 16;

class IndentSpacesWidget extends WidgetType {
  constructor(
    readonly sourceIndent: number,
    readonly depth: number,
  ) {
    super();
  }
  eq(other: IndentSpacesWidget) {
    return other.sourceIndent === this.sourceIndent && other.depth === this.depth;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-hmd-list-indent cm-hmd-list-indent-${this.depth - 1}`;
    // 2× source whitespace, all literal spaces (no tab expansion logic).
    // Tabs in source would map to 2 visual chars each — same rule.
    span.textContent = ' '.repeat(this.sourceIndent * 2);
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

export interface ListLineLayout {
  /** 1-based nesting depth (cm-list-N, HyperMD-list-line-N). */
  depth: number;
  /** Number of leading whitespace chars on the source line. */
  sourceIndent: number;
  /** Length of marker run in source chars, including the trailing space. */
  markerLength: number;
  /** Source position where the marker run starts. */
  markerFrom: number;
  /** Source position one past the marker run (i.e. start of text). */
  markerEnd: number;
  /** Indent decoration replacing leading whitespace (omitted at depth 1). */
  indentDecoration: Range<Decoration> | null;
  /** Line decoration carrying the hanging-indent inline style. */
  lineDecoration: Range<Decoration>;
  /** Visual prefix width in px (indent + marker), for nested code blocks. */
  prefixPx: number;
}

/**
 * Compute layout for a single list line, given the source position of the
 * `ListMark` node, the line containing it, and the list-nesting depth.
 *
 * The caller is responsible for emitting the marker decoration (a bullet
 * widget or a task checkbox) over [markerFrom, markerEnd).
 *
 * `markerWidthPxOverride` lets the caller substitute the marker's *visual*
 * pixel width when it's not equal to `markerLength × spaceWidth` — most
 * importantly for task lines, where a checkbox widget is wider than the
 * `- ` source it replaces.
 */
export function listLineLayout(
  state: EditorState,
  line: { from: number; to: number; text: string },
  listMark: { from: number; to: number },
  depth: number,
  markerWidthPxOverride?: number,
): ListLineLayout {
  const sourceIndent = /^[ \t]*/.exec(line.text)![0].length;
  const afterMarker = line.text.slice(listMark.to - line.from);
  const wsAfterMarker = /^[ \t]*/.exec(afterMarker)![0].length;

  // Marker run = the marker chars themselves plus exactly one trailing
  // space. Extra whitespace beyond that stays in the text region (matches
  // CommonMark — only the first space is part of the marker syntax).
  const trailingSpace = wsAfterMarker > 0 ? 1 : 0;
  const markerFrom = listMark.from;
  const markerEnd = listMark.to + trailingSpace;
  const markerLength = markerEnd - markerFrom;

  const sw = spaceWidth(state);
  const markerPx = markerWidthPxOverride ?? markerLength * sw;
  const prefixPx = sourceIndent * 2 * sw + markerPx;

  const indentDecoration =
    sourceIndent > 0
      ? Decoration.replace({
          widget: new IndentSpacesWidget(sourceIndent, depth),
        }).range(line.from, line.from + sourceIndent)
      : null;

  // padding-inline-start = natural cm-line padding + the prefix, so the
  // first-line text-indent pulls the bullet back to the *natural* margin
  // (where non-list lines like a leading paragraph sit). Wrapped lines
  // start at margin + prefix so they align under the bullet's text.
  const padPx = CM_LINE_PADDING_PX + prefixPx;
  const lineDecoration = Decoration.line({
    attributes: {
      style: `text-indent: -${prefixPx}px; padding-inline-start: ${padPx}px;`,
    },
  }).range(line.from);

  return {
    depth,
    sourceIndent,
    markerLength,
    markerFrom,
    markerEnd,
    indentDecoration,
    lineDecoration,
    prefixPx,
  };
}
