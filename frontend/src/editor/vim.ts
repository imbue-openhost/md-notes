/**
 * Vim mode for CodeMirror 6 via @replit/codemirror-vim.
 *
 * Phase 1: just enables vim mode.
 * Phase 2 will add vimrc parsing.
 */

import { vim } from '@replit/codemirror-vim';
import type { Extension } from '@codemirror/state';

export function vimMode(): Extension {
  return vim();
}
