import { useTranslation } from 'react-i18next';
import type { AutonomyValue, InteractionModeValue } from '@droidmobile/daemon-client';
import { MODE_OPTIONS } from '../../session/settingsLogic';

export const AUTONOMY_LEVELS: readonly AutonomyValue[] = ['off', 'low', 'medium', 'high'];

interface ModeAutonomyFieldsProps {
  mode: InteractionModeValue;
  onModeChange(mode: InteractionModeValue): void;
  /** The level in effect: the user's pick, else the daemon default, else empty (daemon decides). */
  autonomy: AutonomyValue | '';
  onAutonomyChange(level: AutonomyValue): void;
}

/** Interaction mode and autonomy controls of the new-session sheet. */
export function ModeAutonomyFields({
  mode,
  onModeChange,
  autonomy,
  onAutonomyChange,
}: ModeAutonomyFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <fieldset className="new-session__modes" data-testid="session-new-mode">
        <legend className="field__label">{t('sessions.newMode.label')}</legend>
        {MODE_OPTIONS.map((option) => (
          <label key={option} className="new-session__mode" htmlFor={`session-new-mode-${option}`}>
            <input
              id={`session-new-mode-${option}`}
              type="radio"
              name="session-new-mode"
              value={option}
              data-testid={`session-new-mode-${option}`}
              checked={mode === option}
              onChange={() => onModeChange(option)}
            />
            <span>
              <span className="new-session__mode-title">
                {t(`session.settings.modeOption.${option}`)}
              </span>
              <span className="field__description" data-testid={`session-new-mode-${option}-desc`}>
                {t(`sessions.newMode.description.${option}`)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === 'mission' ? (
        <p className="field__description" role="note" data-testid="session-new-mission-hint">
          {t('sessions.newMode.missionHint')}
        </p>
      ) : null}
      <label className="field">
        <span className="field__label">{t('session.settings.autonomy')}</span>
        <select
          className="field__control"
          data-testid="session-new-autonomy"
          value={autonomy}
          onChange={(event) => onAutonomyChange(event.target.value as AutonomyValue)}
        >
          {autonomy === '' ? (
            <option value="">{t('sessions.newMode.autonomyDefault')}</option>
          ) : null}
          {AUTONOMY_LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(`session.settings.autonomyLevel.${level}`)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
