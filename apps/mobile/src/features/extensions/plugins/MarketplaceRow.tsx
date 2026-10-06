import { useTranslation } from 'react-i18next';
import type { Marketplace } from '@droidmobile/daemon-client';

interface MarketplaceRowProps {
  marketplace: Marketplace;
  busy: boolean;
  onUpdate: () => void;
  onRemove: () => void;
}

export function MarketplaceRow({ marketplace, busy, onUpdate, onRemove }: MarketplaceRowProps) {
  const { t } = useTranslation();
  const { name } = marketplace;
  const removable = marketplace.removable !== false;
  return (
    <li className="mcp-row" data-testid={`marketplace-row-${name}`}>
      <div className="mcp-row__main">
        <span className="mcp-row__text">
          <span className="mcp-row__name" data-testid={`marketplace-name-${name}`}>
            {name}
          </span>
          <span className="mcp-row__meta">
            <span className="chip" data-testid={`marketplace-source-${name}`}>
              {marketplace.sourceLocation ?? t(`marketplaces.sourceKind.${marketplace.sourceKind}`)}
            </span>
            {marketplace.pluginCount !== undefined ? (
              <span className="mcp-row__tools" data-testid={`marketplace-count-${name}`}>
                {t('marketplaces.pluginCount', { count: marketplace.pluginCount })}
              </span>
            ) : null}
            {marketplace.autoUpdate ? (
              <span className="chip" data-testid={`marketplace-auto-${name}`}>
                {t('marketplaces.autoUpdate')}
              </span>
            ) : null}
          </span>
        </span>
      </div>
      <div className="mcp-row__actions">
        {busy ? (
          <span
            className="spinner"
            role="status"
            aria-label={t('marketplaces.working')}
            data-testid={`marketplace-pending-${name}`}
          />
        ) : null}
        <button
          type="button"
          className="btn btn--secondary"
          data-testid={`marketplace-update-${name}`}
          aria-label={t('marketplaces.updateLabel', { name })}
          disabled={busy}
          onClick={onUpdate}
        >
          {busy ? t('marketplaces.updating') : t('marketplaces.update')}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          data-testid={`marketplace-remove-${name}`}
          aria-label={t('marketplaces.removeLabel', { name })}
          disabled={busy || !removable}
          onClick={onRemove}
        >
          {t('marketplaces.remove')}
        </button>
      </div>
    </li>
  );
}
