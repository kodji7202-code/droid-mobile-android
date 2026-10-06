import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type {
  AutomationHistory,
  AutomationRun,
  DaemonConnection,
} from '@droidmobile/daemon-client';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useConnectionStore } from '../../stores/connection';
import { ExtensionsSubHeader } from '../extensions/ExtensionsSubHeader';
import { useDaemonRead } from '../extensions/plugins/useDaemonRead';
import { RunStatusBadge } from './AutomationStatusBadge';
import { formatDateTime, formatDuration, sortRunsNewestFirst } from './automationLogic';

const HISTORY_LIMIT = 50;

function RunRow({ run }: { run: AutomationRun }) {
  const { t, i18n } = useTranslation();
  const started = formatDateTime(run.startedAt, i18n.language) ?? run.startedAt;
  const duration = formatDuration(run.durationMs, i18n.language);
  return (
    <li className="mcp-row automation-run" data-testid={`automation-run-${run.runId}`}>
      <span className="mcp-row__text">
        <span className="mcp-row__meta">
          <RunStatusBadge status={run.status} testId={`automation-run-status-${run.runId}`} />
          <span data-testid={`automation-run-started-${run.runId}`}>{started}</span>
        </span>
        <span className="field__description" data-testid={`automation-run-duration-${run.runId}`}>
          {t('automations.history.duration', {
            duration: duration ?? t('automations.detail.notAvailable'),
          })}
        </span>
        {run.errorMessage ? (
          <span className="mcp-row__error" data-testid={`automation-run-error-${run.runId}`}>
            {run.errorMessage}
          </span>
        ) : null}
        {run.sessionId ? (
          <Link
            to={`/sessions/${encodeURIComponent(run.sessionId)}`}
            className="btn btn--secondary automation-run__session"
            data-testid={`automation-run-session-${run.runId}`}
          >
            {t('automations.history.openSession')}
          </Link>
        ) : null}
      </span>
    </li>
  );
}

/** Presentational run list: newest first, with a localised empty state. */
export function RunHistoryList({ history }: { history: AutomationHistory }) {
  const { t } = useTranslation();
  if (history.runs.length === 0) {
    return (
      <div data-testid="automation-history-empty">
        <EmptyState
          title={t('automations.history.empty.title')}
          message={t('automations.history.empty.message')}
        />
      </div>
    );
  }
  return (
    <>
      <ul className="mcp-list" data-testid="automation-history-list">
        {sortRunsNewestFirst(history.runs).map((run) => (
          <RunRow key={run.runId} run={run} />
        ))}
      </ul>
      {history.totalCount > history.runs.length ? (
        <p className="field__description" data-testid="automation-history-partial">
          {t('automations.history.partial', {
            shown: history.runs.length,
            total: history.totalCount,
          })}
        </p>
      ) : null}
    </>
  );
}

/** Run history of one automation, read from the daemon each time the screen opens. */
export function AutomationHistoryScreen() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const connection = useConnectionStore((state) => state.connection);
  const load = useCallback(
    (daemon: DaemonConnection) => daemon.automations.history(id, HISTORY_LIMIT),
    [id],
  );
  const { state, retry } = useDaemonRead(connection, load);

  return (
    <section
      className="screen"
      data-testid="automation-history"
      aria-label={t('automations.history.title')}
    >
      <ExtensionsSubHeader
        title={t('automations.history.title')}
        backTo={`/extensions/automations/${encodeURIComponent(id)}`}
      />
      <p className="field__description" data-testid="automation-history-for">
        {id}
      </p>
      {state.status === 'loading' ? (
        <div
          role="status"
          data-testid="automation-history-loading"
          aria-label={t('automations.history.loading')}
        >
          <Skeleton />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div data-testid="automation-history-error">
          <ErrorState
            title={t('automations.history.loadFailedTitle')}
            message={t('automations.history.loadFailed')}
            onRetry={retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {state.status === 'ready' ? <RunHistoryList history={state.data} /> : null}
    </section>
  );
}
