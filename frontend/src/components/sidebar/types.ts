import type { VaultConfig } from '../../api/types';

export type SyncStatus = 'connected' | 'disconnected' | 'connecting';
export type BackendStatus = 'connected' | 'disconnected' | 'unauthorized';

/** Props shared by the desktop and mobile sidebar variants. */
export interface SidebarCommonProps {
  vaultName?: string;
  vaults?: VaultConfig[];
  onSelect: (path: string) => void;
  /** A file or folder was deleted; close any editors on paths under it. */
  onDeleted?: (path: string) => void;
  onShare?: (path: string) => void;
  onSwitchToVault?: (v: VaultConfig) => void;
  onManageVaults?: () => void;
  onRefreshVaults?: () => void;
  onSettings?: () => void;
  showSyncStatus?: boolean;
  /** null/undefined = no docs open, so there's no sync state to report. */
  syncStatus?: SyncStatus | null;
  syncErrorMsg?: string;
  backendStatus?: BackendStatus;
  lastSyncedAt?: number | null;
  idbError?: string | null;
  currentPath: string | null;
}
