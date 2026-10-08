import { useTranslation } from 'react-i18next';
import type { ConnectionStatus } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../stores/connection';

const MESSAGE_KEYS: Record<Exclude<ConnectionStatus, 'ready'>, string> = {
  connecting: 'connection.banner.connecting',
  authenticating: 'connection.banner.connecting',
  reconnecting: 'connection.banner.reconnecting',
  offline: 'connection.banner.offline',
  error: 'connection.banner.error',
};

/**
 * Visible connection banner (anchor area
 * `connection-*`): explains a non-ready status and offers the manual retry
 * control. Never blocks the shell, so a launch with an unreachable daemon
 * shows the offline state instead of a blank screen (VAL-ONBOARD-034).
 */
export function ConnectionBanner() {
  const status = useConnectionStore((state) => state.status);
  const lastErrorKind = useConnectionStore((state) => state.lastErrorKind);
  const retry = useConnectionStore((state) => state.retry);
  const { t } = useTranslation();

  if (status === 'ready') return null;

  const messageKey =
    status === 'error' && lastErrorKind === 'auth'
      ? 'connection.banner.keyRejected'
      : MESSAGE_KEYS[status];

  return (
    <div
      className="connection-banner"
      data-testid="connection-banner"
      data-status={status}
      role="status"
      aria-live="polite"
    >
      <p className="connection-banner__message">{t(messageKey)}</p>
      <button
        type="button"
        className="btn btn--secondary connection-banner__retry"
        data-testid="connection-retry"
        onClick={retry}
      >
        {t('connection.retry')}
      </button>
    </div>
  );
}
