import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { SDK_PACKAGE_VERSION } from '@droidmobile/daemon-client';
import type { ConnectionStatus, DaemonIdentity } from '@droidmobile/daemon-client';
import { useDiagnosticsStore } from '../../diagnostics/capture';
import { appLog } from '../../diagnostics/logBuffer';
import { buildLogReport, describeEndpoint, reportFileName } from '../../diagnostics/report';
import { exportLogFile } from '../../platform/logExport';
import { useInstalledAppVersion } from '../../platform/appVersion';
import { useConnectionStore } from '../../stores/connection';

const STATUS_KEYS: Record<ConnectionStatus, string> = {
  connecting: 'connection.status.connecting',
  authenticating: 'connection.status.authenticating',
  ready: 'connection.status.ready',
  reconnecting: 'connection.status.reconnecting',
  offline: 'connection.status.offline',
  error: 'connection.status.error',
};

type ExportState = 'idle' | 'busy' | 'downloaded' | 'shared' | 'saved' | 'failed';

/**
 * Connection health (live status, last successful authenticate, transport) and
 * the redacted log export. The report is built from the in-memory app log, which
 * redacts keys and tokens as entries are written and again when it is exported.
 */
export function DiagnosticsSection({ identity }: { identity: DaemonIdentity | null }) {
  const { t, i18n } = useTranslation();
  const status = useConnectionStore((state) => state.status);
  const url = useConnectionStore((state) => state.connection?.url ?? null);
  const lastAuthenticatedAt = useDiagnosticsStore((state) => state.lastAuthenticatedAt);
  const appVersion = useInstalledAppVersion();
  const [exportState, setExportState] = useState<ExportState>('idle');
  const endpoint = describeEndpoint(url);

  const exportLogs = async () => {
    setExportState('busy');
    const now = new Date();
    const report = buildLogReport(appLog, {
      generatedAt: now.toISOString(),
      appVersion,
      platform: Capacitor.getPlatform(),
      sdkVersion: SDK_PACKAGE_VERSION,
      daemonVersion: identity?.daemonVersion ?? null,
      protocolVersion: identity?.daemonProtocolVersion ?? null,
      status,
      host: endpoint?.host ?? null,
      transport: endpoint?.transport ?? null,
      lastAuthenticatedAt:
        lastAuthenticatedAt === null ? null : new Date(lastAuthenticatedAt).toISOString(),
    });
    try {
      const result = await exportLogFile(report, reportFileName(now));
      setExportState(result.kind);
    } catch {
      setExportState('failed');
    }
  };

  return (
    <section
      className="diagnostics"
      data-testid="diagnostics-section"
      aria-labelledby="diagnostics-title"
    >
      <h3 className="diagnostics__title" id="diagnostics-title">
        {t('diagnostics.title')}
      </h3>
      <dl className="about-list">
        <div className="about-row">
          <dt>{t('diagnostics.status')}</dt>
          <dd data-testid="diagnostics-status" data-status={status}>
            {t(STATUS_KEYS[status])}
          </dd>
        </div>
        <div className="about-row">
          <dt>{t('diagnostics.lastAuthenticated')}</dt>
          <dd data-testid="diagnostics-last-auth">
            {lastAuthenticatedAt === null
              ? t('diagnostics.never')
              : new Date(lastAuthenticatedAt).toLocaleString(i18n.language)}
          </dd>
        </div>
        <div className="about-row">
          <dt>{t('diagnostics.transport')}</dt>
          <dd data-testid="diagnostics-transport">{endpoint?.transport ?? t('about.unknown')}</dd>
        </div>
        <div className="about-row">
          <dt>{t('diagnostics.host')}</dt>
          <dd data-testid="diagnostics-host">{endpoint?.host ?? t('about.unknown')}</dd>
        </div>
      </dl>
      <p className="field__description">{t('diagnostics.exportDescription')}</p>
      <button
        type="button"
        className="btn btn--secondary"
        data-testid="diagnostics-export-logs"
        disabled={exportState === 'busy'}
        onClick={() => void exportLogs()}
      >
        {t('diagnostics.export')}
      </button>
      <p
        className={exportState === 'failed' ? 'field__error' : 'field__description'}
        role="status"
        data-testid="diagnostics-export-status"
      >
        {exportState === 'idle' || exportState === 'busy'
          ? ''
          : t(`diagnostics.export_${exportState}`)}
      </p>
    </section>
  );
}
