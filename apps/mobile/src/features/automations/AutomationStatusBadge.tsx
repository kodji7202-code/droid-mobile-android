import { useTranslation } from 'react-i18next';
import { runBadge, statusBadge } from './automationLogic';
import type { Badge } from './automationLogic';

interface BadgeViewProps {
  badge: Badge;
  testId: string;
  /** The daemon's raw value, kept as data so tests and tools see what was reported. */
  raw: string;
}

function BadgeView({ badge, testId, raw }: BadgeViewProps) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge--${badge.tone}`} data-testid={testId} data-status={raw}>
      {badge.labelKey === null ? badge.label : t(badge.labelKey)}
    </span>
  );
}

/** Automation state as text (never colour alone); an unknown value shows its raw text. */
export function AutomationStatusBadge({ status, testId }: { status: string; testId: string }) {
  return <BadgeView badge={statusBadge(status)} testId={testId} raw={status} />;
}

/** Status of one run, same rules as the automation badge. */
export function RunStatusBadge({ status, testId }: { status: string; testId: string }) {
  return <BadgeView badge={runBadge(status)} testId={testId} raw={status} />;
}
