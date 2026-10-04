import { useEffect } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from './icons';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible dialog name; also rendered as the sheet heading. */
  title: string;
  children: ReactNode;
  /** Base test id; the backdrop is `${testId}-backdrop`, the close button `${testId}-close`. */
  testId?: string;
}

/**
 * Modal bottom sheet (the app's modal primitive for pickers and forms).
 * Closes on Escape, on backdrop click and via the close button.
 */
export function Sheet({ open, onClose, title, children, testId = 'sheet' }: SheetProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className="sheet-backdrop" data-testid={`${testId}-backdrop`} onClick={onClose}>
      <div
        className="sheet"
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={stopPropagation}
      >
        <header className="sheet__header">
          <h2 className="sheet__title">{title}</h2>
          <button
            type="button"
            className="btn btn--ghost sheet__close"
            data-testid={`${testId}-close`}
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="sheet__content">{children}</div>
      </div>
    </div>
  );
}
