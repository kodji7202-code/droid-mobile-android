import { useTranslation } from 'react-i18next';
import type { MissionWorker, ProgressLogEntry } from '@droidmobile/daemon-client';

const TONE = {
  running: 'badge--info',
  completed: 'badge--success',
  failed: 'badge--danger',
} as const;

function formatTime(iso: string | undefined, language: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString(language);
}

/** Last heartbeat or progress timestamp; a heartbeat only moves this text. */
export function LastActivity({ timestamp }: { timestamp: string | undefined }) {
  const { t, i18n } = useTranslation();
  const text = formatTime(timestamp, i18n.language);
  return (
    <p className="mission-last-activity" data-testid="mission-last-activity">
      <span>{t('missions.lastActivity.label')}: </span>
      {text ? (
        <time dateTime={timestamp} data-testid="mission-last-activity-time">
          {text}
        </time>
      ) : (
        <span data-testid="mission-last-activity-none">{t('missions.lastActivity.none')}</span>
      )}
    </p>
  );
}

function WorkerCard({ worker }: { worker: MissionWorker }) {
  const { t } = useTranslation();
  return (
    <li className="mission-worker" data-testid={`mission-worker-${worker.sessionId}`}>
      <p className="mission-worker__id">{t('missions.workers.worker', { id: worker.sessionId })}</p>
      <div className="mission-worker__meta">
        <span
          className={`badge ${TONE[worker.status]}`}
          data-testid={`mission-worker-status-${worker.sessionId}`}
          data-status={worker.status}
        >
          {t(`missions.workerStatus.${worker.status}`)}
        </span>
        {worker.status === 'failed' && worker.exitCode !== undefined ? (
          <span data-testid={`mission-worker-exit-${worker.sessionId}`}>
            {t('missions.workers.exitCode', { code: worker.exitCode })}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function LogEntry({ entry, index }: { entry: ProgressLogEntry; index: number }) {
  const { t, i18n } = useTranslation();
  const type = entry.type as string;
  const details = entry as {
    workerSessionId?: string;
    featureId?: string;
    milestone?: string;
  };
  return (
    <li className="mission-log__entry" data-testid={`mission-log-${index}`}>
      <span className="mission-log__type">
        {t(`missions.logEntry.${type}`, { defaultValue: type.replaceAll('_', ' ') })}
      </span>
      <span className="mission-log__details">
        {details.workerSessionId
          ? t('missions.progress.worker', { id: details.workerSessionId })
          : null}
        {details.featureId ? ` ${t('missions.progress.feature', { id: details.featureId })}` : null}
        {details.milestone
          ? ` ${t('missions.progress.milestone', { name: details.milestone })}`
          : null}
      </span>
      <time className="mission-log__time" dateTime={entry.timestamp}>
        {formatTime(entry.timestamp, i18n.language)}
      </time>
    </li>
  );
}

export function WorkerList({ workers }: { workers: readonly MissionWorker[] }) {
  const { t } = useTranslation();
  if (workers.length === 0) {
    return (
      <p className="mission-panel__empty" data-testid="mission-workers-empty">
        {t('missions.workers.empty')}
      </p>
    );
  }
  return (
    <ul className="mission-worker-list" data-testid="mission-workers">
      {workers.map((worker) => (
        <WorkerCard key={worker.sessionId} worker={worker} />
      ))}
    </ul>
  );
}

export function ProgressLog({ entries }: { entries: readonly ProgressLogEntry[] }) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return (
      <p className="mission-panel__empty" data-testid="mission-log-empty">
        {t('missions.progress.empty')}
      </p>
    );
  }
  return (
    <ol className="mission-log" data-testid="mission-progress-log">
      {entries.map((entry, index) => (
        <LogEntry key={`${index}:${entry.timestamp}`} entry={entry} index={index} />
      ))}
    </ol>
  );
}
