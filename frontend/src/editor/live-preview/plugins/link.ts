/**
 * Link Plugin
 *
 * Implements live preview for Markdown links
 * Hides URL part when cursor is outside link, shows only link text
 * Supports standard links and Wiki links
 */

import { syntaxTree } from '@codemirror/language';
import { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { shouldShowSource } from '../core/shouldShowSource';
import { mouseSelectingField } from '../core/mouseSelecting';
import { checkUpdateAction } from '../core/pluginUpdateHelper';
import { createLinkWidget, LinkData, LinkOptions } from '../widgets/linkWidget';

export type { LinkOptions } from '../widgets/linkWidget';

/**
 * Parse standard link syntax
 *
 * @param text - Link syntax text
 * @returns Parsed link data, or null
 */
export function parseLinkSyntax(text: string): LinkData | null {
  // Exclude image syntax
  if (text.startsWith('!')) {
    return null;
  }

  // Match [text](url) or [text](url "title") or [text](url 'title')
  const match = text.match(/^\[([^\]]*)\]\((.+?)(?:\s+["']([^"']+)["'])?\)$/);

  if (!match) {
    return null;
  }

  const [, linkText, url, title] = match;

  return {
    text: linkText,
    url,
    title,
    isWikiLink: false,
  };
}

/**
 * Parse Wiki link syntax
 *
 * @param text - Wiki link syntax text
 * @returns Parsed link data, or null
 */
export function parseWikiLink(text: string): LinkData | null {
  // Match [[target]] or [[target|display]]
  const match = text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);

  if (!match) {
    return null;
  }

  const [, target, display] = match;

  return {
    text: display || target,
    url: target,
    isWikiLink: true,
  };
}

/**
 * Wiki link regex
 */
const WIKI_LINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Default options
 */
const defaultOptions: Required<LinkOptions> = {
  openInNewTab: true,
  onWikiLinkClick: undefined as unknown as (link: string) => void,
  showPreview: false,
};

/**
 * Parent node types to skip (handled by other plugins)
 */
const SKIP_PARENT_TYPES = new Set(['FencedCode', 'CodeBlock', 'InlineCode']);

/**
 * Build link decorations for the given ranges (the visible viewport)
 */
export function buildLinkDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  options: Required<LinkOptions>
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const isDrag = state.field(mouseSelectingField, false);
  const tree = syntaxTree(state);

  for (const { from, to } of ranges) {
    // Collect ranges to skip (code blocks, inline code, etc.)
    const skipRanges: Array<{ from: number; to: number }> = [];
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (SKIP_PARENT_TYPES.has(node.name)) {
          skipRanges.push({ from: node.from, to: node.to });
        }
      },
    });

    const isInSkipRange = (rFrom: number, rTo: number) => {
      return skipRanges.some((r) => rFrom >= r.from && rTo <= r.to);
    };

    // Process standard links
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'Link') return;
        if (isInSkipRange(node.from, node.to)) return;

        const text = state.doc.sliceString(node.from, node.to);
        const linkData = parseLinkSyntax(text);
        if (!linkData) return;

        if (!shouldShowSource(state, node.from, node.to) && !isDrag) {
          const widget = createLinkWidget(linkData, options);
          decorations.push(
            Decoration.replace({ widget }).range(node.from, node.to)
          );
        } else {
          decorations.push(
            Decoration.mark({ class: 'cm-link-source' }).range(
              node.from,
              node.to
            )
          );
        }
      },
    });

    // Process Wiki links (Lezer doesn't support by default, need manual matching)
    const rangeText = state.doc.sliceString(from, to);
    let match: RegExpExecArray | null;
    WIKI_LINK_REGEX.lastIndex = 0;

    while ((match = WIKI_LINK_REGEX.exec(rangeText)) !== null) {
      const wFrom = from + match.index;
      const wTo = wFrom + match[0].length;

      if (isInSkipRange(wFrom, wTo)) continue;

      const wikiData = parseWikiLink(match[0]);
      if (!wikiData) continue;

      if (!shouldShowSource(state, wFrom, wTo) && !isDrag) {
        const widget = createLinkWidget(wikiData, options);
        decorations.push(Decoration.replace({ widget }).range(wFrom, wTo));
      } else {
        decorations.push(
          Decoration.mark({ class: 'cm-link-source cm-wikilink-source' }).range(
            wFrom,
            wTo
          )
        );
      }
    }
  }

  return Decoration.set(
    decorations.sort((a, b) => a.from - b.from || a.to - b.to),
    true
  );
}

/**
 * Link plugin
 *
 * @param options - Configuration options
 * @returns ViewPlugin
 *
 * @example
 * ```typescript
 * import { linkPlugin } from 'codemirror-live-markdown';
 *
 * // Use default config
 * extensions: [linkPlugin()]
 *
 * // Custom config
 * extensions: [linkPlugin({
 *   openInNewTab: true,
 *   onWikiLinkClick: (link) => {
 *     router.push(`/wiki/${link}`);
 *   },
 * })]
 * ```
 */
export function linkPlugin(
  options?: LinkOptions
): ViewPlugin<{
  decorations: DecorationSet;
  update(update: ViewUpdate): void;
}> {
  const mergedOptions = { ...defaultOptions, ...options };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildLinkDecorations(
          view.state,
          view.visibleRanges,
          mergedOptions
        );
      }

      update(update: ViewUpdate) {
        if (checkUpdateAction(update) === 'rebuild') {
          this.decorations = buildLinkDecorations(
            update.view.state,
            update.view.visibleRanges,
            mergedOptions
          );
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
