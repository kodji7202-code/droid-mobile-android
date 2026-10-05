import { useTranslation } from 'react-i18next';
import type {
  AutonomyValue,
  EffortValue,
  InteractionModeValue,
  ModelSummary,
  SessionHandle,
} from '@droidmobile/daemon-client';
import { Sheet } from '../../components/Sheet';
import { useConnectionStore } from '../../stores/connection';
import { ModelPicker } from './ModelPicker';
import {
  MODE_OPTIONS,
  displayMode,
  findModel,
  modelChange,
  supportedEfforts,
} from './settingsLogic';
import { useApplySettings, useModels, useSettingsSnapshot } from './useSessionSettings';

const FOLLOW_INTERVAL_MS = 1000;
const DEFAULT_AUTONOMY: readonly AutonomyValue[] = ['off', 'low', 'medium', 'high'];

interface SessionSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  handle: SessionHandle | undefined;
}

interface ReasoningSelectProps {
  testId: string;
  label: string;
  model: ModelSummary | undefined;
  value: EffortValue | undefined;
  disabled: boolean;
  onChange: (effort: EffortValue) => void;
}

function ReasoningSelect({
  testId,
  label,
  model,
  value,
  disabled,
  onChange,
}: ReasoningSelectProps) {
  const { t } = useTranslation();
  const options = supportedEfforts(model);
  const selected = value !== undefined && options.includes(value) ? value : '';
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select
        className="field__control"
        data-testid={testId}
        value={selected}
        disabled={disabled || options.length === 0}
        onChange={(event) => onChange(event.target.value as EffortValue)}
      >
        {selected === '' ? <option value="">{t('session.settings.notSet')}</option> : null}
        {options.map((effort) => (
          <option key={effort} value={effort}>
            {t(`session.settings.effort.${effort}`)}
            {model?.defaultReasoningEffort === effort ? ` (${t('session.settings.default')})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SessionSettingsSheet({ open, onClose, handle }: SessionSettingsSheetProps) {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const { snapshot, refresh } = useSettingsSnapshot(handle, FOLLOW_INTERVAL_MS);
  const { state: models, reload } = useModels(connection, open);
  const { pending, failed, apply } = useApplySettings(handle, refresh);

  const modelList = models.status === 'ready' ? models.models : [];
  const modelId = pending.modelId ?? snapshot?.modelId;
  const effort = pending.reasoningEffort ?? snapshot?.reasoningEffort;
  const mode = displayMode(pending.interactionMode ?? snapshot?.interactionMode);
  const autonomy = pending.autonomyLevel ?? snapshot?.autonomyLevel;
  const levels = snapshot?.availableAutonomyLevels ?? DEFAULT_AUTONOMY;
  const specModelId = pending.specModeModelId ?? snapshot?.specModeModelId;
  const specEffort = pending.specModeReasoningEffort ?? snapshot?.specModeReasoningEffort;
  const saving = Object.keys(pending).length > 0;
  const unavailable = !handle || !snapshot;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('session.settings.title')}
      testId="session-settings"
    >
      <div className="session-settings">
        {saving ? (
          <p role="status" data-testid="session-settings-saving">
            {t('session.settings.saving')}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="session-settings__error" data-testid="session-settings-error">
            {t('session.settings.failed')}
          </p>
        ) : null}

        <ModelPicker
          testId="session-model-select"
          label={t('session.settings.model')}
          value={modelId}
          models={models}
          onRetry={reload}
          disabled={unavailable}
          onSelect={(model) => void apply(modelChange(model, effort, false))}
        />

        <ReasoningSelect
          testId="session-reasoning-select"
          label={t('session.settings.reasoning')}
          model={findModel(modelList, modelId)}
          value={effort}
          disabled={unavailable}
          onChange={(next) => void apply({ reasoningEffort: next })}
        />

        <label className="field">
          <span className="field__label">{t('session.settings.autonomy')}</span>
          <select
            className="field__control"
            data-testid="session-autonomy-select"
            value={autonomy ?? ''}
            disabled={unavailable}
            onChange={(event) => void apply({ autonomyLevel: event.target.value as AutonomyValue })}
          >
            {autonomy === undefined ? (
              <option value="">{t('session.settings.notSet')}</option>
            ) : null}
            {levels.map((level) => (
              <option key={level} value={level}>
                {t(`session.settings.autonomyLevel.${level}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">{t('session.settings.mode')}</span>
          <select
            className="field__control"
            data-testid="session-mode-select"
            value={mode}
            disabled={unavailable}
            onChange={(event) =>
              void apply({ interactionMode: event.target.value as InteractionModeValue })
            }
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(`session.settings.modeOption.${option}`)}
              </option>
            ))}
          </select>
        </label>

        {mode === 'spec' ? (
          <>
            <ModelPicker
              testId="session-spec-model-select"
              label={t('session.settings.specModel')}
              value={specModelId}
              models={models}
              onRetry={reload}
              disabled={unavailable}
              onSelect={(model) => void apply(modelChange(model, specEffort, true))}
            />
            <ReasoningSelect
              testId="session-spec-reasoning-select"
              label={t('session.settings.specReasoning')}
              model={findModel(modelList, specModelId ?? modelId)}
              value={specEffort}
              disabled={unavailable}
              onChange={(next) => void apply({ specModeReasoningEffort: next })}
            />
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
