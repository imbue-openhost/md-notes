// Visual layout for bullet and ordered list lines.
//
// For each list line we emit, in order:
//   1. An indent replace decoration that swaps the leading whitespace for
//      a span containing 2× as many literal space chars (4ch visual per
//      source level, with 2 source spaces per level). Source text and
//      clipboard output are unchanged.
//   2. A marker replace decoration that swaps the `- ` (or `1. ` etc.)
//      for an Obsidian-shaped span: an outer `cm-formatting` wrapper
//      containing a `<span class="list-bullet">…</span>` and the literal
//      trailing space. Skipped when the cursor is on the marker so the
//      user can edit it as raw source.
//   3. A `cm-list-N` mark decoration over the remaining text on the
//      line (so theme rules can target depth-specific styling).
//   4. A line decoration with `text-indent` / `padding-inline-start`
//      computed from a measured space width — gives wrapped continuation
//      lines a hanging indent under the bullet's text column.
//
// Task list lines (`- [ ]`/`- [x]`) are skipped here; `taskListPlugin`
// owns their full layout (it calls the same `listLineLayout` helper so
// indent/line-style stay byte-identical to non-task lines at the same
// depth).

import { syntaxTree } from '@codemirror/language';
import { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { SyntaxNode } from '@lezer/common';
import { listLineLayout } from '../core/listLineLayout';
import { spaceWidth, spaceWidthField } from '../core/spaceWidth';

class BulletMarkerWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(other: BulletMarkerWidget) {
    return other.depth === this.depth;
  }
  toDOM() {
    const outer = document.createElement('span');
    outer.className = `cm-formatting cm-formatting-list cm-formatting-list-ul cm-list-${this.depth}`;
    const inner = document.createElement('span');
    inner.className = 'list-bullet';
    inner.textContent = '-';
    outer.appendChild(inner);
    outer.appendChild(document.createTextNode(' '));
    return outer;
  }
  ignoreEvent() {
    return false;
  }
}

class OrderedMarkerWidget extends WidgetType {
  constructor(readonly text: string, readonly depth: number) {
    super();
  }
  eq(other: OrderedMarkerWidget) {
    return other.text === this.text && other.depth === this.depth;
  }
  toDOM() {
    const outer = document.createElement('span');
    outer.className = `cm-formatting cm-formatting-list cm-formatting-list-ol cm-list-${this.depth}`;
    outer.appendChild(document.createTextNode(this.text + ' '));
    return outer;
  }
  ignoreEvent() {
    return false;
  }
}

const TASK_RE = /^\s*\[[ xX]\]/;
const MARKER_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/;

// Decoration to hide the leading whitespace on a continuation line: zero
// visual width, but preserves the source chars in the document so cursor
// navigation, selection, and copy still see them.
const hideLeadingWs = Decoration.replace({});

// Walk up `node`'s ancestors, returning the innermost ListItem and the
// number of BulletList/OrderedList ancestors seen along the way (which is
// the list-nesting depth of that ListItem, 1-based). Returns `null` if
// no ListItem ancestor exists, or if a FencedCode is encountered first
// (those are owned by the codeBlock plugin).
function findListItemAncestor(
  node: SyntaxNode,
): { item: SyntaxNode; depth: number } | null {
  let item: SyntaxNode | null = null;
  let depth = 0;
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.name === 'FencedCode') return null;
    if (!item && cur.name === 'ListItem') item = cur;
    if (cur.name === 'BulletList' || cur.name === 'OrderedList') depth++;
    cur = cur.parent;
  }
  return item ? { item, depth } : null;
}

export function buildListIndentDecorations(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  const ranges = state.selection.ranges;
  // Track which line numbers were handled as marker lines so the
  // continuation-line pass can skip them.
  const markerLineNums = new Set<number>();

  for (const { from, to } of visibleRanges) {
    let listDepth = 0;

    tree.iterate({
      from,
      to,
      enter: (n) => {
        if (n.name === 'BulletList' || n.name === 'OrderedList') {
          listDepth++;
          return;
        }
        if (n.name !== 'ListMark') return;

        const line = state.doc.lineAt(n.from);
        const afterMarker = line.text.slice(n.to - line.from);
        // Task-list lines belong to taskListPlugin.
        if (TASK_RE.test(afterMarker)) {
          markerLineNums.add(line.number);
          return;
        }
        markerLineNums.add(line.number);

        const layout = listLineLayout(state, line, n, listDepth);
        if (layout.indentDecoration) decorations.push(layout.indentDecoration);
        decorations.push(layout.lineDecoration);

        const markerText = state.doc.sliceString(n.from, n.to);
        const isOrdered = /^\d+[.)]$/.test(markerText);

        const cursorOnMarker = ranges.some(
          (r) => r.from <= layout.markerEnd && r.to >= layout.markerFrom,
        );

        if (!cursorOnMarker && layout.markerLength > 0) {
          const widget = isOrdered
            ? new OrderedMarkerWidget(markerText, listDepth)
            : new BulletMarkerWidget(listDepth);
          decorations.push(
            Decoration.replace({ widget }).range(layout.markerFrom, layout.markerEnd),
          );
        }

        // Mark the rest of the line text with cm-list-N. Empty list items
        // (just `- `) have nothing past markerEnd; skip in that case.
        if (layout.markerEnd < line.to) {
          decorations.push(
            Decoration.mark({ class: `cm-list-${listDepth}` }).range(
              layout.markerEnd,
              line.to,
            ),
          );
        }
      },
      leave: (n) => {
        if (n.name === 'BulletList' || n.name === 'OrderedList') listDepth--;
      },
    });

    // Second pass: continuation lines.
    //
    // A continuation line is a line inside a ListItem that doesn't
    // itself carry a ListMark. CommonMark requires its leading
    // whitespace to be ≥ the parent's content column. We render it
    // with `padding-inline-start: parentPrefixPx` so its text aligns
    // under the bullet's text column, and hide the literal leading
    // whitespace so it doesn't double-indent.
    const sw = spaceWidth(state);
    const startLine = state.doc.lineAt(from).number;
    const endLine = state.doc.lineAt(to).number;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (markerLineNums.has(lineNum)) continue;
      const line = state.doc.line(lineNum);
      if (!line.text.trim()) continue;
      // Code-fence open/close lines (`  ```lang` / `  ```\n`) sit
      // *inside* a ListItem in the syntax tree but the codeBlock plugin
      // owns their visual layout. Skip so we don't emit a competing
      // line decoration.
      if (/^[ \t]*```/.test(line.text)) continue;

      const ancestor = findListItemAncestor(tree.resolveInner(line.from, 1));
      if (!ancestor) continue;

      // Compute the parent ListItem's prefixPx from its marker line.
      const markerLine = state.doc.lineAt(ancestor.item.from);
      const m = MARKER_RE.exec(markerLine.text);
      if (!m) continue;
      const parentSourceIndent = m[1].length;
      // Marker run = marker chars + one trailing space (rest is text).
      const parentMarkerLen = m[2].length + 1;
      const prefixPx = (parentSourceIndent * 2 + parentMarkerLen) * sw;

      const lineSourceIndent = /^[ \t]*/.exec(line.text)![0].length;
      if (lineSourceIndent > 0) {
        decorations.push(
          hideLeadingWs.range(line.from, line.from + lineSourceIndent),
        );
      }
      decorations.push(
        Decoration.line({
          attributes: {
            style: `padding-inline-start: ${prefixPx}px;`,
          },
        }).range(line.from),
      );
    }
  }

  return Decoration.set(decorations.sort((a, b) => a.from - b.from), true);
}

export const listVisualIndentPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildListIndentDecorations(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate) {
      const spaceWidthChanged =
        update.startState.field(spaceWidthField, false) !==
        update.state.field(spaceWidthField, false);
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        spaceWidthChanged
      ) {
        this.decorations = buildListIndentDecorations(
          update.state,
          update.view.visibleRanges,
        );
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        return view.plugin(plugin)?.decorations || Decoration.none;
      }),
  },
);
