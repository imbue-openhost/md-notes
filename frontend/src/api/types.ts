export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: FileEntry[] | null;
}

/** A vault shared from another md-notes instance, stored on our server. */
export interface RemoteVaultRef {
  id: string;
  name: string;
  source_url: string;
  vault_name: string;
  secret: string;
  permission: 'read' | 'write';
  created_at: string;
}

export interface VaultConfig {
  name: string;
  path: string;
  sync: boolean;
  /** Present for federated vaults living on another instance. */
  remote?: RemoteVaultRef;
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
