/**
 * Client-side app shell preference persisted to localStorage.
 *
 * Device-specific by design: the same account typically wants the desktop
 * shell on a laptop and the mobile shell on a phone.
 */

/** What the user picked in settings. 'auto' resolves per device. */
export type ShellPreference = 'auto' | 'desktop' | 'mobile';

/** What actually renders. */
export type ShellKind = 'desktop' | 'mobile';

const SHELL_PREFERENCE_KEY = 'mdnotes-shell';

export function getShellPreference(): ShellPreference {
  try {
    const v = localStorage.getItem(SHELL_PREFERENCE_KEY);
    return v === 'desktop' || v === 'mobile' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setShellPreference(pref: ShellPreference): void {
  try {
    if (pref === 'auto') localStorage.removeItem(SHELL_PREFERENCE_KEY);
    else localStorage.setItem(SHELL_PREFERENCE_KEY, pref);
  } catch {
    // localStorage disabled / quota — not fatal.
  }
}

/**
 * Phones get the mobile shell; everything else (including tablets, for now)
 * gets the desktop one. Coarse primary pointer filters out desktops with
 * touchscreens; the screen-size check filters out tablets.
 */
export function detectShellKind(): ShellKind {
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const smallScreen = Math.min(window.screen.width, window.screen.height) < 700;
    return coarse && smallScreen ? 'mobile' : 'desktop';
  } catch {
    return 'desktop';
  }
}

export function resolveShellKind(pref: ShellPreference = getShellPreference()): ShellKind {
  return pref === 'auto' ? detectShellKind() : pref;
}

// Exported for tests.
export const _internal = { SHELL_PREFERENCE_KEY };
