import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { useConnectionStore } from '../../../stores/connection';
import { ExtensionsSubHeader } from '../ExtensionsSubHeader';
import { ActionMessage } from './ActionMessage';
import { AddMarketplaceSheet } from './AddMarketplaceSheet';
import { MarketplaceRow } from './MarketplaceRow';
import { PluginsTabs } from './PluginsTabs';
import { useMarketplaces } from './useMarketplaces';

/** Extensions > Plugins > Marketplaces: the daemon's marketplaces with add, update and remove. */
export function MarketplacesScreen() {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const marketplaces = useMarketplaces(connection);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const { state, error, notice } = marketplaces;
  const list = state.status === 'ready' ? state.data : [];
  const addFailure = error?.action === 'add' ? error : null;
  const rowError = error && error.action !== 'add' ? error : null;

  const openAdd = () => {
    marketplaces.dismissError();
    setAdding(true);
  };

  const addButton = (
    <button
      type="button"
      className="btn btn--primary"
      data-testid="marketplace-add"
      onClick={openAdd}
    >
      {t('marketplaces.add')}
    </button>
  );

  const confirmRemove = () => {
    if (removing === null) return;
    const name = removing;
    setRemoving(null);
    void marketplaces.remove(name);
  };

  return (
    <section
      className="screen"
      data-testid="marketplaces-screen"
      aria-label={t('plugins.tabs.marketplaces')}
    >
      <ExtensionsSubHeader
        title={t('extensions.plugins.title')}
        backTo="/extensions"
        actions={state.status === 'ready' && list.length > 0 ? addButton : null}
      />
      <PluginsTabs />
      {state.status === 'loading' ? (
        <div
          role="status"
          data-testid="marketplaces-loading"
          aria-label={t('marketplaces.loading')}
        >
          <Skeleton />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div data-testid="marketplaces-error">
          <ErrorState
            title={t('marketplaces.loadFailedTitle')}
            message={t('marketplaces.loadFailed')}
            onRetry={marketplaces.retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {rowError ? (
        <ActionMessage
          kind="error"
          testId="marketplaces-action-error"
          detail={rowError.message}
          onDismiss={marketplaces.dismissError}
        >
          {t(`marketplaces.errors.${rowError.action}`, { name: rowError.name })}
        </ActionMessage>
      ) : null}
      {notice ? (
        <ActionMessage
          kind="success"
          testId="marketplaces-notice"
          onDismiss={marketplaces.dismissNotice}
        >
          {t(`marketplaces.notices.${notice.action}`, { name: notice.name })}
        </ActionMessage>
      ) : null}
      {state.status === 'ready' && list.length === 0 ? (
        <div data-testid="marketplaces-empty">
          <EmptyState
            title={t('marketplaces.empty.title')}
            message={t('marketplaces.empty.message')}
            action={addButton}
          />
        </div>
      ) : null}
      {list.length > 0 ? (
        <ul
          className="mcp-list"
          data-testid="marketplaces-list"
          aria-label={t('plugins.tabs.marketplaces')}
        >
          {list.map((marketplace) => (
            <MarketplaceRow
              key={marketplace.name}
              marketplace={marketplace}
              busy={marketplaces.busy.has(marketplace.name)}
              onUpdate={() => void marketplaces.update(marketplace.name)}
              onRemove={() => setRemoving(marketplace.name)}
            />
          ))}
        </ul>
      ) : null}
      <AddMarketplaceSheet
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={marketplaces.add}
        adding={marketplaces.adding}
        error={addFailure}
        onDismissError={marketplaces.dismissError}
      />
      <ConfirmDialog
        open={removing !== null}
        testId="marketplace-remove-dialog"
        title={t('marketplaces.removeConfirm.title', { name: removing ?? '' })}
        message={t('marketplaces.removeConfirm.message', { name: removing ?? '' })}
        confirmLabel={t('marketplaces.remove')}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
