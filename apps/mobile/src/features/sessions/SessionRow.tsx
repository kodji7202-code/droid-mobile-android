import { useTranslation } from 'react-i18next';
import { MoreIcon } from '../../components/icons';
import { formatModified } from './sessionsPaging';
import type { SessionRowData } from './sessionsPaging';

interface SessionRowProps {
  row: SessionRowData;
  /** The session shown in the detail pane (tablet layout). */
  selected?: boolean;
  now: number;
  menuOpen: boolean;
  onOpen(row: SessionRowData): void;
  onToggleMenu(id: string): void;
  onRename(row: SessionRowData): void;
  onArchive(row: SessionRowData): void;
  onUnarchive(row: SessionRowData): void;
}

export function SessionRow({
  row,
  selected = false,
  now,
  menuOpen,
  onOpen,
  onToggleMenu,
  onRename,
  onArchive,
  onUnarchive,
}: SessionRowProps) {
  const { t, i18n } = useTranslation();
  const title = row.title === '' ? t('sessions.untitled') : row.title;

  return (
    <li
      className={`session-row${selected ? ' session-row--selected' : ''}`}
      data-testid={`session-item-${row.id}`}
    >
      <button
        type="button"
        className="session-row__main"
        aria-current={selected ? 'true' : undefined}
        data-testid={`session-open-${row.id}`}
        onClick={() => onOpen(row)}
      >
        <span className="session-row__title" data-testid={`session-title-${row.id}`}>
          {title}
        </span>
        <span className="session-row__meta">
          <span data-testid={`session-modified-${row.id}`}>
            {formatModified(row.modifiedMs, now, i18n.language)}
          </span>
          {row.messageCount !== undefined ? (
            <>
              <span aria-hidden="true"> · </span>
              <span data-testid={`session-count-${row.id}`}>
                {t('sessions.messages', { count: row.messageCount })}
              </span>
            </>
          ) : null}
        </span>
        {row.worktree ? (
          <span className="session-row__worktree">
            <span className="session-row__badge" data-testid={`session-worktree-badge-${row.id}`}>
              {t('sessions.worktreeBadge')}
            </span>{' '}
            <span data-testid={`session-worktree-branch-${row.id}`}>{row.worktree.branch}</span>
            <span className="session-row__path" data-testid={`session-worktree-path-${row.id}`}>
              {row.worktree.path}
            </span>
          </span>
        ) : null}
      </button>
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
            data-testid={row.archived ? `session-unarchive-${row.id}` : `session-archive-${row.id}`}
            onClick={() => (row.archived ? onUnarchive(row) : onArchive(row))}
          >
            {row.archived ? t('sessions.unarchive') : t('sessions.archive')}
          </button>
        </div>
      ) : null}
    </li>
  );
}
