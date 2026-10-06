import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { McpServer } from '@droidmobile/daemon-client';
import { ChevronRightIcon } from '../../../components/icons';
import { McpAuthPanel } from './McpAuthPanel';
import { McpStatusBadge } from './McpStatusBadge';
import { needsAuth, redactError } from './mcpStatus';

interface McpServerRowProps {
  server: McpServer;
  busy: boolean;
  authPending: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onAuthenticate: () => void;
  onCancelAuth: () => void;
}

/** Only user-level servers can be switched or removed; the daemon refuses the rest. */
export function isEditable(server: McpServer): boolean {
  return !server.isManaged && server.source === 'user';
}

export function McpServerRow({
  server,
  busy,
  authPending,
  onToggle,
  onRemove,
  onAuthenticate,
  onCancelAuth,
}: McpServerRowProps) {
  const { t } = useTranslation();
  const { name } = server;
  const authNeeded = needsAuth(server);
  const editable = isEditable(server);
  const enabled = server.status !== 'disabled';

  return (
    <li className="mcp-row" data-testid={`mcp-row-${name}`}>
      <Link
        to={`/extensions/mcp/${encodeURIComponent(name)}`}
        className="mcp-row__main"
        data-testid={`mcp-open-${name}`}
      >
        <span className="mcp-row__text">
          <span className="mcp-row__name">{name}</span>
          <span className="mcp-row__meta">
            <McpStatusBadge server={server} />
            <span className="chip" data-testid={`mcp-transport-${name}`}>
              {server.serverType}
            </span>
            <span className="chip" data-testid={`mcp-source-${name}`}>
              {t(`mcp.source.${server.source}`, { defaultValue: server.source })}
            </span>
            {server.toolCount !== undefined ? (
              <span className="mcp-row__tools" data-testid={`mcp-tool-count-${name}`}>
                {t('mcp.toolCount', { count: server.toolCount })}
              </span>
            ) : null}
          </span>
          {server.error && !authNeeded ? (
            <span className="mcp-row__error" data-testid={`mcp-error-${name}`}>
              {redactError(server.error)}
            </span>
          ) : null}
        </span>
        <ChevronRightIcon className="settings-row__chevron" />
      </Link>
      <div className="mcp-row__actions">
        <div className="mcp-row__toggle">
          {busy ? (
            <span
              className="spinner"
              role="status"
              aria-label={t('mcp.working')}
              data-testid={`mcp-pending-${name}`}
            />
          ) : null}
          <input
            type="checkbox"
            role="switch"
            className="settings-toggle__control"
            data-testid={`mcp-toggle-${name}`}
            aria-label={t('mcp.toggleLabel', { name })}
            checked={enabled}
            aria-checked={enabled}
            disabled={busy || !editable}
            onChange={() => onToggle(!enabled)}
          />
        </div>
        {authNeeded && !authPending ? (
          <button
            type="button"
            className="btn btn--secondary"
            data-testid={`mcp-auth-${name}`}
            disabled={busy}
            onClick={onAuthenticate}
          >
            {t('mcp.auth.start')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost"
          data-testid={`mcp-remove-${name}`}
          aria-label={t('mcp.removeLabel', { name })}
          disabled={busy || !editable}
          onClick={onRemove}
        >
          {t('mcp.remove')}
        </button>
      </div>
      {authPending ? (
        <McpAuthPanel name={name} url={server.pendingAuthUrl} onCancel={onCancelAuth} />
      ) : null}
    </li>
  );
}
