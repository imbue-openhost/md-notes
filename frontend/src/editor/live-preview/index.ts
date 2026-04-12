/**
 * Live Preview — inlined from codemirror-live-markdown
 *
 * Obsidian-style Live Preview mode for CodeMirror 6
 */

// Core
export { collapseOnSelectionFacet } from './core/facets';
export { mouseSelectingField, setMouseSelecting } from './core/mouseSelecting';
export { shouldShowSource } from './core/shouldShowSource';
export { checkUpdateAction } from './core/pluginUpdateHelper';
export type { UpdateAction } from './core/pluginUpdateHelper';

// Plugins
export { livePreviewPlugin } from './plugins/livePreview';
export { markdownStylePlugin } from './plugins/markdownStyle';
export { codeBlockField } from './plugins/codeBlock';
export type { CodeBlockOptions } from './plugins/codeBlock';
export { imageField } from './plugins/image';
export type { ImageOptions } from './plugins/image';
export { linkPlugin } from './plugins/link';
export type { LinkOptions } from './plugins/link';

// Theme
export { editorTheme } from './theme/default';

// Utils
export { highlightCode, initHighlighter, isHighlighterAvailable } from './utils/codeHighlight';
export { loadImage, clearImageCache } from './utils/imageLoader';
