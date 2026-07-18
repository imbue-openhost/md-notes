/**
 * Hover button on heading lines that copies a share link jumping straight to
 * that section (/share/<uuid>#<slug>). The share URL itself comes from the
 * caller via GetShareUrl so this extension stays independent of the API layer.
 */

import {
  ViewPlugin,
  EditorView,
  Decoration,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { type Extension, RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { slugifyHeader } from './header-anchor';

/** Resolves to a doc share URL (e.g. https://…/share/<uuid>) with the given permission. */
export type GetShareUrl = (permission: 'read' | 'write') => Promise<string>;

const LINK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
  '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
  '</svg>';

let closeActiveMenu: (() => void) | null = null;

function openHeaderLinkMenu(anchorEl: HTMLElement, slug: string, getShareUrl: GetShareUrl): void {
  closeActiveMenu?.();

  const menu = document.createElement('div');
  menu.className = 'sidebar-context-menu header-link-menu';
  const rect = anchorEl.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px`;

  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (closeActiveMenu === close) closeActiveMenu = null;
  };
  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  const addItem = (label: string, permission: 'read' | 'write') => {
    const item = document.createElement('div');
    item.className = 'sidebar-context-item';
    item.textContent = label;
    item.addEventListener('click', async () => {
      try {
        const base = await getShareUrl(permission);
        await navigator.clipboard.writeText(`${base}#${encodeURIComponent(slug)}`);
        item.textContent = 'Copied!';
      } catch (e) {
        console.error('Failed to copy header link:', e);
        item.textContent = 'Failed to copy';
      }
      setTimeout(close, 700);
    });
    menu.appendChild(item);
  };
  addItem('Copy read-only link to this section', 'read');
  addItem('Copy editable link to this section', 'write');

  document.body.appendChild(menu);
  // Position after appending so the measured height can keep it on-screen.
  const top = Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8);
  menu.style.top = `${Math.max(8, top)}px`;
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  closeActiveMenu = close;
}

class HeaderLinkWidget extends WidgetType {
  constructor(private slug: string, private getShareUrl: GetShareUrl) {
    super();
  }

  eq(other: HeaderLinkWidget) {
    return other.slug === this.slug;
  }

  toDOM(): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'header-link-btn';
    btn.title = 'Copy link to this section';
    btn.innerHTML = LINK_ICON;
    // Keep the click from moving the cursor or stealing focus from the editor.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openHeaderLinkMenu(btn, this.slug, this.getShareUrl);
    });
    return btn;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(view: EditorView, getShareUrl: GetShareUrl): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (!/^ATXHeading\d$/.test(node.name)) return;
        const line = view.state.doc.lineAt(node.from);
        const slug = slugifyHeader(view.state.doc.sliceString(line.from, line.to));
        if (slug) {
          builder.add(
            line.to,
            line.to,
            Decoration.widget({ widget: new HeaderLinkWidget(slug, getShareUrl), side: 1 }),
          );
        }
        return false;
      },
    });
  }
  return builder.finish();
}

class HeaderLinkButtonsPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView, private getShareUrl: GetShareUrl) {
    this.decorations = buildDecorations(view, getShareUrl);
  }

  update(u: ViewUpdate) {
    // Tree identity changes as background parsing advances, which is what
    // makes buttons appear on the initial (empty → synced) load.
    if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) {
      this.decorations = buildDecorations(u.view, this.getShareUrl);
    }
  }
}

export function headerLinkButtons(getShareUrl: GetShareUrl): Extension {
  return ViewPlugin.define((view) => new HeaderLinkButtonsPlugin(view, getShareUrl), {
    decorations: (p) => p.decorations,
  });
}
