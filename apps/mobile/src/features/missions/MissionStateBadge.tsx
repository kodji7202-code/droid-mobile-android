import { useTranslation } from 'react-i18next';
import { isKnownMissionState } from '@droidmobile/daemon-client';
import type { MissionStateValue } from '@droidmobile/daemon-client';

const TONE: Record<MissionStateValue, string> = {
  planning: 'badge--info',
  awaiting_input: 'badge--warning',
  initializing: 'badge--info',
  running: 'badge--success',
  paused: 'badge--warning',
  orchestrator_turn: 'badge--info',
  completed: 'badge--success',
};

/** Overall mission state; a value a newer daemon adds shows as a neutral "unknown". */
export function MissionStateBadge({ state }: { state: string }) {
  const { t } = useTranslation();
  const known = isKnownMissionState(state);
  return (
    <span
      className={`badge ${known ? TONE[state] : 'badge--neutral'}`}
      data-testid="mission-state-badge"
      data-state={known ? state : 'unknown'}
      title={t('missions.stateLabel')}
    >
      {t(`missions.state.${known ? state : 'unknown'}`)}
    </span>
  );
}
