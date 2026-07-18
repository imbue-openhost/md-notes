# md-notes vault federation

Federation lets user A share a whole vault with user B, where both run their own md-notes
instance. B's server stores a reference (source URL + secret) to the vault on A's instance, and
B's client connects *directly* to A's instance, interacting with the vault as if it were local.
Shares are read-only or read-write, and are named so A can tell them apart and revoke them
individually.

## Invite flow

1. A clicks "Share this vault..." in the sidebar's vault menu, enters a name for the share
   (e.g. "bob") and picks read-only or read-write. A's server creates a `vault_shares` row with a
   random secret and returns an invite link pointing at *A's own instance*:

   ```
   https://md-notes.usera.selfhost.imbue.com/federation/connect?vault=<vault>&secret=<secret>
   ```

2. A sends that link to B. (Opening the link directly just shows an informational page on A's
   instance explaining what to do with it — it never mutates anything.)

3. B opens their own md-notes, chooses *Manage vaults… → Connect a shared vault*, and pastes the
   link. B's client parses the source origin, vault, and secret out of it and POSTs
   `/api/federation/remotes` to B's own server.

4. B's server validates the invite by fetching `<source>/api/federation/peer/vault?secret=...`,
   checking the handshake fields (`app == "md-notes"`, matching `api_version`) and storing the
   reference with the permission reported by the source. GETs never mutate anything; the
   connection is created only by that authenticated POST.

5. B's vault list now includes the remote vault. File listing/read/write and the CRDT websocket
   go directly from B's browser to A's instance, authenticated by the secret.

## Versioning

`GET /api/federation/peer/vault` returns `app` (`"md-notes"`) and `api_version` (currently `1`)
alongside the vault metadata. A connecting instance refuses to store the remote unless both
match its own values, and the client re-checks the handshake every time it opens a remote vault
(the source instance may have upgraded since the connection was made), surfacing a clear error
instead of failing confusingly mid-sync. Bump `FEDERATION_API_VERSION` when the peer API changes
incompatibly.

## Revocation

A lists shares (with their names) in the "Share vault" modal and can revoke each one; revoking
deletes the `vault_shares` row, immediately invalidating the secret. B can likewise disconnect
a remote vault, deleting the stored reference.

## Peer API (served by the sharing instance)

All peer endpoints are public at the router level; the share secret is the capability. It is
passed as a `secret` query parameter. Invalid or revoked secrets yield 401. Write operations
on a read-only share yield 403. All file paths are validated against the shared vault root
(no traversal), and the vault is pinned server-side by the secret — clients cannot reach other
vaults.

- `GET  /api/federation/peer/vault?secret=` → `{app, api_version, vault_name, permission}`
- `GET  /api/federation/peer/docs?secret=` → file tree
- `GET  /api/federation/peer/docs/file?path=&secret=` → file content
- `POST /api/federation/peer/docs/file?path=&secret=` `{content, type}` — create file/dir (write shares)
- `PATCH /api/federation/peer/docs/file?path=&secret=` `{newPath}` — rename (write shares)
- `DELETE /api/federation/peer/docs/file?path=&secret=` — delete (write shares)
- `WS   /api/federation/peer/crdt_websocket/{filepath}?secret=` — Yjs sync; the room is pinned
  to the shared vault; read-only shares get a channel that drops incoming updates
- `WS   /api/federation/peer/search_websocket?secret=` — interactive search in the shared vault

## Owner API (each instance manages its own shares and remotes)

- `POST /api/federation/shares` `{vaultName, name, permission}` → `{secret, invite_url}`
- `GET  /api/federation/shares` → list
- `DELETE /api/federation/shares/{secret}`
- `POST /api/federation/remotes` `{sourceUrl, vaultName, secret, name?}` → stored remote vault
  (server-side validation against the source; `name` defaults to the remote vault name,
  deduplicated against existing vaults)
- `GET  /api/federation/remotes` → list
- `DELETE /api/federation/remotes/{id}`
