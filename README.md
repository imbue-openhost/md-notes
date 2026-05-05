# md-notes

## Design

This is a document/notes editor, most similar to Obsidian. Some important core design principles:
- it is markdown based. plain markdown files are the source of truth
- the backend runs in openhost, a platform for easily self-hosting open source and personal software in a persistent, web-routeable space. every user of this app will host their own instance in their own openhost space.
- there's a client-server model because we want native support for multi-device use and real-time collaboration.
- the backend is designed to be used with any compatible client - web or native. the openhost app comes with the server and a default web frontend, but other clients can connect to the same backend.
- realtime collaboration is enabled by a CRDT layer sitting on top of the markdown file archive - this is intended to be ephemeral, serving to deconflict simultaneous edits but otherwise do as little as possible.
- some features/metadata might likely won't fit cleanly in markdown, like comments, history, sharing status, etc, and we'll deal with those as necessary, probably persisting to a sqlite db.


## Implementation details

### backend

- **Quart/Hypercorn server** with REST API for file CRUD and static frontend serving
- **Yjs real-time sync** — edits sync between browser tabs/devices via WebSocket
- **Share links** — generate read-only or read-write links, stored in SQLite
- **API key auth** — all routes except `/share/` require authentication
- **OpenHost deployment** at `md-notes.host.zackpolizzi.com`
- **Tauri scaffolding** — Rust project compiles, ready to build native Mac app
- **y-indexeddb** — offline persistence for Yjs document state

### default web editor (built for zack specifically :) )

- **CodeMirror 6 editor** with markdown language support
- **Markdown styling** via `markdownStylePlugin` — headings render at proper sizes, bold/italic/code/links get CSS styling. Formatting marks (`**`, `*`, `#`, etc.) remain visible but styled.
- **Vim mode** via `@replit/codemirror-vim` with status bar showing current mode
- **Vimrc parser** — supports `map`/`noremap` (with mode prefixes `nmap`, `imap`, `vmap`, etc.) and `set` commands (`number`, `relativenumber`, `tabstop`, `shiftwidth`, `expandtab`, `wrap`, `scrolloff`)
- **Header-based folding** — click the fold gutter to collapse sections
- **File tree sidebar** with create (+ button), rename/delete (right-click context menu)

### tauri native editor

- intended to share most code with the web editor, just packaged as a native app
- unfinished and on hold for now, to focus on the web editor.
- supporting a nice offline mode adds complexity vs web.


## TODO

### server

- make openapi doc for api contract
- organize files better
- split core vs route code better
- cleanup config.py into a typed config object
- do something with the db
