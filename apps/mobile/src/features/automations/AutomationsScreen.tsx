import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon } from '../../components/icons';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useConnectionStore } from '../../stores/connection';
import { ExtensionsSubHeader } from '../extensions/ExtensionsSubHeader';
import { AutomationStatusBadge } from './AutomationStatusBadge';
import { ScheduleText } from './ScheduleText';
import { useAutomations } from './useAutomations';

/** Automations: the daemon's scheduled automations with schedule and state. */
export function AutomationsScreen() {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const { status, automations, retry } = useAutomations(connection);

  return (
    <section
      className="screen"
      data-testid="automations-screen"
      aria-label={t('automations.title')}
    >
      <ExtensionsSubHeader title={t('automations.title')} backTo="/extensions" />
      <p className="field__description">{t('automations.description')}</p>
      {status === 'loading' ? (
        <div role="status" data-testid="automations-loading" aria-label={t('automations.loading')}>
          <Skeleton />
        </div>
      ) : null}
      {status === 'error' ? (
        <div data-testid="automations-error">
          <ErrorState
            title={t('automations.loadFailedTitle')}
            message={t('automations.loadFailed')}
            onRetry={retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {status === 'ready' || (status === 'error' && automations.length > 0) ? (
        <div data-testid="automations-list" aria-label={t('automations.title')} role="region">
          {status === 'ready' && automations.length === 0 ? (
            <div data-testid="automations-empty">
              <EmptyState
                title={t('automations.empty.title')}
                message={t('automations.empty.message')}
              />
            </div>
          ) : null}
          {automations.length > 0 ? (
            <ul className="mcp-list">
              {automations.map((automation) => (
                <li
                  key={automation.id}
                  className="mcp-row"
                  data-testid={`automation-row-${automation.id}`}
                >
                  <Link
                    to={`/extensions/automations/${encodeURIComponent(automation.id)}`}
                    className="mcp-row__main"
                    data-testid={`automation-open-${automation.id}`}
                  >
                    <span className="mcp-row__text">
                      <span
                        className="mcp-row__name"
                        data-testid={`automation-name-${automation.id}`}
                      >
                        {automation.name}
                      </span>
                      <span
                        className="field__description"
                        data-testid={`automation-schedule-${automation.id}`}
                      >
                        <ScheduleText schedule={automation.schedule} />
                      </span>
                      <span className="mcp-row__meta">
                        <AutomationStatusBadge
                          status={automation.status}
                          testId={`automation-status-${automation.id}`}
                        />
                      </span>
                    </span>
                    <ChevronRightIcon className="settings-row__chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
