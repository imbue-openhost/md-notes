import { For, Show, createEffect, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { CommentsController } from '../editor/comments/controller';
import { stackCards, type LayoutEntry } from '../editor/comments/stack-cards';
import type { CommentRecord, CommentsState, CommentThread } from '../editor/comments/types';

const DRAFT_ID = '__draft__';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const AVATAR_HUES = [262, 12, 152, 205, 335, 42, 105, 285];

function avatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  const hue = AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length];
  return `hsl(${hue} 55% 52%)`;
}

const Avatar: Component<{ rec: CommentRecord }> = (props) => (
  <span class="comment-avatar" style={{ background: avatarColor(props.rec.userId) }}>
    {(props.rec.userName || '?').trim().charAt(0).toUpperCase()}
  </span>
);

const NameField: Component<{ value: string; onInput: (v: string) => void }> = (props) => (
  <input
    class="comments-name-input"
    type="text"
    placeholder="Your name"
    maxlength={80}
    value={props.value}
    onInput={(e) => props.onInput(e.currentTarget.value)}
  />
);

interface EntryProps {
  controller: CommentsController;
  rec: CommentRecord;
  isReply: boolean;
  /** Whether a sibling entry follows (draws the thread connector line). */
  hasNext: boolean;
  onError: (message: string | null) => void;
}

/** One message in a thread, Linear-style: avatar + name/date row, text underneath, hover actions. */
const Entry: Component<EntryProps> = (props) => {
  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal('');
  const identity = props.controller.identity;
  const isAuthor = () => props.rec.userId === identity.userId;

  async function saveEdit() {
    const text = editText().trim();
    if (!text) return;
    try {
      await props.controller.editComment(props.rec.id, text);
      props.onError(null);
      setEditing(false);
    } catch (e) {
      props.onError(`Failed to save: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await props.controller.remove(props.rec.id);
      props.onError(null);
    } catch (e) {
      props.onError(`Failed to delete: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div class="comment-entry" classList={{ 'comment-entry-reply': props.isReply, 'comment-entry-linked': props.hasNext }}>
      <Avatar rec={props.rec} />
      <div class="comment-entry-head">
        <span class="comment-author">{props.rec.userName}</span>
        <span class="comment-time">
          {formatTime(props.rec.createdAt)}
          {props.rec.editedAt ? ' (edited)' : ''}
        </span>
        <Show when={props.controller.canComment && (isAuthor() || identity.isOwner) && !editing()}>
          <span class="comment-entry-actions">
            <Show when={isAuthor()}>
              <button
                class="comment-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditText(props.rec.text);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            </Show>
            <button class="comment-action-btn" onClick={(e) => { e.stopPropagation(); remove(); }}>
              Delete
            </button>
          </span>
        </Show>
      </div>
      <div class="comment-entry-body">
        <Show
          when={editing()}
          fallback={<div class="comment-text">{props.rec.text}</div>}
        >
          <textarea
            class="comment-textarea"
            rows={2}
            value={editText()}
            onInput={(e) => setEditText(e.currentTarget.value)}
            on:keydown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit();
              if (e.key === 'Escape') setEditing(false);
              e.stopPropagation();
            }}
          />
          <div class="comment-actions">
            <button class="comment-action-btn comment-action-primary" onClick={(e) => { e.stopPropagation(); saveEdit(); }}>
              Save
            </button>
            <button class="comment-action-btn" onClick={(e) => { e.stopPropagation(); setEditing(false); }}>
              Cancel
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};

interface ThreadProps {
  controller: CommentsController;
  thread: CommentThread;
  active: boolean;
  top: number;
  onError: (message: string | null) => void;
  registerEl: (id: string, el: HTMLElement) => void;
}

const ThreadCard: Component<ThreadProps> = (props) => {
  const [replyText, setReplyText] = createSignal('');
  const [nameInput, setNameInput] = createSignal('');
  const identity = props.controller.identity;
  const resolved = () => props.thread.comment.resolved === true;
  const entries = () => [props.thread.comment, ...props.thread.replies];

  async function submitReply() {
    const text = replyText().trim();
    if (!text) return;
    try {
      if (!identity.getName()) {
        const name = nameInput().trim();
        if (!name) return;
        identity.setName(name);
      }
      await props.controller.reply(props.thread.comment.id, text);
      props.onError(null);
      setReplyText('');
    } catch (e) {
      props.onError(`Failed to reply: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function toggleResolved() {
    try {
      await props.controller.setResolved(props.thread.comment.id, !resolved());
      props.onError(null);
    } catch (e) {
      props.onError(`Failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div
      class="comment-card"
      classList={{ 'comment-card-active': props.active, 'comment-card-resolved': resolved() }}
      style={{ top: `${props.top}px` }}
      ref={(el) => props.registerEl(props.thread.comment.id, el)}
      onClick={() => props.controller.setActive(props.thread.comment.id, { scrollEditor: true })}
    >
      <Show when={props.controller.canComment}>
        <button
          class="comment-resolve-btn"
          title={resolved() ? 'Re-open' : 'Resolve'}
          onClick={(e) => {
            e.stopPropagation();
            toggleResolved();
          }}
        >
          {resolved() ? '↺' : '✓'}
        </button>
      </Show>
      <For each={entries()}>
        {(rec, i) => (
          <Entry
            controller={props.controller}
            rec={rec}
            isReply={i() > 0}
            hasNext={i() < entries().length - 1}
            onError={props.onError}
          />
        )}
      </For>
      <Show when={props.controller.canComment && !resolved()}>
        <Show when={!identity.getName() && replyText()}>
          <NameField value={nameInput()} onInput={setNameInput} />
        </Show>
        <input
          class="comment-reply-input"
          type="text"
          placeholder="Leave a reply…"
          value={replyText()}
          onClick={(e) => e.stopPropagation()}
          onInput={(e) => setReplyText(e.currentTarget.value)}
          on:keydown={(e) => {
            if (e.key === 'Enter') submitReply();
            e.stopPropagation();
          }}
        />
      </Show>
    </div>
  );
};

export const CommentsPanel: Component<{ controller: CommentsController; toolbarHost: HTMLElement }> = (props) => {
  const [state, setState] = createSignal<CommentsState>(props.controller.getState());
  const [showResolved, setShowResolved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [draftText, setDraftText] = createSignal('');
  const [nameInput, setNameInput] = createSignal('');
  const [tops, setTops] = createSignal<Map<string, number>>(new Map());
  const cardEls = new Map<string, HTMLElement>();
  let draftTextarea: HTMLTextAreaElement | undefined;
  let relayoutQueued = false;

  const visibleThreads = () =>
    showResolved() ? [...state().threads, ...state().resolvedThreads].sort((a, b) => a.from - b.from) : state().threads;

  function relayout() {
    const s = state();
    const items: { id: string; pos: number }[] = visibleThreads().map((t) => ({ id: t.comment.id, pos: t.from }));
    if (s.draft) items.push({ id: DRAFT_ID, pos: s.draft.from });

    const entries: LayoutEntry[] = [];
    for (const item of items) {
      const el = cardEls.get(item.id);
      if (!el || !el.isConnected) continue;
      entries.push({ id: item.id, desired: props.controller.anchorTopFor(item.pos), height: el.offsetHeight });
    }
    entries.sort((a, b) => a.desired - b.desired);

    const pinned = s.draft ? DRAFT_ID : s.activeId;
    const next = stackCards(entries, pinned);
    const prev = tops();
    let changed = next.size !== prev.size;
    if (!changed) {
      for (const [id, top] of next) {
        if (prev.get(id) !== top) {
          changed = true;
          break;
        }
      }
    }
    if (changed) setTops(next);
  }

  function scheduleRelayout() {
    if (relayoutQueued) return;
    relayoutQueued = true;
    requestAnimationFrame(() => {
      relayoutQueued = false;
      relayout();
    });
  }

  const resizeObserver = new ResizeObserver(scheduleRelayout);

  function registerEl(id: string, el: HTMLElement) {
    cardEls.set(id, el);
    resizeObserver.observe(el);
  }

  onMount(() => {
    const unsubscribe = props.controller.subscribe(setState);
    const unsubscribeLayout = props.controller.onLayoutChange(scheduleRelayout);
    onCleanup(() => {
      unsubscribe();
      unsubscribeLayout();
      resizeObserver.disconnect();
    });
  });

  // Any state or visibility change can move cards (added/removed/resolved threads, pin changes).
  createEffect(() => {
    state();
    showResolved();
    scheduleRelayout();
  });

  createEffect(() => {
    if (state().draft) {
      setDraftText('');
      queueMicrotask(() => draftTextarea?.focus({ preventScroll: true }));
    }
  });

  const identity = props.controller.identity;

  // First render of a card lands at its anchor before the stacking pass runs.
  const topFor = (id: string, pos: number) => tops().get(id) ?? props.controller.anchorTopFor(pos);

  async function submitDraft() {
    const text = draftText().trim();
    if (!text) return;
    try {
      if (!identity.getName()) {
        const name = nameInput().trim();
        if (!name) return;
        identity.setName(name);
      }
      await props.controller.submitDraft(text);
      setError(null);
      setDraftText('');
    } catch (e) {
      setError(`Failed to comment: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <>
      <Portal mount={props.toolbarHost}>
        <Show when={state().resolvedThreads.length > 0}>
          <button class="comments-resolved-toggle" onClick={() => setShowResolved(!showResolved())}>
            {showResolved() ? 'Hide resolved' : `Resolved (${state().resolvedThreads.length})`}
          </button>
        </Show>
        <Show when={error()}>
          <div class="comments-panel-error">{error()}</div>
        </Show>
      </Portal>

      <Show when={state().draft}>
        {(draft) => (
          <div
            class="comment-card comment-card-composer"
            style={{ top: `${topFor(DRAFT_ID, draft().from)}px` }}
            ref={(el) => registerEl(DRAFT_ID, el)}
          >
            <Show when={!identity.getName()}>
              <NameField value={nameInput()} onInput={setNameInput} />
            </Show>
            <textarea
              ref={draftTextarea}
              class="comment-textarea"
              rows={3}
              placeholder="Add a comment…"
              value={draftText()}
              onInput={(e) => setDraftText(e.currentTarget.value)}
              on:keydown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitDraft();
                if (e.key === 'Escape') props.controller.cancelDraft();
                e.stopPropagation();
              }}
            />
            <div class="comment-actions">
              <button class="comment-action-btn comment-action-primary" onClick={submitDraft}>
                Comment
              </button>
              <button class="comment-action-btn" onClick={() => props.controller.cancelDraft()}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Show>

      <For each={visibleThreads()}>
        {(thread) => (
          <ThreadCard
            controller={props.controller}
            thread={thread}
            active={state().activeId === thread.comment.id}
            top={topFor(thread.comment.id, thread.from)}
            onError={setError}
            registerEl={registerEl}
          />
        )}
      </For>
    </>
  );
};
