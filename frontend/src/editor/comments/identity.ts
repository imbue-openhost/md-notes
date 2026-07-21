/**
 * Commenter identity. There is no real auth for share visitors yet: each browser gets a random stable UUID,
 * and the display name is prompted on first comment. The owner's name comes from the server (OpenHost env).
 */

import type { CommentIdentity } from './types';

const USER_ID_KEY = 'mdnotes-comment-user-id';
const USER_NAME_KEY = 'mdnotes-comment-user-name';

export function getOrCreateUserId(): string {
  try {
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  } catch {
    // No localStorage (rare); a per-session id still lets commenting work.
    return crypto.randomUUID();
  }
}

export function shareIdentity(): CommentIdentity {
  return {
    userId: getOrCreateUserId(),
    isOwner: false,
    getName: () => {
      try {
        return localStorage.getItem(USER_NAME_KEY);
      } catch {
        return null;
      }
    },
    setName: (name: string) => {
      try {
        localStorage.setItem(USER_NAME_KEY, name);
      } catch {}
    },
  };
}

export function ownerIdentity(displayName: string): CommentIdentity {
  return {
    userId: getOrCreateUserId(),
    isOwner: true,
    getName: () => displayName,
    setName: () => {},
  };
}
