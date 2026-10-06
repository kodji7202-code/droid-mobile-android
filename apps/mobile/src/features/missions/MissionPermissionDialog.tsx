import { useTranslation } from 'react-i18next';
import type { MissionPermission, PermissionDecision } from '@droidmobile/daemon-client';
import { MarkdownView } from '../../components/MarkdownView';

/**
 * `propose_mission` and `start_mission_run` requests. There is no "always approve":
 * a mission spends credits, so every request needs an explicit answer, and Deny
 * answers `cancel`. The daemon stays blocked until the user chooses.
 */
export function MissionPermissionDialog({
  mission,
  onDecide,
  onStop,
}: {
  mission: MissionPermission;
  onDecide(decision: PermissionDecision): void;
  onStop(): void;
}) {
  const { t } = useTranslation();
  const title =
    mission.kind === 'propose_mission'
      ? t('missions.permission.proposeTitle')
      : t('missions.permission.startTitle');
  return (
    <div className="dialog-backdrop" data-testid="permission-backdrop">
      <div
        className="dialog interaction-dialog"
        data-testid="permission-dialog"
        data-mission-request={mission.kind}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="dialog__title">{title}</h2>
        <div className="interaction-dialog__scroll">
          {mission.kind === 'propose_mission' ? (
            <>
              <p>{t('missions.permission.proposeIntro')}</p>
              {mission.title ? (
                <p>
                  <span className="tool-card__label">{t('missions.permission.proposalTitle')}</span>{' '}
                  <strong data-testid="mission-permission-title">{mission.title}</strong>
                </p>
              ) : null}
              <p className="tool-card__label">{t('missions.permission.proposal')}</p>
              <div data-testid="mission-permission-proposal">
                <MarkdownView text={mission.proposal} />
              </div>
            </>
          ) : (
            <>
              <p>{t('missions.permission.startIntro')}</p>
              <p data-testid="mission-permission-running">
                {t('missions.permission.runningCount', { count: mission.runningMissionCount })}
              </p>
              {mission.runningMissionSessionIds.length > 0 ? (
                <>
                  <p className="tool-card__label">{t('missions.permission.runningSessions')}</p>
                  <ul data-testid="mission-permission-running-ids">
                    {mission.runningMissionSessionIds.map((id) => (
                      <li key={id}>{id}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </div>
        <div className="dialog__actions interaction-dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="chat-interrupt"
            onClick={onStop}
          >
            {t('chat.interrupt')}
          </button>{' '}
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="permission-deny"
            onClick={() => onDecide('deny')}
          >
            {t('chat.permission.deny')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="permission-approve-once"
            onClick={() => onDecide('once')}
          >
            {t('chat.permission.approveOnce')}
          </button>
        </div>
      </div>
    </div>
  );
}
