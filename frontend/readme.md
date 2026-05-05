
### Live preview — current limitations

The editor uses `markdownStylePlugin` from `codemirror-live-markdown` for CSS-based markdown styling. The more advanced "live preview" plugins are **disabled**:

- `livePreviewPlugin` — hides/shows inline formatting marks (`**`, `*`, `` ` ``, `#`) based on cursor proximity
- `codeBlockField` — replaces fenced code blocks with syntax-highlighted widgets
- `imageField` — replaces `![alt](url)` with rendered images
- `linkPlugin` — replaces `[text](url)` with clickable link widgets

**Why they're disabled:** These plugins use `Decoration.mark()` and `Decoration.replace()` to modify the DOM on every cursor movement. This triggers CodeMirror 6's `InlineCoordsScan` to recurse infinitely (stack overflow), which crashes the vim plugin's key handler and causes normal-mode keys like `j`/`k` to fall through as text insertion. The root cause is a CM6-level incompatibility between its coordinate scanner and decorations that change element visibility/size on selection change. This affects both the mark-based hide/show (livePreviewPlugin) and the widget replacement approach (codeBlock, image, link).

**What still works:** `markdownStylePlugin` applies static CSS classes to markdown elements (headings get large font sizes, bold gets `font-weight: 700`, etc.) without changing the DOM structure on cursor movement, so it's compatible with vim.

**Path forward:** Either fix the `InlineCoordsScan` recursion in CM6 upstream, or rewrite the live preview to use a deferred/async decoration update strategy that doesn't trigger coordinate recalculation during the same update cycle.

### Reference projects
- https://github.com/blueberrycongee/codemirror-live-markdown (source of inlined live-preview code)
- https://github.com/segphault/codemirror-rich-markdoc
