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

    // Full-height flex box so the glyph centers on the (possibly heading-
    // sized) line; fixed font size so it doesn't scale with the heading.
    '&.cm-mobile .cm-mobile-fold-chevron': {
      position: 'absolute',
      left: '0',
      top: '0',
      height: '100%',
      width: '26px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'hsl(var(--muted-foreground, 220 9% 46%))',
      cursor: 'pointer',
      userSelect: 'none',
      '-webkit-user-select': 'none',
      fontSize: '17px',
    },
  }),
];
