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

### sync protocol

- i first tried to build this where markdown is really the source of truth, and the CRDT is ephemeral - created when the first client connects, and deleted shortly after the last client disconnects
    - and the client is supposed to pull fresh state any time it reconnects
    - but "disconnects" can mean "closed laptop and will reopen in a week", and their client will still have the old state
    - and when the client reconnects, part of the handshake is that the client and server sync state. if the server is a fresh room, with the doc freshly loaded, and the client already has the doc with separate history, they'll merge and you'll end up with duplication.
    - seems like this could be addressed with a change to the handshake logic, but the CRDT libraries expect that the server persists CRDT state even if the room is shutdown, so hooks into this handshake aren't really exposed. and i don't really wanna get to rewriting the core libraries.
    - with a native app that has persistent local state, this gets even harder, and a persistent remote CRDT state probably makes even more sense?

- the intended pattern is to persist room state to disk also, so that there's only one CRDT history, and resyncs of different devices will always be consistent.
    - i don't love this though because it weakens the .md files being the single source of truth - if the CRDT is persistent, it's really the source of truth, and i guess we just write out the body to the .md files periodically, but the .md files never actually get read back. does this matter? idk
    - this also helps avoid a full document copy on page load (if client state was stored in indexdb or similar)
    - what if the .md files get edited while the CRDT is active? that makes a mess of things.
    - this will also let me store comments etc in the CRDT state and not need to persist to an external DB.

i ended up switching to the second pattern; just seemed like that's closer to standard practice.

### backend

- litestar API
- CRDT implemented with y.js and served over a websocket
- API is documented in server/openapi/openapi.json. this is generated via a git hook; **clients should build against this spec**

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
