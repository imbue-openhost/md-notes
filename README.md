# md-notes

Personal markdown notes app with vim mode and cross-device sync.

## Current State

### What works
- **CodeMirror 6 editor** with markdown language support
- **Markdown styling** via `markdownStylePlugin` — headings render at proper sizes, bold/italic/code/links get CSS styling. Formatting marks (`**`, `*`, `#`, etc.) remain visible but styled.
- **Vim mode** via `@replit/codemirror-vim` with status bar showing current mode
- **Vimrc parser** — supports `map`/`noremap` (with mode prefixes `nmap`, `imap`, `vmap`, etc.) and `set` commands (`number`, `relativenumber`, `tabstop`, `shiftwidth`, `expandtab`, `wrap`, `scrolloff`)
- **Header-based folding** — click the fold gutter to collapse sections
- **File tree sidebar** with create (+ button), rename/delete (right-click context menu)
- **Quart/Hypercorn server** with REST API for file CRUD and static frontend serving
- **Yjs real-time sync** — edits sync between browser tabs/devices via WebSocket
- **Share links** — generate read-only or read-write links, stored in SQLite
- **API key auth** — all routes except `/share/` require authentication
- **OpenHost deployment** at `md-notes.host.zackpolizzi.com`
- **Tauri scaffolding** — Rust project compiles, ready to build native Mac app
- **y-indexeddb** — offline persistence for Yjs document state

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

## Running

### Web app (server + frontend)
```bash
source .venv/bin/activate
cd frontend && npm run build && cd ..
MDNOTES_VAULT_PATH=~/notes python -m server
# → http://localhost:8080
```

### Development (hot reload)
```bash
# Terminal 1: server
source .venv/bin/activate && MDNOTES_VAULT_PATH=~/notes python -m server

# Terminal 2: frontend
cd frontend && npm run dev
# → http://localhost:5173 (proxies API to :8080)
```

### Tauri native app
```bash
cd tauri/src-tauri
cargo tauri dev    # dev mode
cargo tauri build  # release
```

### Configuration
- `MDNOTES_VAULT_PATH` — notes directory (default: `~/notes`)
- `MDNOTES_PORT` — server port (default: `8080`)
- `MDNOTES_API_KEY` — API key for auth (auto-generated on OpenHost)

## Project Structure

```
md-notes/
  frontend/           # Vanilla TypeScript + Vite
    src/
      editor/          # CM6 editor, vim, folding, sync
        live-preview/  # Inlined codemirror-live-markdown (partially disabled)
      ui/              # Sidebar
      api/             # REST client
    e2e/               # Playwright tests
  server/              # Python Quart app
    routes/            # files, sync, share endpoints
  tauri/               # Tauri v2 Mac app scaffolding
  specs/               # Architecture spec
```
