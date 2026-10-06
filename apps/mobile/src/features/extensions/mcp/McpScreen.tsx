import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { useConnectionStore } from '../../../stores/connection';
import { ExtensionList } from '../ExtensionList';
import { ExtensionsSubHeader } from '../ExtensionsSubHeader';
import { AddMcpSheet } from './AddMcpSheet';
import { McpServerRow } from './McpServerRow';
import { useMcp } from './useMcp';

/** Extensions > MCP servers: the daemon's list with add, toggle, sign-in and remove. */
export function McpScreen() {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const mcp = useMcp(connection);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ name: string; hasAuth: boolean } | null>(null);

  const servers = mcp.state.status === 'ready' ? mcp.state.servers : [];

  const openAdd = () => {
    mcp.clearError();
    setAdding(true);
  };

  const addButton = (
    <button type="button" className="btn btn--primary" data-testid="mcp-add" onClick={openAdd}>
      {t('mcp.add')}
    </button>
  );

  const confirmRemove = () => {
    if (!removing) return;
    const { name, hasAuth } = removing;
    setRemoving(null);
    void mcp.remove(name, hasAuth);
  };

  return (
    <section className="screen" data-testid="mcp-screen" aria-label={t('extensions.mcp.title')}>
      <ExtensionsSubHeader
        title={t('extensions.mcp.title')}
        backTo="/extensions"
        actions={mcp.state.status === 'ready' && servers.length > 0 ? addButton : null}
      />
      {mcp.state.status === 'loading' ? (
        <div role="status" data-testid="mcp-loading" aria-label={t('mcp.loading')}>
          <Skeleton />
        </div>
      ) : null}
      {mcp.state.status === 'error' ? (
        <div data-testid="mcp-error">
          <ErrorState
            title={t('mcp.loadFailedTitle')}
            message={t('mcp.loadFailed')}
            onRetry={mcp.retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {mcp.error && mcp.error.action !== 'add' ? (
        <p role="alert" className="field__error" data-testid="mcp-action-error">
          {t(`mcp.errors.${mcp.error.action}`, { name: mcp.error.name })}
        </p>
      ) : null}
      {mcp.state.status === 'ready' ? (
        <ExtensionList
          testId="mcp-list"
          label={t('extensions.mcp.title')}
          empty={
            servers.length === 0
              ? {
                  testId: 'mcp-empty',
                  content: (
                    <EmptyState
                      title={t('mcp.empty.title')}
                      message={t('mcp.empty.message')}
                      action={addButton}
                    />
                  ),
                }
              : null
          }
        >
          {servers.map((server) => (
            <McpServerRow
              key={server.name}
              server={server}
              busy={mcp.busy.has(server.name)}
              authPending={mcp.authPending.has(server.name)}
              onToggle={(enabled) => void mcp.toggle(server.name, enabled)}
              onRemove={() =>
                setRemoving({
                  name: server.name,
                  hasAuth: server.requiresAuth === true || server.hasAuthTokens === true,
                })
              }
              onAuthenticate={() => mcp.startAuth(server.name)}
              onCancelAuth={() => void mcp.cancelAuth(server.name)}
            />
          ))}
        </ExtensionList>
      ) : null}
      <AddMcpSheet
        open={adding}
        onClose={() => setAdding(false)}
        existingNames={servers.map((server) => server.name)}
        onSubmit={mcp.add}
        adding={mcp.adding}
        failed={mcp.error?.action === 'add'}
      />
      <ConfirmDialog
        open={removing !== null}
        testId="mcp-remove-dialog"
        title={t('mcp.removeConfirm.title', { name: removing?.name ?? '' })}
        message={t('mcp.removeConfirm.message', { name: removing?.name ?? '' })}
        confirmLabel={t('mcp.remove')}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
