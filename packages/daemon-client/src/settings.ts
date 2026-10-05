/**
 * Session-settings vocabulary for the UI. The SDK models these as string
 * enums; the UI works with the equivalent string literals so it never imports
 * the SDK, and this module is the single place that converts back.
 */
import type {
  AutonomyLevel,
  DroidInteractionMode,
  ModelInfo,
  ReasoningEffort,
  SessionSettings,
  UpdateSessionSettingsOptions,
} from '@factory/droid-sdk';

export type EffortValue = `${ReasoningEffort}`;
export type AutonomyValue = `${AutonomyLevel}`;
export type InteractionModeValue = `${DroidInteractionMode}`;

/** The settings the session sheet reads and writes. */
export interface SessionSettingsSnapshot {
  modelId?: string;
  reasoningEffort?: EffortValue;
  autonomyLevel?: AutonomyValue;
  availableAutonomyLevels?: AutonomyValue[];
  interactionMode?: InteractionModeValue;
  specModeModelId?: string;
  specModeReasoningEffort?: EffortValue;
}

export type SettingsPatch = Pick<
  SessionSettingsSnapshot,
  | 'modelId'
  | 'reasoningEffort'
  | 'autonomyLevel'
  | 'interactionMode'
  | 'specModeModelId'
  | 'specModeReasoningEffort'
>;

/** The session defaults the app edits through settings.updateDefaults. */
export type DefaultsPatch = Pick<
  SettingsPatch,
  'modelId' | 'reasoningEffort' | 'autonomyLevel' | 'interactionMode'
>;

export interface ModelSummary {
  id: string;
  displayName: string;
  provider: string;
  supportedReasoningEfforts: EffortValue[];
  defaultReasoningEffort: EffortValue;
  /** Set when the daemon lists the model but refuses it (plan, region, ...). */
  disabledReason?: string;
}

export function snapshotOf(settings: Readonly<SessionSettings>): SessionSettingsSnapshot {
  return {
    modelId: settings.modelId,
    reasoningEffort: settings.reasoningEffort,
    autonomyLevel: settings.autonomyLevel,
    availableAutonomyLevels: settings.availableAutonomyLevels,
    interactionMode: settings.interactionMode,
    specModeModelId: settings.specModeModelId,
    specModeReasoningEffort: settings.specModeReasoningEffort,
  };
}

export function toModelSummary(model: ModelInfo): ModelSummary {
  return {
    id: model.id,
    displayName: model.displayName,
    provider: model.modelProvider,
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
    defaultReasoningEffort: model.defaultReasoningEffort,
    ...(model.disabled ? { disabledReason: model.disabledReason } : {}),
  };
}

/** String literals and the SDK's string enums share runtime values, so the cast is exact. */
export function toUpdateOptions(patch: SettingsPatch): UpdateSessionSettingsOptions {
  return patch as UpdateSessionSettingsOptions;
}
