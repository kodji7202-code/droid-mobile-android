import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Base test id; buttons are `${testId}-confirm` / `${testId}-cancel`. */
  testId?: string;
}

/** Modal confirmation dialog for destructive or consequential actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  testId = 'confirm-dialog',
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  if (!open) {
    return null;
  }

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className="dialog-backdrop" data-testid={`${testId}-backdrop`} onClick={onCancel}>
      <div
        className="dialog"
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={stopPropagation}
      >
        <h2 className="dialog__title">{title}</h2>
        <p className="dialog__message">{message}</p>
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
