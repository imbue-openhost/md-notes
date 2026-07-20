/**
 * Theme overlay for the mobile editor. Layered on top of the default
 * editorTheme: reclaims the fold-gutter column (chevrons render in a left
 * content margin instead), clears the floating top controls, and leaves
 * breathing room at the bottom so the last lines can scroll above the
 * keyboard toolbar.
 *
 * Selectors are anchored on an extra .cm-mobile editor class: the base
 * editorTheme styles the same elements at equal specificity, and CM gives
 * no ordering guarantee between theme extensions — the extra class makes
 * these rules strictly more specific.
 */

import { EditorView } from '@codemirror/view';

export const mobileTheme = [
  EditorView.editorAttributes.of({ class: 'cm-mobile' }),
  EditorView.theme({
    '&.cm-mobile .cm-content': {
      padding: 'calc(56px + env(safe-area-inset-top)) 0 35vh 0',
    },

    '&.cm-mobile .cm-line': {
      padding: '0 12px 0 26px',
    },

    // Narrower chevron column than desktop. Always visible (no hover on
    // touch) — the plugin only adds the widget when it should show.
    '&.cm-mobile .cm-fold-chevron': {
      width: '26px',
      opacity: '1',
    },
  }),
];
