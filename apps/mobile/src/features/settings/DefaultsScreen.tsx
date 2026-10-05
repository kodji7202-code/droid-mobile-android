import { useTranslation } from 'react-i18next';
import type {
  AutonomyValue,
  DefaultSettings,
  DefaultsPatch,
  EffortValue,
  InteractionModeValue,
} from '@droidmobile/daemon-client';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useConnectionStore } from '../../stores/connection';
import { ModelPicker } from '../session/ModelPicker';
import {
  EFFORT_ORDER,
  MODE_OPTIONS,
  displayMode,
  findModel,
  modelChange,
  supportedEfforts,
} from '../session/settingsLogic';
import { useModels } from '../session/useSessionSettings';
import type { ModelsState } from '../session/useSessionSettings';
import { SettingsSubHeader } from './SettingsSubHeader';
import { useDaemonDefaults } from './useDaemonDefaults';
import type { DefaultsField } from './useDaemonDefaults';

const ALL_AUTONOMY: readonly AutonomyValue[] = ['off', 'low', 'medium', 'high'];

function withCurrent<T extends string>(options: readonly T[], current: T | undefined): T[] {
  return current !== undefined && !options.includes(current) ? [...options, current] : [...options];
}

function isLocked(defaults: DefaultSettings, field: DefaultsField): boolean {
  return defaults.management?.[field]?.disabled === true;
}

interface DefaultsSelectProps {
  testId: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}

function DefaultsSelect({
  testId,
  label,
  value,
  options,
  disabled,
  onChange,
}: DefaultsSelectProps) {
  const { t } = useTranslation();
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select
        className="field__control"
        data-testid={testId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {value === '' ? <option value="">{t('session.settings.notSet')}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface DefaultsFormProps {
  defaults: DefaultSettings;
  pending: DefaultsPatch;
  models: ModelsState;
  reloadModels: () => void;
  apply: (patch: DefaultsPatch) => Promise<void>;
}

function DefaultsForm({ defaults, pending, models, reloadModels, apply }: DefaultsFormProps) {
  const { t } = useTranslation();
  const modelId = pending.modelId ?? defaults.modelId;
  const effort = (pending.reasoningEffort ?? defaults.reasoningEffort) as EffortValue | undefined;
  const autonomy = (pending.autonomyLevel ?? defaults.autonomyLevel) as AutonomyValue | undefined;
  const mode = displayMode(
    (pending.interactionMode ?? defaults.interactionMode) as InteractionModeValue | undefined,
  );
  const model = findModel(models.status === 'ready' ? models.models : [], modelId);
  const efforts = model ? supportedEfforts(model) : [...EFFORT_ORDER];
  const levels = (defaults.availableAutonomyLevels as AutonomyValue[] | undefined) ?? [
    ...ALL_AUTONOMY,
  ];

  return (
    <>
      <ModelPicker
        testId="defaults-model-select"
        label={t('session.settings.model')}
        value={modelId}
        models={models}
        onRetry={reloadModels}
        disabled={isLocked(defaults, 'modelId')}
        emptyLabel={t('defaults.daemonDefault')}
        onSelect={(next) => void apply(modelChange(next, effort, false))}
      />
      <DefaultsSelect
        testId="defaults-reasoning-select"
        label={t('session.settings.reasoning')}
        value={effort ?? ''}
        options={withCurrent(efforts, effort).map((value) => ({
          value,
          label: t(`session.settings.effort.${value}`),
        }))}
        disabled={isLocked(defaults, 'reasoningEffort')}
        onChange={(value) => void apply({ reasoningEffort: value as EffortValue })}
      />
      <DefaultsSelect
        testId="defaults-autonomy-select"
        label={t('session.settings.autonomy')}
        value={autonomy ?? ''}
        options={withCurrent(levels, autonomy).map((value) => ({
          value,
          label: t(`session.settings.autonomyLevel.${value}`),
        }))}
        disabled={isLocked(defaults, 'autonomyLevel')}
        onChange={(value) => void apply({ autonomyLevel: value as AutonomyValue })}
      />
      <DefaultsSelect
        testId="defaults-mode-select"
        label={t('session.settings.mode')}
        value={mode}
        options={MODE_OPTIONS.map((value) => ({
          value,
          label: t(`session.settings.modeOption.${value}`),
        }))}
        disabled={isLocked(defaults, 'interactionMode')}
        onChange={(value) => void apply({ interactionMode: value as InteractionModeValue })}
      />
    </>
  );
}

/**
 * Settings > Defaults: the daemon-wide defaults new sessions start with
 * (model, reasoning effort, autonomy, interaction mode). Values are the
 * daemon's; a save is only reflected once the daemon holds it.
 */
export function DefaultsScreen() {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const { state, pending, failed, apply, retry } = useDaemonDefaults(connection);
  const { state: models, reload } = useModels(connection, true);

  return (
    <section className="screen" data-testid="defaults-screen" aria-label={t('settings.defaults')}>
      <SettingsSubHeader title={t('settings.defaults')} />
      {state.status === 'loading' ? (
        <div role="status" data-testid="defaults-loading" aria-label={t('defaults.loading')}>
          <Skeleton />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div data-testid="defaults-error">
          <ErrorState
            title={t('defaults.loadFailedTitle')}
            message={t('defaults.loadFailed')}
            onRetry={retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className="session-settings">
          <p className="field__description">{t('defaults.description')}</p>
          {Object.keys(pending).length > 0 ? (
            <p role="status" data-testid="defaults-saving">
              {t('session.settings.saving')}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="session-settings__error" data-testid="defaults-save-error">
              {t('defaults.saveFailed')}
            </p>
          ) : null}
          <DefaultsForm
            defaults={state.defaults}
            pending={pending}
            models={models}
            reloadModels={reload}
            apply={apply}
          />
        </div>
      ) : null}
    </section>
  );
}
