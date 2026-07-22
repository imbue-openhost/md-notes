/**
 * CodeMirror integration for comments: span highlights, click-to-focus, and the "add comment" margin
 * button. Span positions are pushed in by CommentsController via setCommentSpans; between pushes the
 * decoration set maps through document changes.
 */

import { StateEffect, StateField, Prec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { mouseSelectingField } from '../live-preview/index';
import type { CommentsController } from './controller';

export interface CommentSpan {
  from: number;
  to: number;
  id: string;
  active: boolean;
  draft: boolean;
}

export const setCommentSpans = StateEffect.define<CommentSpan[]>({
  map: (spans, mapping) =>
    spans.map((s) => ({ ...s, from: mapping.mapPos(s.from), to: mapping.mapPos(s.to) })),
});

function buildDecorations(spans: CommentSpan[]): DecorationSet {
  const marks = spans
    .filter((s) => s.from < s.to)
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((s) =>
      Decoration.mark({
        class:
          'cm-comment-span' +
          (s.active ? ' cm-comment-span-active' : '') +
          (s.draft ? ' cm-comment-span-draft' : ''),
      }).range(s.from, s.to),
    );
  return Decoration.set(marks, true);
}

const commentSpansField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setCommentSpans)) deco = buildDecorations(effect.value);
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Speech bubble with a bottom-left tail (matches the comment highlights' bubble metaphor).
const COMMENT_ICON_SVG = `
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M13 2.5H3A1.5 1.5 0 0 0 1.5 4v6A1.5 1.5 0 0 0 3 11.5h1.25v2.1a.35.35 0 0 0 .57.27l2.96-2.37H13A1.5 1.5 0 0 0 14.5 10V4A1.5 1.5 0 0 0 13 2.5Z"/>
  <path d="M4.75 5.75h6.5M4.75 8.25h4"/>
</svg>`;

const SHOW_DELAY_MS = 200;

/**
 * Floating icon button pinned to the editor's right edge, vertically aligned with the selection head.
 * Appears (debounced) whenever a non-empty selection settles; hidden while empty or mid mouse-drag.
 */
function addCommentButton(controller: CommentsController) {
  return ViewPlugin.fromClass(
    class {
      private button: HTMLButtonElement;
      private showTimer: ReturnType<typeof setTimeout> | null = null;
      private visible = false;
      private readonly onScroll = () => {
        if (this.visible) this.position();
      };

      constructor(private view: EditorView) {
        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'cm-add-comment-btn';
        this.button.title = 'Comment on selection (Cmd/Ctrl-Alt-M)';
        this.button.innerHTML = COMMENT_ICON_SVG;
        this.button.style.display = 'none';
        // mousedown would move focus and collapse the selection before click fires.
        this.button.addEventListener('mousedown', (e) => e.preventDefault());
        this.button.addEventListener('click', () => {
          this.hide();
          controller.startDraftFromSelection();
        });
        view.dom.appendChild(this.button);
        view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      }

      update(update: ViewUpdate): void {
        const selectionChanged =
          update.selectionSet || update.startState.field(mouseSelectingField) !== update.state.field(mouseSelectingField);
        if (!selectionChanged && !update.docChanged && !update.geometryChanged) return;

        const sel = update.state.selection.main;
        if (sel.empty || update.state.field(mouseSelectingField)) {
          this.hide();
          return;
        }
        if (this.visible && !update.selectionSet) {
          this.position();
          return;
        }
        if (this.showTimer) clearTimeout(this.showTimer);
        this.showTimer = setTimeout(() => {
          this.showTimer = null;
          this.show();
        }, SHOW_DELAY_MS);
      }

      private show(): void {
        const sel = this.view.state.selection.main;
        if (sel.empty || this.view.state.field(mouseSelectingField)) return;
        this.visible = true;
        this.button.style.display = '';
        this.position();
      }

      private hide(): void {
        if (this.showTimer) {
          clearTimeout(this.showTimer);
          this.showTimer = null;
        }
        this.visible = false;
        this.button.style.display = 'none';
      }

      private position(): void {
        const sel = this.view.state.selection.main;
        const coords = this.view.coordsAtPos(sel.head);
        const editorRect = this.view.dom.getBoundingClientRect();
        const top = coords
          ? Math.min(Math.max(coords.top - editorRect.top, 6), editorRect.height - 34)
          : 6;
        this.button.style.top = `${top}px`;
      }

      destroy(): void {
        if (this.showTimer) clearTimeout(this.showTimer);
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
        this.button.remove();
      }
    },
  );
}

// Card positions derive from line-block geometry, which shifts on edits, wraps, image loads, etc.
// Also publishes the scroller's vertical scrollbar width as a CSS var so the add-comment button and
// toolbar (which live in view.dom, whose right edge includes the scrollbar gutter) can clear it —
// classic scrollbars take ~15px, overlay scrollbars measure 0.
function geometryNotifier(controller: CommentsController) {
  return ViewPlugin.fromClass(
    class {
      private lastScrollbarWidth = -1;
      private readonly measure = {
        read: (view: EditorView) => view.scrollDOM.offsetWidth - view.scrollDOM.clientWidth,
        write: (width: number, view: EditorView) => {
          if (width === this.lastScrollbarWidth) return;
          this.lastScrollbarWidth = width;
          view.dom.style.setProperty('--comments-scrollbar-width', `${width}px`);
        },
      };

      constructor(view: EditorView) {
        view.requestMeasure(this.measure);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.geometryChanged) {
          controller.notifyGeometryChanged();
          update.view.requestMeasure(this.measure);
        }
      }
    },
  );
}

export function commentsExtension(controller: CommentsController) {
  return [
    commentSpansField,
    geometryNotifier(controller),
    EditorView.domEventHandlers({
      click: (event, view) => {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        if (!view.state.selection.main.empty) return false; // finishing a drag-select, not a focus click
        const thread = controller.threadAt(pos);
        if (thread) controller.setActive(thread.comment.id);
        return false;
      },
    }),
    ...(controller.canComment
      ? [
          addCommentButton(controller),
          Prec.high(
            keymap.of([
              {
                key: 'Mod-Alt-m',
                run: () => controller.startDraftFromSelection(),
                preventDefault: true,
              },
            ]),
          ),
        ]
      : []),
  ];
}
