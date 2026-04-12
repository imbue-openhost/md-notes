# md-notes: Obsidian-like Markdown Notes App

## Overview

- Personal markdown notes app with an Obsidian-style live-preview editor, vim mode, and cross-device sync
- Two clients: a **Tauri Mac desktop app** (offline-capable) and a **web app**, both sharing the same vanilla TypeScript + CodeMirror 6 frontend
- **Quart/Hypercorn Python server** serves as the authoritative source of truth, storing notes as plain `.md` files in nested folders on disk
- **Yjs CRDT** handles real-time document sync over WebSocket (`y-codemirror.next` on the client, `pycrdt-websocket` on the server)
- Tauri app maintains a local replica of the vault for offline editing; Yjs updates persist locally via `y-indexeddb` and replay on reconnect
- Live-preview rendering code inlined from `codemirror-live-markdown` (not used as an npm dependency)
- Share links let others view or edit a document via Yjs, gated by UUID tokens stored in SQLite

## Expected Behavior

### Editor
- CodeMirror 6 editor with live-preview mode: markdown syntax is visible when the cursor is in a region, rendered output shown otherwise
- Live preview supports standard markdown: headings, bold/italic, links, images, lists, code blocks, blockquotes
- Header-based folding: clicking the fold gutter on a heading collapses content until the next heading of equal or higher level; nested headings fold independently
- Vim mode via `@replit/codemirror-vim`, enabled by default
- Vimrc parser reads a config file from the app's data directory, supporting:
  - `map` / `noremap` key bindings
  - `set number` / `nonumber`, `relativenumber` / `norelativenumber`
  - `set tabstop=N`, `shiftwidth=N`, `expandtab` / `noexpandtab`
  - `set wrap` / `nowrap`, `scrolloff=N`
- All links in live preview open in the default browser (no in-app navigation)

### File Management
- Notes organized in nested folders (Obsidian vault style)
- UI: collapsible file tree sidebar on the left, single editor pane on the right
- File tree supports create, rename, delete, and move operations
- File operations go through the Quart REST API; they require online connectivity (no offline file ops)

### Sync (Tauri App)
- Tauri app maintains a persistent WebSocket connection to the Quart server
- When a document is opened, a Y.Doc is initialized from the server's `.md` file; edits sync in real-time via Yjs
- When offline, edits are persisted locally via `y-indexeddb` and replayed when the connection is restored
- Local `.md` files are written as replicas so other local apps (vim, grep, etc.) can read them
- On first launch, the Tauri app does an incremental sync: lists files via the REST API and downloads each one
- File tree is a full mirror — creates, renames, and deletes on the server propagate to the local vault

### Web App
- Same full feature set as the Tauri app (file tree, editor, vim mode, sharing) minus the offline/local-file layer
- Served as static assets from Vite's `dist/` folder by Quart at `/`
- Communicates with the server over the same REST API and WebSocket endpoints

### Sharing
- User can generate a share link for any document, choosing read-only or read-write mode
- Share links are UUID-based, stored in a SQLite database mapping UUID to document path + permission level
- Recipients access `/share/<uuid>`, which serves the editor connected to the same Y.Doc via Yjs
- Read-only recipients see the rendered document (or editor in read-only mode); read-write recipients can edit freely, changes merge into the server's `.md` file
- Share links are revocable by deleting the row from the SQLite DB

### Server
- Python Quart app served by Hypercorn
- Vault path, host/port, SQLite DB path configured via server config
- REST API endpoints for file tree operations (list, create, rename, delete, move, read)
- WebSocket endpoint for Yjs document sync via `pycrdt-websocket`
- Y.Doc lifecycle: initialized from `.md` on first client connection, kept alive while clients are connected, written back to `.md` and discarded on last client disconnect
- Serves the Vite-built frontend at `/`
- Serves share pages at `/share/<uuid>`

## Implementation Plan

### Project Structure

```
md-notes/
  frontend/               # Vanilla TS + Vite
    src/
      main.ts              # Entry point, mounts sidebar + editor
      editor/
        editor.ts          # EditorView setup, extension composition
        live-preview/      # Inlined codemirror-live-markdown code
          index.ts         # Main extension entry point
          decorations.ts   # CM6 decorations for hiding/showing syntax
          cursor-tracker.ts # Track cursor position to toggle preview
        vim.ts             # Vim mode setup, vimrc parser
        folding.ts         # Header-based fold extension
        sync.ts            # Yjs binding: Y.Doc, y-codemirror.next, WebSocket provider, y-indexeddb
      ui/
        sidebar.ts         # File tree component (DOM-based)
        layout.ts          # Sidebar + editor layout container
      api/
        client.ts          # REST API client (file ops: list, create, rename, delete, move)
        types.ts           # Shared TypeScript types (FileEntry, ShareLink, etc.)
      config.ts            # App config (server URL, vault path, vimrc path)
    vite.config.ts
    package.json
    tsconfig.json
  server/
    app.py                 # Quart app factory, route registration
    config.py              # Server config (vault path, host, port, DB path)
    routes/
      files.py             # REST endpoints: list, create, read, rename, delete, move
      sync.py              # WebSocket endpoint for Yjs sync via pycrdt-websocket
      share.py             # Share link CRUD + share page serving
    db.py                  # SQLite setup (share links table)
    vault.py               # Filesystem helpers: read/write .md files, directory listing
    requirements.txt
  tauri/
    src-tauri/
      src/
        main.rs            # Tauri entry, registers commands
        commands.rs         # Tauri commands: read/write local files, get config paths
      tauri.conf.json       # Tauri config, points frontend to ../frontend/dist
      Cargo.toml
  specs/
  README.md
```

### Frontend — `frontend/`

**`src/editor/editor.ts`**
- Creates `EditorState` and `EditorView` with composed extensions
- Extensions: live-preview, vim mode, header folding, Yjs sync, markdown language support
- Exports `openDocument(path: string)` which tears down the current Y.Doc/provider and initializes a new one
- Exports `getEditorView()` for external access

**`src/editor/live-preview/`** (inlined from `codemirror-live-markdown`)
- `index.ts`: exports a single CM6 `Extension` that composes the decoration and cursor-tracking logic
- `decorations.ts`: `ViewPlugin` that uses `DecorationSet` to hide markdown syntax (e.g., `**`, `#`, `` ` ``) when the cursor is not in that region, and show rendered output (bold text, heading size, inline code styling) via CSS classes and `WidgetType` replacements for images/links
- `cursor-tracker.ts`: `StateField` tracking the current cursor line/range; decorations re-evaluate when cursor moves

**`src/editor/vim.ts`**
- Imports `@replit/codemirror-vim` and enables it as a CM6 extension
- `parseVimrc(content: string)`: line-by-line parser handling:
  - `map lhs rhs` / `noremap lhs rhs` → calls `Vim.map(lhs, rhs)` / `Vim.noremap(lhs, rhs)`
  - `set option` / `set option=value` → maps to CM6 config (e.g., `tabstop=4` → `EditorState.tabSize.of(4)`)
  - Ignores comments (`"`) and blank lines
- Reads vimrc from a known path (Tauri: app data dir via Tauri API; web: fetches from server config endpoint or uses defaults)

**`src/editor/folding.ts`**
- CM6 `foldService` that defines fold ranges based on markdown heading levels
- A `# Heading` folds from end-of-heading-line to just before the next heading of equal or higher level
- Integrates with CM6's built-in `foldGutter()` for click-to-fold UI

**`src/editor/sync.ts`**
- `initSync(docPath: string)`: creates a `Y.Doc`, a `Y.Text` within it, and:
  - A `WebsocketProvider` pointing at the server's sync endpoint (e.g., `ws://server/ws/sync/<encoded-path>`)
  - A `yCollab` extension binding Y.Text to the CM6 editor
  - An `IndexeddbPersistence` instance (for Tauri/web offline support)
- `destroySync()`: disconnects provider, cleans up
- Handles connection status: exposes an observable `connected` state for the UI to show online/offline indicator

**`src/ui/sidebar.ts`**
- Renders a file tree from the REST API response (recursive directory listing)
- Vanilla DOM: `<ul>/<li>` with expand/collapse for folders, click-to-open for files
- Context menu or buttons for create/rename/delete (calls `api/client.ts`)
- Highlights the currently open file

**`src/ui/layout.ts`**
- Creates the top-level DOM structure: sidebar container + editor container
- Handles sidebar toggle (show/hide)

**`src/api/client.ts`**
- `listFiles()`: `GET /api/files` → returns recursive file tree as JSON
- `readFile(path)`: `GET /api/files/<path>` → returns file content
- `createFile(path)`: `POST /api/files/<path>`
- `renameFile(oldPath, newPath)`: `PATCH /api/files/<path>`
- `deleteFile(path)`: `DELETE /api/files/<path>`
- `createShareLink(path, mode)`: `POST /api/share` → returns UUID
- `deleteShareLink(uuid)`: `DELETE /api/share/<uuid>`
- All requests include server URL from config

### Server — `server/`

**`app.py`**
- Quart app factory: registers blueprints for files, sync, and share routes
- Configures CORS for Tauri app origin
- Initializes SQLite DB on startup
- Serves frontend static files at `/`

**`routes/files.py`**
- `GET /api/files` — returns recursive directory listing of the vault as JSON (path, type, mtime)
- `GET /api/files/<path>` — returns file content as text
- `POST /api/files/<path>` — creates a new file (with optional body content) or directory
- `PATCH /api/files/<path>` — rename/move (new path in request body)
- `DELETE /api/files/<path>` — deletes file or empty directory
- All paths validated to prevent traversal outside the vault

**`routes/sync.py`**
- WebSocket endpoint at `/ws/sync/<path>` for Yjs document sync
- Uses `pycrdt-websocket` `WebsocketServer`: manages Y.Doc rooms keyed by document path
- On first connection to a room: reads `.md` file from disk, initializes `Y.Text` with its content
- On last client disconnect from a room: writes `Y.Text` content back to `.md`, destroys the room
- Debounced auto-save: writes `.md` periodically while clients are connected (e.g., every 5 seconds on change)

**`routes/share.py`**
- `POST /api/share` — creates a share link: generates UUID, stores (uuid, doc_path, permission) in SQLite, returns UUID
- `DELETE /api/share/<uuid>` — revokes a share link
- `GET /api/share/<uuid>` — serves the frontend with share context (doc path + permission injected as config)
- `GET /ws/share/<uuid>` — WebSocket endpoint for shared doc Yjs sync; validates UUID, enforces read-only if applicable (rejects updates from read-only clients)

**`db.py`**
- SQLite database with a `share_links` table: `(uuid TEXT PRIMARY KEY, doc_path TEXT, permission TEXT, created_at TEXT)`
- Helper functions: `create_link()`, `get_link(uuid)`, `delete_link(uuid)`

**`vault.py`**
- `list_files(root)` — recursive directory walk, returns structured tree
- `read_file(root, path)` — reads `.md` content, validates path is within root
- `write_file(root, path, content)` — writes content to `.md`
- `delete_file(root, path)` — removes file
- `rename_file(root, old, new)` — moves/renames file
- All functions validate paths to prevent directory traversal

### Tauri — `tauri/`

**`src-tauri/src/main.rs`**
- Tauri app setup, registers commands from `commands.rs`
- Configures the app data directory path

**`src-tauri/src/commands.rs`**
- `read_local_file(path)` — reads a file from the local vault
- `write_local_file(path, content)` — writes a file to the local vault (for replica sync)
- `get_config()` — returns app config (server URL, local vault path, vimrc path)
- `list_local_files()` — lists files in local vault for offline file tree

**`tauri.conf.json`**
- Points `distDir` to `../frontend/dist`
- Configures window title, size, permissions (filesystem, HTTP, WebSocket)

### Frontend Tauri Integration

- `src/config.ts` detects the runtime environment (`window.__TAURI__` presence)
- In Tauri mode:
  - After Yjs syncs a document, the content is written to the local vault via Tauri commands (replica)
  - On startup, if online: fetches file list from server API, downloads new/updated files to local vault
  - If offline: loads file tree from local vault, opens documents from local `.md` files with `y-indexeddb` persistence
  - Connection status shown in the UI (e.g., a dot indicator in the sidebar)
- In web mode:
  - No local file ops; everything goes through the server API and WebSocket

## Implementation Phases

### Phase 1: Editor Core
- Set up Vite project with vanilla TypeScript
- Create CM6 editor with markdown language support
- Inline `codemirror-live-markdown` and get live preview working
- Add header-based folding extension
- Add vim mode with `@replit/codemirror-vim`
- Result: a standalone markdown editor in the browser with live preview, folding, and vim mode

### Phase 2: Vimrc Parser
- Implement `parseVimrc()` for `map`, `noremap`, and `set` commands
- Wire parsed config into CM6 extensions (tab size, line numbers, wrap, scrolloff)
- Load vimrc from a static path or embedded default for now
- Result: vim key bindings and settings customizable via vimrc syntax

### Phase 3: Server + File Management
- Set up Quart app with Hypercorn
- Implement REST API for file operations (`routes/files.py`, `vault.py`)
- Serve the Vite-built frontend at `/`
- Build the file tree sidebar UI
- Wire sidebar to REST API: list, create, rename, delete files
- Result: web app with file tree navigation and editing (no sync yet — files loaded via REST)

### Phase 4: Yjs Sync
- Add `pycrdt-websocket` to the server (`routes/sync.py`)
- Implement Y.Doc lifecycle: load from `.md` on first connect, save on last disconnect, debounced auto-save
- Add Yjs sync to the frontend (`sync.ts`): `WebsocketProvider`, `yCollab` extension
- Replace REST-based file loading with Yjs-based sync (REST still used for file tree ops)
- Result: real-time synced editing via Yjs between multiple browser tabs

### Phase 5: Sharing
- Set up SQLite database for share links (`db.py`)
- Implement share link CRUD endpoints (`routes/share.py`)
- Add share WebSocket endpoint with read-only enforcement
- Add "Share" button in the UI that generates and displays a link
- Result: shareable links for viewing/editing documents

### Phase 6: Tauri App
- Initialize Tauri project pointing at the frontend
- Implement Tauri commands for local file read/write and config
- Add `y-indexeddb` persistence for offline Yjs state
- Implement local vault replica: write `.md` files after Yjs sync
- Implement initial vault download on first launch
- Add online/offline detection and connection status UI
- Result: native Mac app that syncs with the server and works offline

## Testing Strategy

### Unit Tests
- **Vimrc parser**: test each `set` option, `map`/`noremap`, comments, blank lines, malformed input
- **Folding**: test fold range calculation for various heading levels, nested headings, edge cases (no headings, single heading, heading at end of doc)
- **Vault helpers**: test path validation (traversal attacks), CRUD operations on a temp directory
- **Share DB**: test create/get/delete link operations
- **API client**: test request construction and response parsing with mocked fetch

### Integration Tests
- **Server REST API**: spin up Quart test client, test full file CRUD lifecycle against a temp vault directory
- **Yjs sync round-trip**: connect two clients to the same doc via WebSocket, verify edits propagate and `.md` file is updated on disconnect
- **Share flow**: create share link, connect via share WebSocket, verify read-only enforcement (updates rejected) and read-write merge
- **Offline replay**: simulate disconnect, make edits, reconnect, verify Yjs merges correctly

### Manual / E2E Tests
- Open the same document in two browser tabs, type in both, verify convergence
- Open a doc in the Tauri app, disconnect network, edit, reconnect, verify sync
- Generate a read-only share link, open in incognito, verify editing is blocked
- Test vimrc: create a vimrc with custom mappings, reload, verify they work
- Fold/unfold headers at various levels, verify content and cursor behavior
- Create/rename/delete files and folders in the sidebar, verify vault state

## Open Questions

- **Server config format**: TOML, YAML, Python file, or environment variables? (Not resolved during Q&A — pick based on preference)
- **Tauri app config format**: JSON or TOML in `~/Library/Application Support/md-notes/`? (Not resolved during Q&A)
- **Server auth**: No auth decided yet. The REST API and WebSocket are open. Fine for localhost/VPN, but needs addressing before exposing to the internet. API key is the simplest option.
- **Auto-save debounce interval**: How frequently should the server write Y.Doc state back to `.md` while clients are connected? 5 seconds suggested but not confirmed.
- **Offline file tree**: When the Tauri app is offline, the sidebar shows the local vault. Should it visually distinguish "possibly stale" state, or just show files as-is?
- **Share link UI**: Where does the share button live — in the sidebar context menu, in an editor toolbar, or both?
- **Image handling**: Live preview renders `![alt](url)` — should images be served from the vault (relative paths) or only external URLs initially?
- **Mobile (future)**: Tauri v2 supports iOS/Android. No decisions made yet on when to add this or whether the same frontend works as-is on small screens.
