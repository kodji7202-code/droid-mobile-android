import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { McpTool } from '@droidmobile/daemon-client';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { useConnectionStore } from '../../../stores/connection';
import { ExtensionsSubHeader } from '../ExtensionsSubHeader';
import { McpStatusBadge } from './McpStatusBadge';
import { needsAuth, redactError } from './mcpStatus';
import { useMcpServerList } from './useMcpServerList';

type ToolsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; tools: McpTool[] };

const DETAIL_POLL_MS = 3000;

function useServerTools(name: string, key: string) {
  const connection = useConnectionStore((state) => state.connection);
  const [state, setState] = useState<ToolsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    if (!connection) {
      setState({ status: 'error' });
      return undefined;
    }
    // The key changes with the server's status/tool count, so a server that
    // finishes connecting gets its tools without leaving the page.
    connection.mcp
      .listTools(name)
      .then((tools) => current && setState({ status: 'ready', tools }))
      .catch(() => current && setState({ status: 'error' }));
    return () => {
      current = false;
    };
  }, [connection, name, key, attempt]);

  return {
    state,
    retry: () => {
      setState({ status: 'loading' });
      setAttempt((value) => value + 1);
    },
  };
}

function ToolList({ tools }: { tools: McpTool[] }) {
  const { t } = useTranslation();
  return (
    <>
      <p data-testid="mcp-tools-count">{t('mcp.toolCount', { count: tools.length })}</p>
      <ul className="mcp-tools" data-testid="mcp-tools-list" aria-label={t('mcp.detail.tools')}>
        {tools.map((tool) => (
          <li key={tool.name} className="mcp-tool">
            <span className="mcp-tool__name" data-testid={`mcp-tool-name-${tool.name}`}>
              {tool.name}
            </span>
            {tool.description ? (
              <span className="field__description">{tool.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** One server: its status, error text and the tools it exposes. */
export function McpDetailScreen() {
  const { t } = useTranslation();
  const { name = '' } = useParams();
  const connection = useConnectionStore((state) => state.connection);
  const { state, retry } = useMcpServerList(connection, DETAIL_POLL_MS);
  const server =
    state.status === 'ready' ? state.servers.find((item) => item.name === name) : undefined;
  const toolsKey = `${server?.status ?? ''}:${server?.toolCount ?? ''}`;
  const tools = useServerTools(name, toolsKey);

  return (
    <section className="screen" data-testid="mcp-detail" aria-label={name}>
      <ExtensionsSubHeader title={name} backTo="/extensions/mcp" />
      {state.status === 'loading' ? (
        <div role="status" data-testid="mcp-detail-loading" aria-label={t('mcp.loading')}>
          <Skeleton />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <ErrorState
          title={t('mcp.loadFailedTitle')}
          message={t('mcp.loadFailed')}
          onRetry={retry}
          retryLabel={t('common.retry')}
        />
      ) : null}
      {state.status === 'ready' && !server ? (
        <div data-testid="mcp-detail-missing">
          <EmptyState
            title={t('mcp.detail.missingTitle')}
            message={t('mcp.detail.missing', { name })}
          />
        </div>
      ) : null}
      {server ? (
        <>
          <div className="mcp-row__meta">
            <McpStatusBadge server={server} />
            <span className="chip">{server.serverType}</span>
            <span className="chip">
              {t(`mcp.source.${server.source}`, { defaultValue: server.source })}
            </span>
          </div>
          {server.error ? (
            <p className="mcp-row__error" data-testid="mcp-detail-error">
              {needsAuth(server) ? t('mcp.status.authRequired') : redactError(server.error)}
            </p>
          ) : null}
          <h3 className="mcp-detail__heading">{t('mcp.detail.tools')}</h3>
          {tools.state.status === 'loading' ? (
            <div role="status" data-testid="mcp-tools-loading" aria-label={t('mcp.loading')}>
              <Skeleton />
            </div>
          ) : null}
          {tools.state.status === 'error' ? (
            <ErrorState
              title={t('mcp.detail.toolsFailedTitle')}
              message={t('mcp.detail.toolsFailed')}
              onRetry={tools.retry}
              retryLabel={t('common.retry')}
            />
          ) : null}
          {tools.state.status === 'ready' && tools.state.tools.length === 0 ? (
            <div data-testid="mcp-tools-empty">
              <EmptyState
                title={t('mcp.detail.noTools')}
                message={
                  server.status === 'connected'
                    ? t('mcp.detail.noToolsConnected')
                    : t('mcp.detail.noToolsOffline')
                }
              />
            </div>
          ) : null}
          {tools.state.status === 'ready' && tools.state.tools.length > 0 ? (
            <ToolList tools={tools.state.tools} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
