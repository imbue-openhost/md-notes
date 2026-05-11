/**
 * Backend connection state. Tracks whether the app can reach the backend and
 * whether the current session is authorized. apiFetch updates this on every
 * request; a heartbeat keeps it fresh when the user is idle.
 */

import { createSignal } from 'solid-js';

export type ConnectionState = 'connected' | 'disconnected' | 'unauthorized';

const [state, setState] = createSignal<ConnectionState>('connected');
export const connectionState = state;

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export function markConnected(): void { setState('connected'); }
export function markDisconnected(): void { setState('disconnected'); }
export function markUnauthorized(): void { setState('unauthorized'); }

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Start a periodic auth-checked ping to keep connection state fresh while idle. */
export function startHeartbeat(probe: () => Promise<void>, intervalMs = 15000): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    probe().catch(() => {});
  }, intervalMs);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
