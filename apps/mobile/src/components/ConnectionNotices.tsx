import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from './Toast';
import { useConnectionStore } from '../stores/connection';

/**
 * Non-blocking notices for the daemon connection. A protocol-version mismatch
 * reported by a failed call becomes an info toast and is then consumed: the
 * failure itself is still handled by the caller, the warning never blocks the
 * UI (feature connection-manager-reconnect-offline).
 */
export function ConnectionNotices() {
  const warning = useConnectionStore((state) => state.versionWarning);
  const clearVersionWarning = useConnectionStore((state) => state.clearVersionWarning);
  const { showToast } = useToast();
  const { t } = useTranslation();
  const lastShown = useRef<string | null>(null);

  useEffect(() => {
    if (!warning) return;
    clearVersionWarning();
    const key = `${warning.localFactoryProtocolVersion}->${warning.peerFactoryProtocolVersion}`;
    if (lastShown.current === key) return;
    lastShown.current = key;
    showToast(
      t('connection.versionWarning', {
        local: warning.localFactoryProtocolVersion,
        peer: warning.peerFactoryProtocolVersion,
      }),
      'info',
    );
  }, [warning, clearVersionWarning, showToast, t]);

  return null;
}
