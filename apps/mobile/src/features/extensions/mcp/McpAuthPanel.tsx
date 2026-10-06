import { useTranslation } from 'react-i18next';
import { useToast } from '../../../components/Toast';
import { openExternal } from '../../../platform/openExternal';
import { copyText } from '../../terminal/clipboard';
import { authHost } from './mcpStatus';

interface McpAuthPanelProps {
  name: string;
  /** Authorization page once the daemon has produced it. */
  url: string | undefined;
  onCancel: () => void;
}

/**
 * A sign-in in progress. Only the host of the authorization page is shown;
 * its query holds one-time values (state, code_challenge) that stay out of
 * the UI and are only handed to the browser or the clipboard on request.
 */
export function McpAuthPanel({ name, url, onCancel }: McpAuthPanelProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const host = url ? authHost(url) : null;

  const copy = async () => {
    if (!url) return;
    showToast(t((await copyText(url)) ? 'mcp.auth.copied' : 'mcp.auth.copyFailed'));
  };

  return (
    <div
      className="mcp-auth"
      data-testid={`mcp-auth-panel-${name}`}
      role="group"
      aria-label={t('mcp.auth.title', { name })}
    >
      <p className="mcp-auth__title">{t('mcp.auth.title', { name })}</p>
      {url && host ? (
        <>
          <p data-testid={`mcp-auth-host-${name}`}>{host}</p>
          <p className="field__description">{t('mcp.auth.instructions')}</p>
          <div className="mcp-auth__actions">
            <button
              type="button"
              className="btn btn--primary"
              data-testid={`mcp-auth-open-${name}`}
              onClick={() => openExternal(url)}
            >
              {t('mcp.auth.open')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              data-testid={`mcp-auth-copy-${name}`}
              onClick={() => void copy()}
            >
              {t('mcp.auth.copy')}
            </button>
          </div>
        </>
      ) : (
        <p className="field__description" role="status" data-testid={`mcp-auth-waiting-${name}`}>
          {t('mcp.auth.waiting')}
        </p>
      )}
      <button
        type="button"
        className="btn btn--ghost"
        data-testid={`mcp-auth-cancel-${name}`}
        onClick={onCancel}
      >
        {t('common.cancel')}
      </button>
    </div>
  );
}
