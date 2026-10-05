import { useTranslation } from 'react-i18next';

export interface PullRequestStatusInfo {
  state: 'open' | 'none' | 'unavailable';
  url?: string;
  title?: string;
  number?: number;
  reason?: string;
}

export interface PullRequestChipProps {
  status: PullRequestStatusInfo | null | undefined;
}

export function PullRequestChip({ status }: PullRequestChipProps) {
  const { t } = useTranslation();

  if (!status) {
    return null;
  }

  if (status.state === 'open') {
    const numPart = status.number ? ` #${status.number}` : '';
    const label = status.title
      ? `${t('git.pr.open')}${numPart}: ${status.title}`
      : `${t('git.pr.open')}${numPart}`;
    return (
      <a
        href={status.url || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="chip chip--success pr-status-chip pr-status-chip--open"
        data-testid="pr-status-chip"
        title={status.url}
      >
        <span className="pr-status-chip__label">{label}</span>
      </a>
    );
  }

  if (status.state === 'none') {
    return (
      <span
        className="chip chip--neutral pr-status-chip pr-status-chip--none"
        data-testid="pr-status-chip"
      >
        <span className="pr-status-chip__label">{t('git.pr.none')}</span>
      </span>
    );
  }

  if (status.state === 'unavailable') {
    return (
      <span
        className="chip chip--warning pr-status-chip pr-status-chip--unavailable"
        data-testid="pr-status-chip"
        title={status.reason}
      >
        <span className="pr-status-chip__label">{t('git.pr.unavailable')}</span>
      </span>
    );
  }

  return null;
}
