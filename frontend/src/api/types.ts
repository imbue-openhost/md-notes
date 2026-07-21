export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: FileEntry[] | null;
}

export type Permission = 'read' | 'comment' | 'write';

/**
 * A vault the client can open: owned ones live on this instance, connected ones on another.
 * All data requests go to `host` with `secret` attached when present; `owned` only matters for
 * management operations (delete vs disconnect, sharing, connection status).
 */
export interface Vault {
  /** Stable local key: the vault name for owned vaults, the connection id for connected ones. */
  id: string;
  /** Display name, unique across this instance's vault list. */
  name: string;
  /** Origin serving the vault's API. */
  host: string;
  /** Vault name on the host (URL path segment); equals `name` for owned vaults. */
  vault: string;
  permission: Permission;
  owned: boolean;
  secret: string | null;
}

/** Codepoint offsets into SearchHit.text; end-exclusive. */
export interface MatchRange {
  start: number;
  end: number;
}

export interface SearchHit {
  path: string;
  line_number: number;
  text: string;
  ranges: MatchRange[];
  score: number;
}
