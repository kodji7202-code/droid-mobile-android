import { useTranslation } from 'react-i18next';
import { scheduleLabel } from './automationLogic';

/** Human-readable schedule: Daily/Weekly/Monthly, the cron expression for a custom one, a placeholder when absent. */
export function ScheduleText({ schedule }: { schedule: string | undefined }) {
  const { t } = useTranslation();
  const label = scheduleLabel(schedule);
  if (label.kind === 'named') return <>{t(label.labelKey)}</>;
  if (label.kind === 'cron')
    return <>{t('automations.schedule.cron', { cron: label.expression })}</>;
  return <>{t('automations.schedule.none')}</>;
}
