/** A comment as stored in the doc's 'comments' Y.Map (written server-side via REST). */
export interface CommentRecord {
  id: string;
  /** Present on replies; absent on top-level comments. */
  parentId?: string;
  userId: string;
  userName: string;
  text: string;
  /** base64 Yjs relative positions into the 'content' text; top-level comments only. */
  anchorStart?: string;
  anchorEnd?: string;
  createdAt: string;
  editedAt?: string;
  resolved?: boolean;
}

/** A top-level comment with its replies, resolved to current editor offsets. */
export interface CommentThread {
  comment: CommentRecord;
  replies: CommentRecord[];
  from: number;
  to: number;
}

export interface CommentsState {
  /** Unresolved threads, sorted by position. Orphaned threads (span deleted) are excluded. */
  threads: CommentThread[];
  /** Resolved threads, sorted by position. */
  resolvedThreads: CommentThread[];
  activeId: string | null;
  /** Span being commented on while the composer is open, or null. */
  draft: { from: number; to: number } | null;
}

/** REST adapter for comment mutations; the server writes into the Y.Doc and the change syncs back. */
export interface CommentsApi {
  create(body: {
    userId: string;
    userName: string;
    text: string;
    anchorStart?: string;
    anchorEnd?: string;
    parentId?: string;
  }): Promise<string>;
  update(commentId: string, body: { userId: string; text?: string; resolved?: boolean }): Promise<void>;
  remove(commentId: string, userId: string): Promise<void>;
}

export interface CommentIdentity {
  userId: string;
  /** null means the user hasn't picked a display name yet (share visitors before their first comment). */
  getName(): string | null;
  setName(name: string): void;
  isOwner: boolean;
}
