# md-notes


live-preview-md projects:
- https://github.com/blueberrycongee/codemirror-live-markdown (looks best)
- https://github.com/segphault/codemirror-rich-markdoc


original prompt:
i want an obsidian-like notes app, in particular a markdown editor with "live preview" mode (ie shows markdown when cursor is over the region, but formatted output otherwise), and a vim mode with basic vimrc support. i want this to be useable as a tauri mac app and a web app, and there will be a web server that both serves the web app and provides a sync server for the native app (altho the native app should also work offline). it should use codemirror6, there's some projects already that implement the live preview mode linked in the readme. the "source of truth" should be just normal .md files, altho there can be some additional state for handling the syncing between local and web versions, ideally in a sqlite db or similar depending on what the data is. eventually i'll also want a phone app also. edits made on any device should be resolved somehow, maybe a CRDT? or maybe just locking in some way. i also want folding in the md editor view based on headers. you can assume this is just serving my own personal notes; it doesn't need to be multi-user or high performace. altho i do want to be able to generate a link to share a document for others to view/edit. the web server should be a python quart/hypercorn app.
