import type {
  EffortValue,
  InteractionModeValue,
  ModelSummary,
  SettingsPatch,
} from '@droidmobile/daemon-client';

/** Enum order of the daemon's reasoning efforts. */
export const EFFORT_ORDER: readonly EffortValue[] = [
  'none',
  'dynamic',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** The modes the app offers; the daemon's deprecated `agi` is shown as Mission. */
export const MODE_OPTIONS: readonly InteractionModeValue[] = ['auto', 'spec', 'mission'];

export function displayMode(mode: InteractionModeValue | undefined): InteractionModeValue {
  if (mode === 'agi') return 'mission';
  return mode ?? 'auto';
}

export function findModel(
  models: readonly ModelSummary[],
  id: string | undefined,
): ModelSummary | undefined {
  return id === undefined ? undefined : models.find((model) => model.id === id);
}

/** The efforts the model supports, in enum order; empty when the model is unknown. */
export function supportedEfforts(model: ModelSummary | undefined): EffortValue[] {
  if (!model) return [];
  return EFFORT_ORDER.filter((effort) => model.supportedReasoningEfforts.includes(effort));
}

/** Keeps the current effort when the model supports it, else the model default, else its first effort. */
export function validEffort(
  model: ModelSummary | undefined,
  current: EffortValue | undefined,
): EffortValue | undefined {
  const supported = supportedEfforts(model);
  if (current !== undefined && supported.includes(current)) return current;
  if (model && supported.includes(model.defaultReasoningEffort))
    return model.defaultReasoningEffort;
  return supported[0];
}

/** Case-insensitive match on display name or provider. */
export function filterModels(models: readonly ModelSummary[], query: string): ModelSummary[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...models];
  return models.filter(
    (model) =>
      model.displayName.toLowerCase().includes(needle) ||
      model.provider.toLowerCase().includes(needle),
  );
}

/**
 * Update for choosing a model: the effort is only sent when the model does not
 * support the current one, so a frame never carries an unsupported value.
 */
export function modelChange(
  model: ModelSummary,
  current: EffortValue | undefined,
  spec: boolean,
): SettingsPatch {
  const supported = supportedEfforts(model);
  const effort =
    current !== undefined && supported.includes(current) ? undefined : validEffort(model, current);
  if (spec) {
    return {
      specModeModelId: model.id,
      ...(effort ? { specModeReasoningEffort: effort } : {}),
    };
  }
  return { modelId: model.id, ...(effort ? { reasoningEffort: effort } : {}) };
}
