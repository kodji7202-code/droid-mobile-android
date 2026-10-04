import { useTranslation } from 'react-i18next';
import type { ConnectionStatus } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../stores/connection';

const STATUS_KEYS: Record<ConnectionStatus, string> = {
  connecting: 'connection.status.connecting',
  authenticating: 'connection.status.authenticating',
  ready: 'connection.status.ready',
  reconnecting: 'connection.status.reconnecting',
  offline: 'connection.status.offline',
  error: 'connection.status.error',
};

/**
 * Live daemon connection status (architecture.md section 5 anchor
 * `connection-status`). Present on every main destination: the visible text,
 * the `data-status` colour class and the accessible name all indicate the
 * current daemon-client status.
 */
export function ConnectionStatusIndicator() {
  const status = useConnectionStore((state) => state.status);
  const { t } = useTranslation();
  const label = t(STATUS_KEYS[status]);
  return (
    <span
      className="connection-status"
      data-testid="connection-status"
      data-status={status}
      role="status"
      aria-label={label}
    >
      <span className="connection-status__dot" aria-hidden="true" />
      <span className="connection-status__text">{label}</span>
    </span>
  );
}
