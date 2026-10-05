import { describe, expect, it } from 'vitest';
import type { EffortValue, ModelSummary } from '@droidmobile/daemon-client';
import {
  displayMode,
  filterModels,
  modelChange,
  supportedEfforts,
  validEffort,
} from './settingsLogic';

function model(
  id: string,
  provider: string,
  efforts: EffortValue[],
  defaultEffort: EffortValue,
): ModelSummary {
  return {
    id,
    displayName: id.toUpperCase(),
    provider,
    supportedReasoningEfforts: efforts,
    defaultReasoningEffort: defaultEffort,
  };
}

const gpt = model('gpt-5', 'openai', ['high', 'low', 'medium'], 'medium');
const claude = model('claude-x', 'anthropic', ['off', 'max'], 'off');

describe('settingsLogic', () => {
  it('orders supported efforts by enum order', () => {
    expect(supportedEfforts(gpt)).toEqual(['low', 'medium', 'high']);
    expect(supportedEfforts(undefined)).toEqual([]);
  });

  it('keeps a supported effort and otherwise falls back to the default', () => {
    expect(validEffort(gpt, 'high')).toBe('high');
    expect(validEffort(claude, 'high')).toBe('off');
    expect(validEffort(undefined, 'high')).toBeUndefined();
  });

  it('filters by display name or provider, case-insensitively', () => {
    expect(filterModels([gpt, claude], 'GPT')).toEqual([gpt]);
    expect(filterModels([gpt, claude], 'anthropic')).toEqual([claude]);
    expect(filterModels([gpt, claude], 'zzzz-none')).toEqual([]);
    expect(filterModels([gpt, claude], '  ')).toEqual([gpt, claude]);
  });

  it('sends an effort with a model change only when the current one is unsupported', () => {
    expect(modelChange(gpt, 'low', false)).toEqual({ modelId: 'gpt-5' });
    expect(modelChange(claude, 'high', false)).toEqual({
      modelId: 'claude-x',
      reasoningEffort: 'off',
    });
    expect(modelChange(claude, 'high', true)).toEqual({
      specModeModelId: 'claude-x',
      specModeReasoningEffort: 'off',
    });
  });

  it('shows the deprecated agi mode as mission and a missing mode as normal', () => {
    expect(displayMode('agi')).toBe('mission');
    expect(displayMode(undefined)).toBe('auto');
    expect(displayMode('spec')).toBe('spec');
  });
});
