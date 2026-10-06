import { useTranslation } from 'react-i18next';
import { isPluginActive } from './pluginLogic';
import type { PluginEntry } from './pluginLogic';

interface PluginRowProps {
  entry: PluginEntry;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onToggle: (enabled: boolean) => void;
  onUpdate: () => void;
}

export function PluginRow({
  entry,
  busy,
  onInstall,
  onUninstall,
  onToggle,
  onUpdate,
}: PluginRowProps) {
  const { t } = useTranslation();
  const { id, name, installed } = entry;
  const active = installed ? isPluginActive(installed) : false;
  const locked = installed?.managed === true;

  return (
    <li className="mcp-row" data-testid={`plugin-row-${id}`}>
      <div className="mcp-row__main">
        <span className="mcp-row__text">
          <span className="mcp-row__name">{name}</span>
          <span
            className={entry.description ? 'skill-row__description' : 'field__description'}
            data-testid={`plugin-description-${id}`}
          >
            {entry.description || t('plugins.noDescription')}
          </span>
          <span className="mcp-row__meta">
            <span className="chip" data-testid={`plugin-marketplace-${id}`}>
              {entry.marketplace}
            </span>
            {installed ? (
              <>
                <span
                  className="badge badge--info"
                  data-testid={`plugin-installed-${id}`}
                  data-scope={installed.scope}
                >
                  {t('plugins.installed')}
                </span>
                <span
                  className={`badge badge--${active ? 'success' : 'muted'}`}
                  data-testid={`plugin-state-${id}`}
                  data-active={active}
                >
                  {t(active ? 'plugins.state.enabled' : 'plugins.state.disabled')}
                </span>
                <span className="chip" data-testid={`plugin-scope-${id}`}>
                  {t('plugins.scopeChip', {
                    scope: t(`plugins.scope.${installed.scope}`, { defaultValue: installed.scope }),
                  })}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </div>
      <div className="mcp-row__actions">
        {installed ? (
          <>
            <div className="mcp-row__toggle">
              {busy ? (
                <span
                  className="spinner"
                  role="status"
                  aria-label={t('plugins.working')}
                  data-testid={`plugin-pending-${id}`}
                />
              ) : null}
              <input
                type="checkbox"
                role="switch"
                className="settings-toggle__control"
                data-testid={`plugin-toggle-${id}`}
                aria-label={t('plugins.toggleLabel', { name })}
                checked={active}
                aria-checked={active}
                disabled={busy || locked}
                onChange={() => onToggle(!active)}
              />
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              data-testid={`plugin-update-${id}`}
              aria-label={t('plugins.updateLabel', { name })}
              disabled={busy}
              onClick={onUpdate}
            >
              {t('plugins.update')}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              data-testid={`plugin-uninstall-${id}`}
              aria-label={t('plugins.uninstallLabel', { name })}
              disabled={busy || locked}
              onClick={onUninstall}
            >
              {t('plugins.uninstall')}
            </button>
          </>
        ) : (
          <>
            {busy ? (
              <span
                className="spinner"
                role="status"
                aria-label={t('plugins.working')}
                data-testid={`plugin-pending-${id}`}
              />
            ) : null}
            <button
              type="button"
              className="btn btn--primary"
              data-testid={`plugin-install-${id}`}
              aria-label={t('plugins.installLabel', { name })}
              disabled={busy}
              onClick={onInstall}
            >
              {t('plugins.install')}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
