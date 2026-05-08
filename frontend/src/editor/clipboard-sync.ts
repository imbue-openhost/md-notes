/**
 * Sync the vim unnamed register to the system clipboard.
 *
 * codemirror-vim's `vimGlobalState.registerController` is a module
 * singleton, so registers are technically already shared across CM6
 * instances. But we additionally route the unnamed register through
 * `navigator.clipboard` so that:
 *
 *   - yank/delete in one tab is immediately pasteable in another
 *     (covers any cases where in-memory register state gets desynced)
 *   - vim yanks become available to/from the OS clipboard
 *
 * Strategy:
 *
 *   - Wrap `registerController.pushText` so that any write going to the
 *     unnamed register (no explicit registerName) also calls
 *     `navigator.clipboard.writeText(text)`.
 *
 *   - Read `navigator.clipboard.readText()` on `focusin` for any vim
 *     editor and sync the result into the unnamed register, so a
 *     subsequent `p` reads the latest external clipboard value.
 *
 * Idempotent — calling install multiple times is a no-op.
 */
import { Vim } from '@replit/codemirror-vim';

const INSTALLED = Symbol.for('md-notes.vimClipboardSyncInstalled');
const ORIGINAL_PUSHTEXT = Symbol.for('md-notes.vimClipboardSyncOriginalPushText');

interface RegisterLike {
  setText(text?: string, linewise?: boolean, blockwise?: boolean): void;
  toString(): string;
  linewise: boolean;
  blockwise: boolean;
}

interface RegisterControllerLike {
  unnamedRegister: RegisterLike;
  pushText(
    registerName: string | null | undefined,
    operator: string,
    text: string,
    linewise?: boolean,
    blockwise?: boolean,
  ): void;
}

/**
 * The clipboard reads we initiate. A pending read updates the unnamed
 * register when it resolves, but only if no later write has happened in
 * the meantime (tracked by `clipboardWriteCounter`).
 */
let clipboardWriteCounter = 0;

async function safeReadClipboard(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return null;
  try {
    return await navigator.clipboard.readText();
  } catch {
    // Permission denied, document not focused, etc. Silently skip — the
    // in-memory unnamed register still works for same-page paste.
    return null;
  }
}

function safeWriteClipboard(text: string): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
  navigator.clipboard.writeText(text).catch(() => {
    // Permission errors are silent; we still wrote to the in-memory register.
  });
}

export function installVimClipboardSync(): void {
  // SSR / tests: bail if no Vim or no DOM.
  if (typeof Vim === 'undefined') return;
  const globalAny = globalThis as Record<symbol, unknown>;
  if (globalAny[INSTALLED]) return;
  globalAny[INSTALLED] = true;

  const controller = Vim.getRegisterController() as unknown as RegisterControllerLike;
  const controllerAny = controller as unknown as Record<symbol, unknown>;
  // Capture the un-wrapped pushText the first time we install, so tests
  // (which can flip the install flag) don't end up stacking wrappers.
  const originalPushText =
    (controllerAny[ORIGINAL_PUSHTEXT] as RegisterControllerLike['pushText'] | undefined) ??
    controller.pushText.bind(controller);
  controllerAny[ORIGINAL_PUSHTEXT] = originalPushText;

  controller.pushText = function (
    registerName: string | null | undefined,
    operator: string,
    text: string,
    linewise?: boolean,
    blockwise?: boolean,
  ): void {
    originalPushText.call(controller, registerName, operator, text, linewise, blockwise);
    // Sync to OS clipboard only when the write went to the unnamed
    // register: i.e. yank/delete/change without an explicit named
    // register. Named registers (`"a`, `"A`, etc.) and the black-hole
    // register stay vim-local.
    if (operator !== 'yank' && operator !== 'delete' && operator !== 'change') return;
    if (registerName && registerName !== '"') return;
    clipboardWriteCounter += 1;
    safeWriteClipboard(text);
  };

  if (typeof document !== 'undefined') {
    // On focus to any vim editor, refresh the unnamed register from the
    // system clipboard. This covers: yank in another tab/app, then come
    // back here and paste.
    const onFocus = (e: FocusEvent) => {
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== 'function') return;
      if (!target.closest('.cm-editor')) return;
      const seen = clipboardWriteCounter;
      void safeReadClipboard().then((value) => {
        if (value == null) return;
        // Don't clobber a yank/delete that happened *after* this read started.
        if (seen !== clipboardWriteCounter) return;
        const reg = controller.unnamedRegister;
        if (reg.toString() === value) return;
        reg.setText(value, false, false);
      });
    };
    document.addEventListener('focusin', onFocus);
  }
}
