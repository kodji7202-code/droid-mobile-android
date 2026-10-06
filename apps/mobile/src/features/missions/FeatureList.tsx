import { useTranslation } from 'react-i18next';
import { groupFeatures } from '@droidmobile/daemon-client';
import type { MissionFeature } from '@droidmobile/daemon-client';

const STATUS: Record<string, { icon: string; tone: string }> = {
  pending: { icon: '○', tone: 'badge--neutral' },
  in_progress: { icon: '◐', tone: 'badge--info' },
  completed: { icon: '✓', tone: 'badge--success' },
  cancelled: { icon: '✕', tone: 'badge--danger' },
};

function FeatureRow({ feature }: { feature: MissionFeature }) {
  const { t } = useTranslation();
  const known = feature.status in STATUS;
  const status = known ? STATUS[feature.status] : { icon: '?', tone: 'badge--neutral' };
  return (
    <li className="mission-feature" data-testid={`mission-feature-${feature.id}`}>
      <p className="mission-feature__description">{feature.description}</p>
      <div className="mission-feature__meta">
        <span
          className={`badge ${status.tone}`}
          data-testid={`mission-fstatus-${feature.id}`}
          data-status={feature.status}
        >
          <span aria-hidden="true">{status.icon}</span>&nbsp;
          {t(`missions.featureStatus.${known ? feature.status : 'unknown'}`)}
        </span>
        {feature.milestone ? (
          <span className="chip" data-testid={`mission-fmilestone-${feature.id}`}>
            {t('missions.features.milestone', { name: feature.milestone })}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** Features grouped by milestone, each group with its completed-of-total progress. */
export function FeatureList({ features }: { features: readonly MissionFeature[] }) {
  const { t } = useTranslation();
  if (features.length === 0) {
    return (
      <p className="mission-panel__empty" data-testid="mission-features-empty">
        {t('missions.features.empty')}
      </p>
    );
  }
  return (
    <div className="mission-groups" data-testid="mission-groups">
      {groupFeatures(features).map((group) => {
        const key = group.milestone ?? 'ungrouped';
        const name = group.milestone ?? t('missions.milestones.ungrouped');
        return (
          <section
            key={key}
            className="mission-group"
            data-testid={`mission-group-${key}`}
            aria-label={name}
          >
            <header className="mission-group__header">
              <h4 className="mission-group__title">{name}</h4>
              <span
                className="mission-group__progress"
                data-testid={`mission-group-progress-${key}`}
              >
                {t('missions.milestones.progress', {
                  completed: group.completed,
                  total: group.total,
                })}
              </span>
            </header>
            <progress
              className="mission-group__bar"
              value={group.completed}
              max={group.total}
              aria-label={t('missions.milestones.progress', {
                completed: group.completed,
                total: group.total,
              })}
            />
            <ul className="mission-feature-list">
              {group.features.map((feature) => (
                <FeatureRow key={feature.id} feature={feature} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
