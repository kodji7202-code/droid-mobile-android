import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DaemonConnection,
  DefaultSettings,
  DefaultsPatch,
  ModelSummary,
} from '@droidmobile/daemon-client';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';

const MODELS: ModelSummary[] = [
  {
    id: 'gpt-5',
    displayName: 'GPT-5',
    provider: 'openai',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'locked',
    displayName: 'Locked model',
    provider: 'anthropic',
    supportedReasoningEfforts: ['off'],
    defaultReasoningEffort: 'off',
    disabledReason: 'Needs a paid plan',
  },
];

function setup(initial: Partial<DefaultSettings>, overrides: Partial<DaemonConnection> = {}) {
  const state = { current: { ...initial } as DefaultSettings };
  const updateDefaultSettings = vi.fn(async (patch: DefaultsPatch) => {
    state.current = { ...state.current, ...patch } as DefaultSettings;
  });
  const connection = {
    getDefaultSettings: vi.fn(async () => state.current),
    updateDefaultSettings,
    listModels: vi.fn(async () => MODELS),
    ...overrides,
  } as unknown as DaemonConnection;
  useConnectionStore.setState({ status: 'ready' });
  renderAppAt('/settings/defaults', { connection });
  return { state, updateDefaultSettings, connection };
}

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });
});

const BASE: Partial<DefaultSettings> = {
  modelId: 'gpt-5',
  reasoningEffort: 'high' as DefaultSettings['reasoningEffort'],
  autonomyLevel: 'off' as DefaultSettings['autonomyLevel'],
  interactionMode: 'auto' as DefaultSettings['interactionMode'],
};

describe('DefaultsScreen', () => {
  it('shows a loading state while the defaults are pending', () => {
    setup(BASE, { getDefaultSettings: () => new Promise<DefaultSettings>(() => {}) });
    expect(screen.getByTestId('defaults-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('defaults-mode-select')).toBeNull();
  });

  it('shows the daemon values field by field', async () => {
    setup(BASE);
    expect(await screen.findByTestId('defaults-model-select')).toHaveTextContent('GPT-5');
    expect(screen.getByTestId('defaults-reasoning-select')).toHaveValue('high');
    expect(screen.getByTestId('defaults-autonomy-select')).toHaveValue('off');
    expect(screen.getByTestId('defaults-mode-select')).toHaveValue('auto');
    expect(screen.getByRole('option', { name: 'Normal' })).toBeInTheDocument();
  });

  it('reads "Daemon default" when the daemon has no model set', async () => {
    setup({ ...BASE, modelId: undefined });
    expect(await screen.findByTestId('defaults-model-select')).toHaveTextContent('Daemon default');
  });

  it('offers only SDK enum values', async () => {
    setup(BASE);
    const values = (testId: string) =>
      within(screen.getByTestId(testId))
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value);
    await screen.findByTestId('defaults-mode-select');
    expect(values('defaults-autonomy-select')).toEqual(['off', 'low', 'medium', 'high']);
    expect(values('defaults-mode-select')).toEqual(['auto', 'spec', 'mission']);
    expect(values('defaults-reasoning-select')).toEqual(['low', 'medium', 'high']);
  });

  it('saves a change through the daemon and shows the value the daemon holds', async () => {
    const { updateDefaultSettings } = setup(BASE);
    const select = await screen.findByTestId('defaults-autonomy-select');
    await userEvent.selectOptions(select, 'low');
    expect(updateDefaultSettings).toHaveBeenCalledWith({ autonomyLevel: 'low' });
    await waitFor(() => expect(screen.getByTestId('defaults-autonomy-select')).toHaveValue('low'));
    expect(screen.queryByTestId('defaults-save-error')).toBeNull();
  });

  it('shows a save error inline and keeps the previous value', async () => {
    setup(BASE, {
      updateDefaultSettings: vi.fn(async () => {
        throw new Error('rejected');
      }),
    });
    const select = await screen.findByTestId('defaults-autonomy-select');
    await userEvent.selectOptions(select, 'high');
    expect(await screen.findByTestId('defaults-save-error')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('defaults-autonomy-select')).toHaveValue('off'));
  });

  it('lists disabled models with their reason and does not let them be picked', async () => {
    const { updateDefaultSettings } = setup(BASE);
    await userEvent.click(await screen.findByTestId('defaults-model-select'));
    const option = await screen.findByTestId('defaults-model-select-option-locked');
    expect(option).toBeDisabled();
    expect(screen.getByTestId('defaults-model-select-reason-locked')).toHaveTextContent(
      'Needs a paid plan',
    );
    await userEvent.click(option);
    expect(updateDefaultSettings).not.toHaveBeenCalled();
  });

  it('does not allow editing a field the daemon marks as managed', async () => {
    setup({
      ...BASE,
      management: { autonomyLevel: { disabled: true, source: null } },
    } as Partial<DefaultSettings>);
    expect(await screen.findByTestId('defaults-autonomy-select')).toBeDisabled();
    expect(screen.getByTestId('defaults-mode-select')).toBeEnabled();
  });

  it('shows an error with Retry that recovers once the daemon answers', async () => {
    const getDefaultSettings = vi
      .fn<() => Promise<DefaultSettings>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(BASE as DefaultSettings);
    setup(BASE, { getDefaultSettings });
    expect(await screen.findByTestId('defaults-error')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('error-state-retry'));
    expect(await screen.findByTestId('defaults-mode-select')).toBeInTheDocument();
    expect(screen.queryByTestId('defaults-error')).toBeNull();
  });
});
