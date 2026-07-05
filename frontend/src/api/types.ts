export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: FileEntry[] | null;
}

export interface VaultConfig {
  name: string;
  path: string;
  sync: boolean;
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
