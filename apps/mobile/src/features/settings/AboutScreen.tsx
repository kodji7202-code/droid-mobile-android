import { useTranslation } from 'react-i18next';
import { SDK_PACKAGE_VERSION } from '@droidmobile/daemon-client';
import { SettingsSubHeader } from './SettingsSubHeader';
import { DiagnosticsSection } from './DiagnosticsSection';
import { useDaemonIdentity } from './useDaemonIdentity';
import { useInstalledAppVersion } from '../../platform/appVersion';

/**
 * Settings > About and diagnostics: app version (the installed APK version on
 * Android), the daemon and protocol versions the daemon reports, the SDK
 * version, then the connection health and log export. The daemon identity is
 * read on demand through a short-lived second WebSocket that never runs as
 * part of the connect flow (VAL-ONBOARD-035, VAL-SET-021, VAL-SET-022).
 */
export function AboutScreen() {
  const { t } = useTranslation();
  const appVersion = useInstalledAppVersion();
  const identity = useDaemonIdentity();

  return (
    <section className="screen" data-testid="about-screen">
      <SettingsSubHeader title={t('about.title')} />
      <dl className="about-list">
        <div className="about-row">
          <dt>{t('about.appVersion')}</dt>
          <dd data-testid="about-app-version">{appVersion}</dd>
        </div>
        <div className="about-row">
          <dt>{t('about.daemonVersion')}</dt>
          <dd data-testid="about-daemon-version">
            {identity?.daemonVersion ?? t('about.unknown')}
          </dd>
        </div>
        <div className="about-row">
          <dt>{t('about.protocolVersion')}</dt>
          <dd data-testid="about-protocol-version">
            {identity?.daemonProtocolVersion ?? t('about.unknown')}
          </dd>
        </div>
        <div className="about-row">
          <dt>{t('about.sdkVersion')}</dt>
          <dd data-testid="about-sdk-version">{SDK_PACKAGE_VERSION}</dd>
        </div>
      </dl>
      <p className="field__description">{t('about.unofficial')}</p>
      <DiagnosticsSection identity={identity} />
    </section>
  );
}
