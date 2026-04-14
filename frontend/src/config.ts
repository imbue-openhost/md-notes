/**
 * Runtime environment detection and configuration.
 */

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    __SHARE_CONFIG__?: {
      uuid: string;
      docPath: string;
      permission: 'read' | 'write';
    };
  }
}

/** True when running inside a Tauri native app. */
export const isTauri = typeof window !== 'undefined' &&
  !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

/** True when running on the Vite dev server. */
export const isDevServer =
  typeof location !== 'undefined' &&
  (location.port === '5173' || location.port === '5174');

/** The server URL for API and WebSocket connections. */
export const serverUrl = isDevServer
  ? 'http://localhost:8080'
  : typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:8080';

/** Share config injected by the server on /share/<uuid> pages. */
export function getShareConfig() {
  return typeof window !== 'undefined' ? window.__SHARE_CONFIG__ : undefined;
}

/**
 * API key for authenticating with the server.
 * In the Tauri app this would come from the config file.
 * In the browser, same-origin requests go through the OpenHost
 * router which handles auth, so no key is needed.
 */
export function getApiKey(): string {
  return '';  // Browser doesn't need a key — OpenHost router handles auth
}
