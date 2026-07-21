# md-notes vault federation

Federation lets user A share a whole vault with user B, where both run their own md-notes
instance. There is one vault model: a vault is something with a host URL, an optional auth
secret, and a permission level (`read`, `comment`, or `write`). Owned vaults live on your own
instance (host = your origin, no secret, full access); connected vaults live on someone else's.
The client treats both identically — every data request goes straight from the browser to the
vault's host, with the secret attached when present.

## Sharing (user A)

Sidebar vault menu → *"Share this vault with another md-notes user..."* creates a named,
revocable share: a `vault_shares` row `{secret, vault, name, permission}`. The share's invite
link points at A's own instance:

```
https://md-notes.usera.selfhost.imbue.com/federation/connect?vault=<vault>&secret=<secret>
```

Opening the link directly shows an informational page on A's instance (side-effect free)
telling the recipient what to do with it.

## The secret is a vault-scoped credential

A's regular vault API — `/api/docs/{vault}` file routes, the CRDT and search websockets, and
the comment routes — accepts either the owner (OpenHost header) or a `?secret=` query param.
A valid secret grants up to its share's tier on exactly its vault:

- `read` — file listing/reading, search, CRDT sync (server drops incoming doc updates)
- `comment` — read plus the comment routes (comments are written via REST into the doc's CRDT)
- `write` — everything, including file CRUD and a CRDT channel that accepts updates

Owner moderation rights on comments stay owner-only regardless of tier.

## Connecting (user B)

B opens *Manage vaults… → Connect a shared vault* and pastes the link. B's **browser** parses
host/vault/secret, validates the invite by fetching `GET <host>/api/federation/share-info?secret=`
(which reports `app: "md-notes"` and `api_version` — both must match, bump
`FEDERATION_API_VERSION` on incompatible API changes), then POSTs
`/api/vaults/connections` to B's own server. That record `{host, vault, secret, permission,
name}` is the *only* thing B's server holds; it never talks to A. `GET /api/vaults` returns
owned and connected vaults in one list.

The client re-validates the handshake each time a connected vault is opened (A may have
upgraded or revoked since), surfacing a clear error instead of failing mid-sync.

## Revocation

A revokes a share by name in the share modal — deleting the row invalidates the secret
immediately. B disconnects a vault via `DELETE /api/vaults/connections/{id}`, which just
removes the record (files stay on A).
