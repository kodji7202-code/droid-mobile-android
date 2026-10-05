import { useTranslation } from 'react-i18next';
import { MoreIcon } from '../../../components/icons';

export type SessionAction = 'fork' | 'compact' | 'rewind';

interface SessionActionsMenuProps {
  open: boolean;
  disabled: boolean;
  onToggle(): void;
  onSelect(action: SessionAction): void;
}

const ACTIONS: SessionAction[] = ['fork', 'compact', 'rewind'];

export function SessionActionsMenu({
  open,
  disabled,
  onToggle,
  onSelect,
}: SessionActionsMenuProps) {
  const { t } = useTranslation();
  return (
    <div className="session-actions">
      <button
        type="button"
        className="btn btn--ghost"
        data-testid="session-actions-open"
        aria-label={t('session.actions.open')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="session-actions__menu" role="menu" data-testid="session-actions-menu">
          {ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              className="btn btn--ghost session-actions__item"
              data-testid={`session-action-${action}`}
              onClick={() => onSelect(action)}
            >
              {t(`session.actions.${action}.menu`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
