import { useTranslation } from 'react-i18next';
import { useBackDismiss } from '../../components/backDismiss';
import type { PairLinkSummary } from './pairLink';

interface PairLinkDialogProps {
  summary: PairLinkSummary;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A pairing link can come from any app, so it only ever opens this dialog. It names the
 * daemon and whether the link carries a key, and never shows the key itself.
 */
export function PairLinkDialog({ summary, onConfirm, onCancel }: PairLinkDialogProps) {
  const { t } = useTranslation();
  useBackDismiss(true, onCancel);

  return (
    <div className="dialog-backdrop" data-testid="pair-link-backdrop">
      <div
        className="dialog"
        data-testid="pair-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-link-title"
      >
        <h2 className="dialog__title" id="pair-link-title">
          {t('pairLink.title')}
        </h2>
        <p className="dialog__message">{t('pairLink.message')}</p>
        <dl className="about-list">
          <div className="about-row">
            <dt>{t('pairLink.daemon')}</dt>
            <dd data-testid="pair-link-host">{summary.host}</dd>
          </div>
          <div className="about-row">
            <dt>{t('pairLink.key')}</dt>
            <dd data-testid="pair-link-key" data-included={summary.hasKey}>
              {summary.hasKey ? t('pairLink.keyIncluded') : t('pairLink.keyMissing')}
            </dd>
          </div>
          {summary.bridgeHost !== null ? (
            <div className="about-row">
              <dt>{t('pairLink.bridge')}</dt>
              <dd data-testid="pair-link-bridge">{summary.bridgeHost}</dd>
            </div>
          ) : null}
        </dl>
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="pair-link-cancel"
            onClick={onCancel}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="pair-link-confirm"
            onClick={onConfirm}
          >
            {t('pairLink.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
