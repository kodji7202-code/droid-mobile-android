import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from '../../../components/icons';

interface ActionMessageProps {
  kind: 'error' | 'success';
  testId: string;
  /** Short sentence about what happened. */
  children: ReactNode;
  /** The daemon's own text, shown below the sentence when present. */
  detail?: string;
  onDismiss: () => void;
}

/** Inline result of an action that stays until dismissed, so long daemon text can be read. */
export function ActionMessage({ kind, testId, children, detail, onDismiss }: ActionMessageProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`action-message action-message--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      data-testid={testId}
    >
      <div className="action-message__text">
        <span>{children}</span>
        {detail ? (
          <span className="action-message__detail" data-testid={`${testId}-detail`}>
            {detail}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="btn btn--ghost"
        data-testid={`${testId}-dismiss`}
        aria-label={t('common.dismiss')}
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
