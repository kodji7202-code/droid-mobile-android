import { useTranslation } from 'react-i18next';
import type { RewindInfo } from '@droidmobile/daemon-client';
import { hasFileChanges } from './rewindLogic';

interface GroupProps {
  testId: string;
  title: string;
  empty: string;
  rows: { path: string; detail?: string }[];
}

function Group({ testId, title, empty, rows }: GroupProps) {
  return (
    <section className="context-usage__section" data-testid={testId} data-count={rows.length}>
      <h3 className="context-usage__heading">{title}</h3>
      {rows.length === 0 ? (
        <p className="context-usage__empty" data-testid={`${testId}-empty`}>
          {empty}
        </p>
      ) : (
        <ul className="context-usage__list">
          {rows.map((row) => (
            <li key={row.path} className="context-usage__row" data-testid={`${testId}-item`}>
              <span className="session-actions__path">{row.path}</span>
              {row.detail ? <span>{row.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Files a rewind would restore, delete, or can no longer restore. */
export function RewindInfoView({ info }: { info: RewindInfo }) {
  const { t } = useTranslation();
  const none = t('session.actions.rewind.none');
  return (
    <div data-testid="session-rewind-info">
      {hasFileChanges(info) ? null : (
        <p className="session-actions__hint" data-testid="session-rewind-no-changes">
          {t('session.actions.rewind.noFileChanges')}
        </p>
      )}
      <Group
        testId="session-rewind-restore"
        title={t('session.actions.rewind.restoreGroup')}
        empty={none}
        rows={info.availableFiles.map((file) => ({
          path: file.filePath,
          detail: formatSize(file.size),
        }))}
      />
      <Group
        testId="session-rewind-delete"
        title={t('session.actions.rewind.deleteGroup')}
        empty={none}
        rows={info.createdFiles.map((file) => ({ path: file.filePath }))}
      />
      <Group
        testId="session-rewind-evicted"
        title={t('session.actions.rewind.evictedGroup')}
        empty={none}
        rows={info.evictedFiles.map((file) => ({ path: file.filePath, detail: file.reason }))}
      />
    </div>
  );
}
