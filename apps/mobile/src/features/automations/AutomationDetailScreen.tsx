import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Automation } from '@droidmobile/daemon-client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useConnectionStore } from '../../stores/connection';
import { ExtensionsSubHeader } from '../extensions/ExtensionsSubHeader';
import { AutomationStatusBadge, RunStatusBadge } from './AutomationStatusBadge';
import { ScheduleText } from './ScheduleText';
import { formatDateTime } from './automationLogic';
import { useAutomations } from './useAutomations';
import { useRunAutomation } from './useRunAutomation';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="automation-detail__field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Placeholder({ testId }: { testId?: string }) {
  const { t } = useTranslation();
  return (
    <span className="field__description" data-testid={testId}>
      {t('automations.detail.notAvailable')}
    </span>
  );
}

function DetailFields({ automation }: { automation: Automation }) {
  const { t, i18n } = useTranslation();
  const when = (iso: string) => formatDateTime(iso, i18n.language) ?? iso;
  const active = automation.status === 'active';
  const hasLastRun = automation.lastRunAt !== undefined || automation.lastRunStatus !== undefined;
  return (
    <dl className="automation-detail__fields" data-testid="automation-detail-fields">
      <Field label={t('automations.detail.name')}>
        <span data-testid="automation-detail-name">{automation.name}</span>
      </Field>
      <Field label={t('automations.detail.schedule')}>
        <span data-testid="automation-detail-schedule">
          <ScheduleText schedule={automation.schedule} />
        </span>
        {automation.schedule?.trim() ? (
          <span className="automation-detail__raw" data-testid="automation-detail-schedule-raw">
            {automation.schedule}
          </span>
        ) : null}
      </Field>
      <Field label={t('automations.detail.prompt')}>
        {automation.prompt?.trim() ? (
          <span className="automation-detail__text" data-testid="automation-detail-prompt">
            {automation.prompt}
          </span>
        ) : (
          <Placeholder testId="automation-detail-prompt" />
        )}
      </Field>
      <Field label={t('automations.detail.status')}>
        <AutomationStatusBadge status={automation.status} testId="automation-detail-status" />
      </Field>
      {active ? (
        <Field label={t('automations.detail.nextRun')}>
          {automation.nextRunAt ? (
            <span data-testid="automation-detail-next-run">{when(automation.nextRunAt)}</span>
          ) : (
            <Placeholder testId="automation-detail-next-run" />
          )}
        </Field>
      ) : null}
      {hasLastRun ? (
        <Field label={t('automations.detail.lastRun')}>
          <span className="automation-detail__last" data-testid="automation-detail-last-run">
            {automation.lastRunAt ? <span>{when(automation.lastRunAt)}</span> : null}
            {automation.lastRunStatus ? (
              <RunStatusBadge
                status={automation.lastRunStatus}
                testId="automation-detail-last-run-status"
              />
            ) : null}
          </span>
        </Field>
      ) : null}
    </dl>
  );
}

/** One automation: its fields, Run now, Pause/Resume and the link to its run history. */
export function AutomationDetailScreen() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const connection = useConnectionStore((state) => state.connection);
  const list = useAutomations(connection);
  const run = useRunAutomation(connection);
  const automation = list.automations.find((item) => item.id === id);
  const title = automation?.name ?? id;
  const starting = run.phase === 'starting';
  const changing = list.busy.has(id);
  const controlsEnabled = list.canAct && !starting && !changing;

  return (
    <section className="screen" data-testid="automation-detail" aria-label={title}>
      <ExtensionsSubHeader title={title} backTo="/extensions/automations" />
      {list.status === 'loading' ? (
        <div
          role="status"
          data-testid="automation-detail-loading"
          aria-label={t('automations.loading')}
        >
          <Skeleton />
        </div>
      ) : null}
      {list.status === 'error' ? (
        <div data-testid="automations-error">
          <ErrorState
            title={t('automations.loadFailedTitle')}
            message={t('automations.loadFailed')}
            onRetry={list.retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {list.status === 'ready' && !automation ? (
        <div data-testid="automation-detail-missing">
          <EmptyState
            title={t('automations.detail.missingTitle')}
            message={t('automations.detail.missing', { name: id })}
          />
        </div>
      ) : null}
      {automation && list.status !== 'loading' ? (
        <>
          <DetailFields automation={automation} />
          {!list.canAct ? (
            <p
              className="field__description"
              role="status"
              data-testid="automation-controls-offline"
            >
              {t('automations.controlsOffline')}
            </p>
          ) : null}
          {list.error ? (
            <p role="alert" className="field__error" data-testid="automation-action-error">
              {t(`automations.errors.${list.error.action}`, { name: title })}
              {list.error.detail ? ` ${list.error.detail}` : ''}
            </p>
          ) : null}
          {run.failed ? (
            <p role="alert" className="field__error" data-testid="automation-run-error">
              {t('automations.errors.run', { name: title })}
            </p>
          ) : null}
          {starting ? (
            <p className="field__description" role="status" data-testid="automation-run-starting">
              {t('automations.runStarting')}
            </p>
          ) : null}
          <div className="automation-detail__actions">
            <button
              type="button"
              className="btn btn--primary"
              data-testid="automation-run"
              disabled={!controlsEnabled}
              onClick={() => run.request(automation)}
            >
              {t('automations.run')}
            </button>
            {automation.status === 'active' ? (
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="automation-pause"
                disabled={!controlsEnabled}
                aria-busy={changing}
                onClick={() => void list.pause(automation.id)}
              >
                {t('automations.pause')}
              </button>
            ) : null}
            {automation.status === 'paused' ? (
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="automation-resume"
                disabled={!controlsEnabled}
                aria-busy={changing}
                onClick={() => void list.resume(automation.id)}
              >
                {t('automations.resume')}
              </button>
            ) : null}
            <Link
              to={`/extensions/automations/${encodeURIComponent(automation.id)}/history`}
              className="btn btn--secondary"
              data-testid="automation-history-open"
            >
              {t('automations.history.open')}
            </Link>
          </div>
        </>
      ) : null}
      <ConfirmDialog
        open={run.phase === 'confirming'}
        title={t('automations.runConfirm.title', { name: title })}
        message={t('automations.runConfirm.message')}
        confirmLabel={t('automations.run')}
        onConfirm={() => void run.confirm()}
        onCancel={run.cancel}
        testId="automation-run-confirm"
      />
    </section>
  );
}
