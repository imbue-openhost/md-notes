/**
 * CommentsController — the hub between the synced Y.Doc, the CodeMirror extension, and the side panel.
 *
 * Reads the 'comments' Y.Map (all writes go through the REST api and come back via sync), resolves anchors
 * to editor offsets on every doc update (microtask-coalesced), and pushes highlight spans into the editor
 * while notifying panel subscribers. Threads whose span has been deleted resolve to nothing and are hidden
 * here; the server garbage-collects them on its next save.
 */

import * as Y from 'yjs';
import { EditorView } from '@codemirror/view';
import { encodeAnchors, resolveAnchors, type AnchorPair } from './anchors';
import { setCommentSpans, type CommentSpan } from './extension';
import type { CommentIdentity, CommentRecord, CommentsApi, CommentsState, CommentThread } from './types';

export interface CommentsControllerOptions {
  ydoc: Y.Doc;
  ytext: Y.Text;
  api: CommentsApi;
  identity: CommentIdentity;
  canComment: boolean;
}

const EMPTY_STATE: CommentsState = { threads: [], resolvedThreads: [], activeId: null, draft: null };

export class CommentsController {
  readonly identity: CommentIdentity;
  readonly canComment: boolean;

  private readonly ydoc: Y.Doc;
  private readonly ytext: Y.Text;
  private readonly api: CommentsApi;
  private view: EditorView | null = null;
  private listeners = new Set<(state: CommentsState) => void>();
  private layoutListeners = new Set<() => void>();
  private layoutNotifyQueued = false;
  private state: CommentsState = EMPTY_STATE;
  private draftAnchors: AnchorPair | null = null;
  private pendingActivateId: string | null = null;
  private lastSpanKey = '';
  private recomputeQueued = false;
  private destroyed = false;
  private readonly onDocUpdate = () => this.scheduleRecompute();

  constructor(options: CommentsControllerOptions) {
    this.ydoc = options.ydoc;
    this.ytext = options.ytext;
    this.api = options.api;
    this.identity = options.identity;
    this.canComment = options.canComment;
    this.ydoc.on('update', this.onDocUpdate);
    this.scheduleRecompute();
  }

  getState(): CommentsState {
    return this.state;
  }

  subscribe(listener: (state: CommentsState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  attach(view: EditorView): void {
    this.view = view;
    this.lastSpanKey = '';
    this.pushSpansToView();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ydoc.off('update', this.onDocUpdate);
    this.listeners.clear();
    this.layoutListeners.clear();
    this.view = null;
  }

  // ── card layout support ─────────────────────────────────────────────

  /** Notified when editor geometry shifts (doc edits, line-height changes) and anchor tops move. */
  onLayoutChange(listener: () => void): () => void {
    this.layoutListeners.add(listener);
    return () => this.layoutListeners.delete(listener);
  }

  /** Called by the editor extension; rAF-coalesced since geometry can churn every frame. */
  notifyGeometryChanged(): void {
    if (this.layoutNotifyQueued || this.destroyed) return;
    this.layoutNotifyQueued = true;
    requestAnimationFrame(() => {
      this.layoutNotifyQueued = false;
      if (this.destroyed) return;
      for (const listener of this.layoutListeners) listener();
    });
  }

  /**
   * Document-space top (px, within the editor's scroller) of the line holding a doc position.
   * Uses line-block estimates, so it works for positions outside the rendered viewport.
   */
  anchorTopFor(pos: number): number {
    if (!this.view) return 0;
    const view = this.view;
    const block = view.lineBlockAt(Math.max(0, Math.min(pos, view.state.doc.length)));
    const contentOffset =
      view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
    return block.top + contentOffset;
  }

  // ── actions ─────────────────────────────────────────────────────────

  /** Open the composer for the current selection. Returns false when there's nothing to comment on. */
  startDraftFromSelection(): boolean {
    if (!this.canComment || !this.view) return false;
    const sel = this.view.state.selection.main;
    if (sel.empty) return false;
    this.draftAnchors = encodeAnchors(this.ytext, sel.from, sel.to);
    this.setState({ ...this.state, draft: { from: sel.from, to: sel.to }, activeId: null });
    return true;
  }

  cancelDraft(): void {
    this.draftAnchors = null;
    this.setState({ ...this.state, draft: null });
  }

  async submitDraft(text: string): Promise<void> {
    const anchors = this.draftAnchors;
    if (!anchors) throw new Error('No comment draft in progress');
    const id = await this.api.create({ ...this.authorFields(), text, ...anchors });
    this.draftAnchors = null;
    // The new comment arrives via sync; activate it once it shows up.
    this.pendingActivateId = id;
    this.setState({ ...this.state, draft: null });
  }

  async reply(parentId: string, text: string): Promise<void> {
    await this.api.create({ ...this.authorFields(), text, parentId });
  }

  async editComment(commentId: string, text: string): Promise<void> {
    await this.api.update(commentId, { userId: this.identity.userId, text });
  }

  async setResolved(commentId: string, resolved: boolean): Promise<void> {
    await this.api.update(commentId, { userId: this.identity.userId, resolved });
  }

  async remove(commentId: string): Promise<void> {
    await this.api.remove(commentId, this.identity.userId);
  }

  setActive(id: string | null, opts: { scrollEditor?: boolean } = {}): void {
    if (this.state.activeId !== id) {
      this.setState({ ...this.state, activeId: id });
    }
    if (id && opts.scrollEditor && this.view) {
      const thread = [...this.state.threads, ...this.state.resolvedThreads].find((t) => t.comment.id === id);
      if (thread) {
        const pos = Math.min(thread.from, this.view.state.doc.length);
        this.view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      }
    }
  }

  /** The unresolved thread covering an editor offset, if any (innermost first). */
  threadAt(pos: number): CommentThread | null {
    let best: CommentThread | null = null;
    for (const t of this.state.threads) {
      if (pos >= t.from && pos < t.to && (!best || t.to - t.from < best.to - best.from)) best = t;
    }
    return best;
  }

  private authorFields(): { userId: string; userName: string } {
    const userName = this.identity.getName();
    if (!userName) throw new Error('Display name is required before commenting');
    return { userId: this.identity.userId, userName };
  }

  // ── state recomputation ─────────────────────────────────────────────

  private scheduleRecompute(): void {
    if (this.recomputeQueued || this.destroyed) return;
    this.recomputeQueued = true;
    // Microtask: ydoc 'update' can fire inside a CodeMirror dispatch, where a nested dispatch is illegal.
    queueMicrotask(() => {
      this.recomputeQueued = false;
      if (!this.destroyed) this.recompute();
    });
  }

  private recompute(): void {
    const map = this.ydoc.getMap<CommentRecord>('comments');
    const replies = new Map<string, CommentRecord[]>();
    const tops: CommentRecord[] = [];
    map.forEach((rec) => {
      if (!rec || typeof rec !== 'object' || !rec.id) return;
      if (rec.parentId) {
        const list = replies.get(rec.parentId) ?? [];
        list.push(rec);
        replies.set(rec.parentId, list);
      } else {
        tops.push(rec);
      }
    });

    const threads: CommentThread[] = [];
    const resolvedThreads: CommentThread[] = [];
    for (const rec of tops) {
      if (!rec.anchorStart || !rec.anchorEnd) continue;
      const span = resolveAnchors(this.ydoc, rec.anchorStart, rec.anchorEnd);
      if (!span) continue; // orphaned (span deleted) or undecodable — hidden, server GCs later
      const thread: CommentThread = {
        comment: rec,
        replies: (replies.get(rec.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        from: span.from,
        to: span.to,
      };
      (rec.resolved ? resolvedThreads : threads).push(thread);
    }
    const byPos = (a: CommentThread, b: CommentThread) =>
      a.from - b.from || a.to - b.to || a.comment.createdAt.localeCompare(b.comment.createdAt);
    threads.sort(byPos);
    resolvedThreads.sort(byPos);

    let activeId = this.state.activeId;
    if (this.pendingActivateId && map.has(this.pendingActivateId)) {
      activeId = this.pendingActivateId;
      this.pendingActivateId = null;
    }
    if (activeId && !map.has(activeId)) activeId = null;

    let draft = this.state.draft;
    if (this.draftAnchors) {
      const span = resolveAnchors(this.ydoc, this.draftAnchors.anchorStart, this.draftAnchors.anchorEnd);
      if (span) {
        draft = span;
      } else {
        // The span being commented on was deleted out from under the composer.
        this.draftAnchors = null;
        draft = null;
      }
    }

    this.setState({ threads, resolvedThreads, activeId, draft });
  }

  private setState(state: CommentsState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
    this.pushSpansToView();
  }

  private pushSpansToView(): void {
    if (!this.view) return;
    const spans: CommentSpan[] = [
      ...this.state.threads.map((t) => ({
        from: t.from,
        to: t.to,
        id: t.comment.id,
        active: t.comment.id === this.state.activeId,
        draft: false,
      })),
      ...(this.state.draft ? [{ ...this.state.draft, id: '__draft__', active: true, draft: true }] : []),
    ];
    const key = spans.map((s) => `${s.id}:${s.from}:${s.to}:${s.active ? 1 : 0}`).join('|');
    if (key === this.lastSpanKey) return;
    this.lastSpanKey = key;
    this.view.dispatch({ effects: setCommentSpans.of(spans) });
  }
}
