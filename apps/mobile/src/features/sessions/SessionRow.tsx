import { useTranslation } from 'react-i18next';
import { MoreIcon } from '../../components/icons';
import { formatModified } from './sessionsPaging';
import type { SessionRowData } from './sessionsPaging';

interface SessionRowProps {
  row: SessionRowData;
  now: number;
  menuOpen: boolean;
  onToggleMenu(id: string): void;
  onRename(row: SessionRowData): void;
  onArchive(row: SessionRowData): void;
}

export function SessionRow({
  row,
  now,
  menuOpen,
  onToggleMenu,
  onRename,
  onArchive,
}: SessionRowProps) {
  const { t, i18n } = useTranslation();
  const title = row.title === '' ? t('sessions.untitled') : row.title;

  return (
    <li className="session-row" data-testid={`session-item-${row.id}`}>
      <div className="session-row__main">
        <p className="session-row__title" data-testid={`session-title-${row.id}`}>
          {title}
        </p>
        <p className="session-row__meta">
          <span data-testid={`session-modified-${row.id}`}>
            {formatModified(row.modifiedMs, now, i18n.language)}
          </span>
          <span aria-hidden="true"> · </span>
          <span data-testid={`session-count-${row.id}`}>
            {t('sessions.messages', { count: row.messageCount })}
          </span>
        </p>
      </div>
      <button
        type="button"
        className="btn btn--ghost session-row__more"
        data-testid={`session-more-${row.id}`}
        aria-label={t('sessions.actionsFor', { title })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => onToggleMenu(row.id)}
      >
        <MoreIcon />
      </button>
      {menuOpen ? (
        <div className="session-row__menu" role="menu" data-testid={`session-menu-${row.id}`}>
          <button
            type="button"
            role="menuitem"
            className="btn btn--ghost session-row__action"
            data-testid={`session-rename-${row.id}`}
            onClick={() => onRename(row)}
          >
            {t('sessions.rename')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="btn btn--ghost session-row__action"
            data-testid={`session-archive-${row.id}`}
            onClick={() => onArchive(row)}
          >
            {t('sessions.archive')}
          </button>
        </div>
      ) : null}
    </li>
  );
}
