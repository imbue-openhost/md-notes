/**
 * Code Block Plugin
 *
 * Implements syntax highlighting preview for Markdown code blocks
 * Shows rendered result when cursor is outside code block, shows source when inside
 * Supports precise click position mapping
 *
 * Modes:
 * - auto: shows rendered widget normally, switches to source on cursor enter
 * - toggle: shows rendered widget by default, requires explicit button click for source
 * - inline: replaces only fence lines, keeps code content in contentDOM for native editing
 */

import { syntaxTree } from '@codemirror/language';
import { EditorState, Extension, Range, StateField } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
} from '@codemirror/view';
import { shouldShowSource } from '../core/shouldShowSource';
import { collapseOnSelectionFacet } from '../core/facets';
import { mouseSelectingField } from '../core/mouseSelecting';
import { getCodeBlockInListContext } from '../core/listContext';
import { spaceWidth, setSpaceWidth } from '../core/spaceWidth';
import {
  createCodeBlockSourceToggleWidget,
  createCodeBlockWidget,
} from '../widgets/codeBlockWidget';
import { highlightCodeHast } from '../utils/codeHighlight';
import {
  CodeBlockSourceModeToggle,
  setCodeBlockSourceMode,
} from './codeBlockEffects';

/**
 * Code block plugin configuration
 */
export interface CodeBlockOptions {
  /** Whether to show line numbers, default false */
  lineNumbers?: boolean;
  /** Whether to show copy button, default true */
  copyButton?: boolean;
  /** Default language, default 'text' */
  defaultLanguage?: string;
  /** Interaction mode: auto follows cursor, toggle uses explicit button, inline keeps code editable */
  interaction?: 'auto' | 'toggle' | 'inline';
}

export interface CodeBlockEditorOptions
  extends Omit<CodeBlockOptions, 'interaction'> {}

const defaultOptions: Required<CodeBlockOptions> = {
  lineNumbers: false,
  copyButton: true,
  defaultLanguage: 'text',
  interaction: 'auto',
};

/**
 * Languages to skip (handled by other plugins)
 */
const SKIP_LANGUAGES = new Set(['math']);

interface CodeBlockSourceRange {
  from: number;
  to: number;
}

function rangesOverlap(a: CodeBlockSourceRange, b: CodeBlockSourceRange): boolean {
  return a.from <= b.to && a.to >= b.from;
}

function removeRange(
  ranges: CodeBlockSourceRange[],
  target: CodeBlockSourceRange
): CodeBlockSourceRange[] {
  return ranges.filter((range) => !rangesOverlap(range, target));
}

function addRange(
  ranges: CodeBlockSourceRange[],
  next: CodeBlockSourceRange
): CodeBlockSourceRange[] {
  if (ranges.some((range) => rangesOverlap(range, next))) {
    return ranges;
  }
  return [...ranges, next];
}

function isCodeBlockInSourceMode(
  ranges: CodeBlockSourceRange[],
  from: number,
  to: number
): boolean {
  return ranges.some((range) => range.from <= to && range.to >= from);
}

const codeBlockSourceModeField = StateField.define<CodeBlockSourceRange[]>({
  create: () => [],
  update(ranges, tr) {
    let next = ranges.map((range) => ({
      from: tr.changes.mapPos(range.from, 1),
      to: tr.changes.mapPos(range.to, -1),
    }));

    for (const effect of tr.effects) {
      if (!effect.is(setCodeBlockSourceMode)) continue;
      const { from, to, showSource } = effect.value as CodeBlockSourceModeToggle;
      const mapped = {
        from: tr.changes.mapPos(from, 1),
        to: tr.changes.mapPos(to, -1),
      };
      next = showSource ? addRange(next, mapped) : removeRange(next, mapped);
    }

    return next;
  },
});

// ─── HAST → Mark decorations ──────────────────────────────────────────

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

/**
 * Convert lowlight HAST tree to Decoration.mark ranges for syntax highlighting.
 * Walks the tree and creates mark decorations for text nodes with CSS classes.
 */
function hastToMarkDecorations(
  root: HastNode,
  basePos: number
): Range<Decoration>[] {
  const result: Range<Decoration>[] = [];
  let offset = 0;

  function walk(node: HastNode, cls?: string) {
    if (node.type === 'text') {
      const len = node.value?.length || 0;
      if (cls && len > 0) {
        result.push(
          Decoration.mark({ class: cls }).range(
            basePos + offset,
            basePos + offset + len
          )
        );
      }
      offset += len;
    } else if (node.type === 'element' || node.type === 'root') {
      const nodeClass = node.properties?.className?.join(' ');
      const effectiveClass = nodeClass || cls;
      if (node.children) {
        for (const child of node.children) {
          walk(child, effectiveClass);
        }
      }
    }
  }

  walk(root);
  return result;
}

// ─── Build inline decorations ─────────────────────────────────────────

/**
 * Whether a selection touches the block. Unlike shouldShowSource, this
 * ignores the mouse-drag flag: a drag selection reaching a code block must
 * reveal the fences immediately, because the fences are part of what a copy
 * of that selection produces.
 */
function selectionTouchesBlock(
  state: EditorState,
  from: number,
  to: number
): boolean {
  if (!state.facet(collapseOnSelectionFacet)) return false;
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from
  );
}

/**
 * Build decorations for inline mode (live preview). The block renders as a
 * flat tinted panel of real lines; the only thing that changes with the
 * selection is fence visibility:
 * - Selection outside the block: fence text is invisible (visibility:hidden
 *   keeps its layout space, so block height never changes).
 * - Selection touching the block: fence text shows as muted styled text.
 *
 * An unclosed block extends to the end of the document (CommonMark), and we
 * style it that way too, like Obsidian — the parser already treats the rest
 * of the doc as code, so pretending otherwise just un-styles it confusingly.
 */
function buildCodeBlockInlineDecorations(
  state: EditorState,
  options: Required<CodeBlockOptions>
): DecorationSet {
  const decorations: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return;

      // Get language info
      const codeInfo = node.node.getChild('CodeInfo');
      let language = options.defaultLanguage;
      if (codeInfo) {
        language = state.doc.sliceString(codeInfo.from, codeInfo.to).trim();
      }

      // Skip special languages
      if (SKIP_LANGUAGES.has(language)) return;

      // Get code content
      const codeText = node.node.getChild('CodeText');
      const code = codeText
        ? state.doc.sliceString(codeText.from, codeText.to)
        : '';

      // If this code block is nested inside a list item, compute the
      // visual indent so its widgets and lines align with the list's
      // content column.
      //
      // Visual prefix = (sourceIndent × 2 + markerLength) × spaceWidth.
      // contentColumn = sourceIndent + markerLength, so:
      //   visualPx = (listMarkerIndent + contentColumn) × spaceWidth.
      const inListCtx = getCodeBlockInListContext(state, node.from);
      const sw = spaceWidth(state);
      const indentPx = inListCtx
        ? (inListCtx.list.listMarkerIndent + inListCtx.list.contentColumn) * sw
        : 0;
      const lineAttrs = indentPx > 0
        ? { style: `--cb-indent: ${indentPx}px;` }
        : undefined;

      const openFenceLine = state.doc.lineAt(node.from);
      const closeFenceLine = state.doc.lineAt(node.to);
      // A block still being typed has no closing fence; its last line is
      // real content, not a fence.
      const closed =
        closeFenceLine.number > openFenceLine.number &&
        node.node.getChildren('CodeMark').length >= 2;

      const reveal = selectionTouchesBlock(state, node.from, node.to);

      const fenceLines = closed
        ? [openFenceLine, closeFenceLine]
        : [openFenceLine];
      for (const line of fenceLines) {
        decorations.push(
          Decoration.line({
            class: 'cm-codeblock-content cm-codeblock-fence',
            attributes: lineAttrs,
          }).range(line.from)
        );
        if (!reveal && line.from < line.to) {
          decorations.push(
            Decoration.mark({ class: 'cm-codeblock-fence-hidden' }).range(
              line.from,
              line.to
            )
          );
        }
      }

      // Line decorations for every content line between fences
      const lastContentLine = closed
        ? closeFenceLine.number - 1
        : closeFenceLine.number;
      for (
        let lineNum = openFenceLine.number + 1;
        lineNum <= lastContentLine;
        lineNum++
      ) {
        const line = state.doc.line(lineNum);
        decorations.push(
          Decoration.line({
            class: 'cm-codeblock-content',
            attributes: lineAttrs,
          }).range(line.from)
        );
      }

      // Mark decorations for syntax highlighting (from hast)
      if (codeText && code) {
        const hast = highlightCodeHast(code, language || undefined);
        if (hast) {
          const marks = hastToMarkDecorations(hast as HastNode, codeText.from);
          for (const mark of marks) {
            if (mark.from >= 0 && mark.to <= state.doc.length) {
              decorations.push(mark);
            }
          }
        }
      }
    },
  });

  return Decoration.set(decorations.sort((a, b) => a.from - b.from), true);
}

// ─── Build standard decorations (auto/toggle) ────────────────────────

/**
 * Build code block decorations for auto/toggle mode
 */
function buildCodeBlockDecorations(
  state: EditorState,
  options: Required<CodeBlockOptions>
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const isAutoInteraction = options.interaction === 'auto';
  const isDrag = isAutoInteraction ? state.field(mouseSelectingField, false) : false;
  const sourceRanges = state.field(codeBlockSourceModeField);

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'FencedCode') {
        // Get language info
        const codeInfo = node.node.getChild('CodeInfo');
        let language = options.defaultLanguage;

        if (codeInfo) {
          language = state.doc.sliceString(codeInfo.from, codeInfo.to).trim();
        }

        // Skip special languages (like math)
        if (SKIP_LANGUAGES.has(language)) {
          return;
        }

        // Get code content
        const codeText = node.node.getChild('CodeText');
        const code = codeText
          ? state.doc.sliceString(codeText.from, codeText.to)
          : '';
        const codeFrom = codeText ? codeText.from : node.from;

        // Calculate start position of each line
        const lineStarts: number[] = [];
        if (codeText) {
          const startPos = codeText.from;
          lineStarts.push(startPos);
          for (let i = 0; i < code.length; i++) {
            if (code[i] === '\n') {
              lineStarts.push(startPos + i + 1);
            }
          }
        }

        const showSource =
          options.interaction === 'toggle'
            ? isCodeBlockInSourceMode(sourceRanges, node.from, node.to)
            : shouldShowSource(state, node.from, node.to) || isDrag;

        if (!showSource) {
          // Render mode: show widget
          const widget = createCodeBlockWidget({
            code,
            language,
            showLineNumbers: options.lineNumbers,
            showCopyButton: options.copyButton,
            showSourceToggle: options.interaction === 'toggle',
            from: node.from,
            to: node.to,
            codeFrom,
            lineStarts,
          });

          decorations.push(
            Decoration.replace({ widget, block: true }).range(node.from, node.to)
          );
        } else {
          if (options.interaction === 'toggle') {
            const sourceToggleWidget = createCodeBlockSourceToggleWidget(
              node.from,
              node.to
            );
            decorations.push(
              Decoration.widget({ widget: sourceToggleWidget, block: true }).range(
                node.from
              )
            );
          }

          // Source mode: add background to each line
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            decorations.push(
              Decoration.line({ class: 'cm-codeblock-source' }).range(line.from)
            );
            pos = line.to + 1;
          }
        }
      }
    },
  });

  return Decoration.set(decorations.sort((a, b) => a.from - b.from), true);
}

/**
 * Key identifying which code blocks the selection currently touches.
 * Cheap: only walks the tree around the selection ranges. Used to skip
 * rebuilds on cursor moves that don't change any block's fence visibility.
 */
function revealedBlocksKey(state: EditorState): string {
  const keys = new Set<string>();
  const tree = syntaxTree(state);
  for (const range of state.selection.ranges) {
    tree.iterate({
      from: Math.max(0, range.from - 1),
      to: Math.min(state.doc.length, range.to + 1),
      enter: (node) => {
        if (node.name !== 'FencedCode') return;
        if (range.from <= node.to && range.to >= node.from) {
          keys.add(`${node.from}:${node.to}`);
        }
      },
    });
  }
  return [...keys].sort().join(',');
}

/**
 * Create code block StateField
 */
function createCodeBlockField(
  options: Required<CodeBlockOptions>
): StateField<DecorationSet> {
  const isInline = options.interaction === 'inline';
  const buildFn = isInline ? buildCodeBlockInlineDecorations : buildCodeBlockDecorations;

  return StateField.define<DecorationSet>({
    create(state) {
      return buildFn(state, options);
    },

    update(deco, tr) {
      // Rebuild on document, config, source-mode toggle, or measured
      // space-width change (the latter shifts every list-nested code
      // block's --cb-indent and the header/footer widget margins).
      if (
        tr.docChanged ||
        tr.reconfigured ||
        tr.effects.some(
          (effect) => effect.is(setCodeBlockSourceMode) || effect.is(setSpaceWidth),
        )
      ) {
        return buildFn(tr.state, options);
      }

      // Toggle mode: fence visibility is explicit, not selection-driven
      if (options.interaction === 'toggle') {
        return deco;
      }

      // Inline mode: fences follow the selection (live preview). Rebuild
      // only when the set of selection-touched blocks changes — including
      // mid-drag, so a drag selection reveals fences the moment it reaches
      // a block.
      if (options.interaction === 'inline') {
        if (
          tr.selection &&
          tr.state.facet(collapseOnSelectionFacet) &&
          revealedBlocksKey(tr.startState) !== revealedBlocksKey(tr.state)
        ) {
          return buildFn(tr.state, options);
        }
        return deco;
      }

      // Auto mode below: rebuild on drag state change
      const isDragging = tr.state.field(mouseSelectingField, false);
      const wasDragging = tr.startState.field(mouseSelectingField, false);

      if (wasDragging && !isDragging) {
        return buildFn(tr.state, options);
      }

      // Keep unchanged during drag
      if (isDragging) {
        return deco;
      }

      // Rebuild on selection change, but only if the cursor moved to a
      // different line — prevents infinite recursion when decoration
      // changes trigger layout updates that cause further selection events.
      if (tr.selection) {
        const oldLine = tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
        const newLine = tr.state.doc.lineAt(tr.state.selection.main.head).number;
        if (oldLine !== newLine) {
          return buildFn(tr.state, options);
        }
      }

      return deco;
    },

    provide: (f) => EditorView.decorations.from(f),
  });
}

/**
 * Code block plugin
 *
 * @param options - Configuration options
 * @returns Extension array (StateField + click handler)
 *
 * @example
 * ```typescript
 * import { codeBlockField } from 'codemirror-live-markdown';
 *
 * // Use default config
 * extensions: [codeBlockField()]
 *
 * // Custom config
 * extensions: [codeBlockField({
 *   lineNumbers: true,
 *   copyButton: true,
 *   defaultLanguage: 'javascript',
 * })]
 *
 * // Inline mode (editable in-place)
 * extensions: [codeBlockField({
 *   interaction: 'inline',
 *   copyButton: true,
 * })]
 * ```
 */
// Selection over code-block content needs no special handling:
// .cm-codeblock-content's background is translucent, so drawSelection's
// layer (rendered behind .cm-content) shows through, same as inline code.
export function codeBlockField(options?: CodeBlockOptions): Extension {
  const mergedOptions = { ...defaultOptions, ...options };
  return [codeBlockSourceModeField, createCodeBlockField(mergedOptions)];
}

export function codeBlockEditorPlugin(options?: CodeBlockEditorOptions) {
  return codeBlockField({
    ...options,
    interaction: 'toggle',
  });
}

export { setCodeBlockSourceMode };
