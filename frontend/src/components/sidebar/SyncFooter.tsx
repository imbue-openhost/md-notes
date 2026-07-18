import { createSignal, onCleanup, Show, type Component } from 'solid-js';
import type { SyncStatus, BackendStatus } from './types';

const SYNC_LABELS: Record<SyncStatus, string> = {
  connected: 'Synced',
  disconnected: 'Offline',
  connecting: 'Connecting...',
};

const BACKEND_LABELS: Record<BackendStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  unauthorized: 'Not logged in',
};

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface Props {
  showSyncStatus?: boolean;
  syncStatus?: SyncStatus | null;
  syncErrorMsg?: string;
  backendStatus?: BackendStatus;
  lastSyncedAt?: number | null;
  idbError?: string | null;
}

export const SyncFooter: Component<Props> = (props) => {
  const [tick, setTick] = createSignal(0);
  const tickInterval = setInterval(() => setTick((t) => t + 1), 30_000);
  onCleanup(() => clearInterval(tickInterval));

  const lastSyncedLabel = () => {
    tick();
    const ts = props.lastSyncedAt;
    if (!ts) return null;
    return `Synced ${formatRelativeTime(ts)}`;
  };

  return (
    <>
      <Show when={props.showSyncStatus && props.syncStatus}>
        {(status) => (
          <div
            class="sidebar-sync-status"
            data-status={status()}
            title={props.syncErrorMsg ?? ''}
          >
            <span class="sidebar-sync-dot" data-status={status()} />
            <span>{SYNC_LABELS[status()]}</span>
          </div>
        )}
      </Show>

      <Show when={props.backendStatus && props.backendStatus !== 'connected'}>
        <div class="sidebar-sync-status" data-status={props.backendStatus}>
          <span class="sidebar-sync-dot" data-status={props.backendStatus} />
          <span>{BACKEND_LABELS[props.backendStatus!]}</span>
        </div>
      </Show>

      <Show when={lastSyncedLabel()}>
        <div class="sidebar-sync-detail">{lastSyncedLabel()}</div>
      </Show>

      <Show when={props.idbError}>
        <div class="sidebar-sync-warning">{props.idbError}</div>
      </Show>
    </>
  );
};
