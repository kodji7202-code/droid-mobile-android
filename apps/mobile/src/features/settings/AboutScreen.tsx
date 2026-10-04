import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SDK_PACKAGE_VERSION } from '@droidmobile/daemon-client';
import type { DaemonIdentity } from '@droidmobile/daemon-client';
import { SettingsSubHeader } from './SettingsSubHeader';
import { useConnectionStore } from '../../stores/connection';
import { APP_VERSION } from '../../platform/appVersion';

/**
 * Settings > About: app version (apps/mobile/package.json), SDK version
 * (packages/daemon-client pin) and the daemon-reported protocol version
 * (VAL-ONBOARD-035). The daemon version is read on demand through
 * connection.getDaemonIdentity() — a short-lived second WebSocket that never
 * runs as part of the connect flow.
 */
export function AboutScreen() {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const status = useConnectionStore((state) => state.status);
  const [identity, setIdentity] = useState<DaemonIdentity | null>(null);

  useEffect(() => {
    if (!connection || status !== 'ready') {
      setIdentity(null);
      return;
    }
    let cancelled = false;
    connection
      .getDaemonIdentity()
      .then((value) => {
        if (!cancelled) setIdentity(value);
      })
      .catch(() => {
        if (!cancelled) setIdentity(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, status]);

  const protocolVersion = identity?.daemonProtocolVersion ?? t('about.unknown');

  return (
    <section className="screen" data-testid="about-screen">
      <SettingsSubHeader title={t('about.title')} />
      <dl className="about-list">
        <div className="about-row">
          <dt>{t('about.appVersion')}</dt>
          <dd data-testid="about-app-version">{APP_VERSION}</dd>
        </div>
        <div className="about-row">
          <dt>{t('about.sdkVersion')}</dt>
          <dd data-testid="about-sdk-version">{SDK_PACKAGE_VERSION}</dd>
        </div>
        <div className="about-row">
          <dt>{t('about.protocolVersion')}</dt>
          <dd data-testid="about-protocol-version">{protocolVersion}</dd>
        </div>
      </dl>
    </section>
  );
}
