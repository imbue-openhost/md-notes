import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Vim } from '@replit/codemirror-vim';
import { installVimClipboardSync } from './clipboard-sync';

const INSTALLED = Symbol.for('md-notes.vimClipboardSyncInstalled');

describe('vim clipboard sync', () => {
  let writeText: ReturnType<typeof vi.fn>;
  let readText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset install state so each test gets a clean install.
    (globalThis as Record<symbol, unknown>)[INSTALLED] = undefined;
    // Reset register controller state so writes from previous tests don't leak.
    Vim.getRegisterController().unnamedRegister.setText('', false, false);

    writeText = vi.fn().mockResolvedValue(undefined);
    readText = vi.fn().mockResolvedValue('');
    // jsdom isn't installed; stub navigator.clipboard.
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText, readText } },
    });
  });

  it('writes yanked text to the system clipboard', () => {
    installVimClipboardSync();
    const rc = Vim.getRegisterController();
    rc.pushText(undefined, 'yank', 'hello world', false, false);
    expect(writeText).toHaveBeenCalledWith('hello world');
    // And the unnamed register still works (in-memory shared state).
    expect(rc.unnamedRegister.toString()).toBe('hello world');
  });

  it('writes deleted text to the system clipboard', () => {
    installVimClipboardSync();
    Vim.getRegisterController().pushText(undefined, 'delete', 'gone', false, false);
    expect(writeText).toHaveBeenCalledWith('gone');
  });

  it('does not write to clipboard for the black-hole register', () => {
    installVimClipboardSync();
    Vim.getRegisterController().pushText('_', 'delete', 'gone', false, false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does not write to clipboard for a named register', () => {
    installVimClipboardSync();
    Vim.getRegisterController().pushText('a', 'yank', 'into a', false, false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('is idempotent — installing twice only wraps pushText once', () => {
    installVimClipboardSync();
    installVimClipboardSync();
    Vim.getRegisterController().pushText(undefined, 'yank', 'once', false, false);
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
