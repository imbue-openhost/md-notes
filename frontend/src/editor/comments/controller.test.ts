import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { encodeAnchors } from './anchors';
import { CommentsController } from './controller';
import type { CommentIdentity, CommentRecord, CommentsApi } from './types';

function makeDoc(content: string): { ydoc: Y.Doc; ytext: Y.Text } {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  ytext.insert(0, content);
  return { ydoc, ytext };
}

const noopApi: CommentsApi = {
  create: vi.fn(async () => 'new-id'),
  update: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
};

function identity(name: string | null = 'Tester'): CommentIdentity {
  let current = name;
  return {
    userId: 'user-1',
    isOwner: false,
    getName: () => current,
    setName: (n) => {
      current = n;
    },
  };
}

function putComment(
  ydoc: Y.Doc,
  ytext: Y.Text,
  id: string,
  span: [number, number] | null,
  extra: Partial<CommentRecord> = {},
): void {
  const record: CommentRecord = {
    id,
    userId: 'author',
    userName: 'Author',
    text: `text-${id}`,
    createdAt: new Date(2026, 0, 1).toISOString(),
    ...(span ? { ...encodeAnchors(ytext, span[0], span[1]), resolved: false } : {}),
    ...extra,
  };
  ydoc.getMap('comments').set(id, record);
}

async function flush(): Promise<void> {
  // recompute is microtask-coalesced
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeController(ydoc: Y.Doc, ytext: Y.Text): CommentsController {
  return new CommentsController({ ydoc, ytext, api: noopApi, identity: identity(), canComment: true });
}

describe('CommentsController', () => {
  it('builds position-sorted threads with replies, hiding orphans', async () => {
    const { ydoc, ytext } = makeDoc('hello brave new world');
    putComment(ydoc, ytext, 'late', [16, 21]); // "world"
    putComment(ydoc, ytext, 'early', [0, 5]); // "hello"
    putComment(ydoc, ytext, 'gone', [6, 11]); // "brave", deleted below
    putComment(ydoc, ytext, 'r1', null, { parentId: 'early', createdAt: new Date(2026, 0, 3).toISOString() });
    putComment(ydoc, ytext, 'r2', null, { parentId: 'early', createdAt: new Date(2026, 0, 2).toISOString() });
    ytext.delete(6, 6); // orphan "gone"

    const controller = makeController(ydoc, ytext);
    await flush();
    const state = controller.getState();
    expect(state.threads.map((t) => t.comment.id)).toEqual(['early', 'late']);
    expect(state.threads[0].replies.map((r) => r.id)).toEqual(['r2', 'r1']); // by createdAt
    expect(state.threads[0]).toMatchObject({ from: 0, to: 5 });
    controller.destroy();
  });

  it('splits resolved threads out and clears a stale activeId', async () => {
    const { ydoc, ytext } = makeDoc('hello brave new world');
    putComment(ydoc, ytext, 'open', [0, 5]);
    putComment(ydoc, ytext, 'done', [6, 11], { resolved: true });

    const controller = makeController(ydoc, ytext);
    await flush();
    expect(controller.getState().threads.map((t) => t.comment.id)).toEqual(['open']);
    expect(controller.getState().resolvedThreads.map((t) => t.comment.id)).toEqual(['done']);

    controller.setActive('open');
    expect(controller.getState().activeId).toBe('open');
    ydoc.getMap('comments').delete('open');
    await flush();
    expect(controller.getState().activeId).toBeNull();
    controller.destroy();
  });

  it('re-resolves thread positions as the doc changes', async () => {
    const { ydoc, ytext } = makeDoc('hello brave new world');
    putComment(ydoc, ytext, 'c', [6, 15]);
    const controller = makeController(ydoc, ytext);
    await flush();
    expect(controller.getState().threads[0]).toMatchObject({ from: 6, to: 15 });

    ytext.insert(0, 'XYZ ');
    await flush();
    expect(controller.getState().threads[0]).toMatchObject({ from: 10, to: 19 });
    controller.destroy();
  });

  it('threadAt returns the innermost covering thread', async () => {
    const { ydoc, ytext } = makeDoc('hello brave new world');
    putComment(ydoc, ytext, 'outer', [0, 21]);
    putComment(ydoc, ytext, 'inner', [6, 11]);
    const controller = makeController(ydoc, ytext);
    await flush();
    expect(controller.threadAt(7)?.comment.id).toBe('inner');
    expect(controller.threadAt(1)?.comment.id).toBe('outer');
    expect(controller.threadAt(21)).toBeNull();
    controller.destroy();
  });

  it('notifies subscribers and stops after destroy', async () => {
    const { ydoc, ytext } = makeDoc('hello world');
    const controller = makeController(ydoc, ytext);
    const seen: number[] = [];
    controller.subscribe((s) => seen.push(s.threads.length));
    putComment(ydoc, ytext, 'c', [0, 5]);
    await flush();
    expect(seen.at(-1)).toBe(1);

    controller.destroy();
    ydoc.getMap('comments').delete('c');
    await flush();
    expect(seen.at(-1)).toBe(1); // no further updates
  });
});
