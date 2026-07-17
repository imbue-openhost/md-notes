/**
 * Link Widget
 *
 * Renders Markdown link preview, supports standard links and Wiki links
 */

import { WidgetType } from '@codemirror/view';

/**
 * Link data interface
 */
export interface LinkData {
  /** Link text */
  text: string;
  /** Link URL */
  url: string;
  /** Title */
  title?: string;
  /** Whether it's a Wiki link */
  isWikiLink: boolean;
}

/**
 * Link options interface
 */
export interface LinkOptions {
  /** Whether to open in new tab, default true */
  openInNewTab?: boolean;
  /** Wiki link click handler */
  onWikiLinkClick?: (link: string) => void;
  /** Whether to show link preview, default false */
  showPreview?: boolean;
}

/**
 * Dangerous protocols list
 */
const DANGEROUS_PROTOCOLS = ['javascript:', 'vbscript:', 'data:text/html'];

/**
 * Check if URL is safe
 */
function isSafeUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase().trim();
  return !DANGEROUS_PROTOCOLS.some((protocol) => lowerUrl.startsWith(protocol));
}

/**
 * Sanitize URL
 */
function sanitizeUrl(url: string): string {
  if (!isSafeUrl(url)) {
    return '';
  }
  // Encode special characters
  try {
    return encodeURI(url);
  } catch {
    return '';
  }
}

/**
 * Link Widget class
 */
export class LinkWidget extends WidgetType {
  constructor(
    readonly data: LinkData,
    readonly options: LinkOptions
  ) {
    super();
  }

  /**
   * Check if two widgets are equal
   */
  eq(other: LinkWidget): boolean {
    return (
      other.data.text === this.data.text &&
      other.data.url === this.data.url &&
      other.data.title === this.data.title &&
      other.data.isWikiLink === this.data.isWikiLink
    );
  }

  /**
   * Render to DOM element
   */
  toDOM(): HTMLElement {
    const { text, url, title, isWikiLink } = this.data;
    const {
      openInNewTab = true,
      onWikiLinkClick,
      showPreview = false,
    } = this.options;

    const anchor = document.createElement('a');
    anchor.textContent = text;
    anchor.title = title || '';
    anchor.tabIndex = -1; // Prevent focus stealing from editor/vim

    if (isWikiLink) {
      // Wiki link style
      anchor.className = 'cm-link-widget cm-wikilink-widget';
      anchor.href = '';

      anchor.addEventListener('click', (e) => {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) {
          e.stopPropagation();
          onWikiLinkClick?.(url);
        }
      });
    } else {
      // Standard link
      anchor.className = 'cm-link-widget';

      const safeUrl = sanitizeUrl(url);
      if (safeUrl) {
        anchor.href = safeUrl;
      }

      if (openInNewTab) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }

      // Cmd/Ctrl-click opens; plain click falls through to the editor to
      // place the cursor (which reveals the source for editing).
      anchor.addEventListener('click', (e) => {
        if (!(e.metaKey || e.ctrlKey)) {
          e.preventDefault();
        }
      });
    }

    // Link preview
    if (showPreview && !isWikiLink) {
      let previewEl: HTMLElement | null = null;

      anchor.addEventListener('mouseenter', () => {
        previewEl = document.createElement('span');
        previewEl.className = 'cm-link-preview';
        previewEl.textContent = url;
        anchor.appendChild(previewEl);
      });

      anchor.addEventListener('mouseleave', () => {
        if (previewEl) {
          previewEl.remove();
          previewEl = null;
        }
      });
    }

    return anchor;
  }

  /**
   * Cmd/Ctrl-click is handled by the widget (opens the link) — the editor
   * must ignore it, otherwise the cursor moves into the source and swaps
   * the widget out mid-click, swallowing the navigation. Plain clicks go
   * to the editor to place the cursor for editing.
   */
  ignoreEvent(event: Event): boolean {
    return event instanceof MouseEvent && (event.metaKey || event.ctrlKey);
  }
}

/**
 * Create link widget
 */
export function createLinkWidget(
  data: LinkData,
  options: LinkOptions
): LinkWidget {
  return new LinkWidget(data, options);
}
