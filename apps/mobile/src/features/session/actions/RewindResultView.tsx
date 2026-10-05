import { useTranslation } from 'react-i18next';
import type { RewindResult } from '@droidmobile/daemon-client';

/** Outcome of a rewind; a failure message appears only when the daemon reports failed files. */
export function RewindResultView({ result }: { result: RewindResult }) {
  const { t } = useTranslation();
  const partial = result.failedRestoreCount > 0 || result.failedDeleteCount > 0;
  return (
    <div className="field" data-testid="session-rewind-result">
      <p role="status" data-testid="session-rewind-restored" data-count={result.restoredCount}>
        {t('session.actions.rewind.restored', { count: result.restoredCount })}
      </p>
      <p role="status" data-testid="session-rewind-deleted" data-count={result.deletedCount}>
        {t('session.actions.rewind.deleted', { count: result.deletedCount })}
      </p>
      {partial ? (
        <p role="alert" className="field__error" data-testid="session-rewind-failure">
          {t('session.actions.rewind.partialFailure', {
            restore: result.failedRestoreCount,
            delete: result.failedDeleteCount,
          })}
        </p>
      ) : null}
    </div>
  );
}
