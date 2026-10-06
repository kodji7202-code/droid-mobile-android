import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { useConnectionStore } from '../../../stores/connection';
import { ExtensionsSubHeader } from '../ExtensionsSubHeader';
import { ActionMessage } from './ActionMessage';
import { PluginRow } from './PluginRow';
import { PluginsTabs } from './PluginsTabs';
import { INSTALL_SCOPE, usePlugins } from './usePlugins';
import type { PluginEntry } from './pluginLogic';

type Pending = { kind: 'install' | 'uninstall'; entry: PluginEntry };

/** Extensions > Plugins: the plugins the added marketplaces offer, with installed state and controls. */
export function PluginsScreen() {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const plugins = usePlugins(connection);
  const [pending, setPending] = useState<Pending | null>(null);
  const { state } = plugins;
  const entries = state.status === 'ready' ? state.data : [];

  const confirm = () => {
    if (!pending) return;
    const { kind, entry } = pending;
    setPending(null);
    void (kind === 'install' ? plugins.install(entry) : plugins.uninstall(entry));
  };

  return (
    <section
      className="screen"
      data-testid="plugins-screen"
      aria-label={t('extensions.plugins.title')}
    >
      <ExtensionsSubHeader title={t('extensions.plugins.title')} backTo="/extensions" />
      <PluginsTabs />
      {state.status === 'loading' ? (
        <div role="status" data-testid="plugins-loading" aria-label={t('plugins.loading')}>
          <Skeleton />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div data-testid="plugins-error">
          <ErrorState
            title={t('plugins.loadFailedTitle')}
            message={t('plugins.loadFailed')}
            onRetry={plugins.retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {plugins.error ? (
        <ActionMessage
          kind="error"
          testId="plugins-action-error"
          detail={plugins.error.message}
          onDismiss={plugins.dismissError}
        >
          {t(`plugins.errors.${plugins.error.action}`, { name: plugins.error.name })}
        </ActionMessage>
      ) : null}
      {plugins.notice ? (
        <ActionMessage kind="success" testId="plugins-notice" onDismiss={plugins.dismissNotice}>
          {t(`plugins.notices.${plugins.notice.action}`, { name: plugins.notice.name })}
        </ActionMessage>
      ) : null}
      {state.status === 'ready' && entries.length === 0 ? (
        <div data-testid="plugins-empty">
          <EmptyState
            title={t('plugins.empty.title')}
            message={t('plugins.empty.message')}
            action={
              <Link
                to="/extensions/plugins/marketplaces"
                className="btn btn--primary"
                data-testid="plugins-empty-marketplaces"
              >
                {t('plugins.empty.action')}
              </Link>
            }
          />
        </div>
      ) : null}
      {entries.length > 0 ? (
        <ul
          className="mcp-list"
          data-testid="plugins-list"
          aria-label={t('extensions.plugins.title')}
        >
          {entries.map((entry) => (
            <PluginRow
              key={entry.id}
              entry={entry}
              busy={plugins.busy.has(entry.id)}
              onInstall={() => setPending({ kind: 'install', entry })}
              onUninstall={() => setPending({ kind: 'uninstall', entry })}
              onToggle={(enabled) => void plugins.setEnabled(entry, enabled)}
              onUpdate={() => void plugins.update(entry)}
            />
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={pending?.kind === 'install'}
        testId="plugin-install-dialog"
        title={t('plugins.installConfirm.title', { name: pending?.entry.name ?? '' })}
        message={t('plugins.installConfirm.message', {
          name: pending?.entry.name ?? '',
          marketplace: pending?.entry.marketplace ?? '',
          scope: t(`plugins.scope.${INSTALL_SCOPE}`),
        })}
        confirmLabel={t('plugins.install')}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === 'uninstall'}
        testId="plugin-uninstall-dialog"
        title={t('plugins.uninstallConfirm.title', { name: pending?.entry.name ?? '' })}
        message={t('plugins.uninstallConfirm.message', {
          name: pending?.entry.name ?? '',
          scope: t(`plugins.scope.${pending?.entry.installed?.scope ?? INSTALL_SCOPE}`, {
            defaultValue: pending?.entry.installed?.scope ?? INSTALL_SCOPE,
          }),
        })}
        confirmLabel={t('plugins.uninstall')}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
