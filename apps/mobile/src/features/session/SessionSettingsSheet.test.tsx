import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DaemonConnection,
  ModelSummary,
  SessionHandle,
  SessionSettingsSnapshot,
  SettingsPatch,
} from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { SessionSettingsSheet } from './SessionSettingsSheet';

const MODELS: ModelSummary[] = [
  {
    id: 'gpt-5',
    displayName: 'GPT-5',
    provider: 'openai',
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'claude-x',
    displayName: 'Claude X',
    provider: 'anthropic',
    supportedReasoningEfforts: ['off', 'max'],
    defaultReasoningEffort: 'off',
  },
];

function setup(
  initial: SessionSettingsSnapshot,
  applySettings?: (patch: SettingsPatch) => Promise<void>,
) {
  const state = { current: { ...initial } };
  const apply = vi.fn(
    applySettings ??
      (async (patch: SettingsPatch) => {
        state.current = { ...state.current, ...patch };
      }),
  );
  const handle = {
    get settingsSnapshot() {
      return state.current;
    },
    applySettings: apply,
  } as unknown as SessionHandle;
  const connection = { listModels: vi.fn(async () => MODELS) } as unknown as DaemonConnection;
  useConnectionStore.setState({ connection, status: 'ready', readyEpoch: 1 });
  const ui = (open: boolean) => (
    <AppProviders>
      <SessionSettingsSheet open={open} onClose={() => {}} handle={handle} />
    </AppProviders>
  );
  const view = render(ui(true));
  return { apply, state, setOpen: (open: boolean) => view.rerender(ui(open)) };
}

afterEach(() => {
  useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
});

const BASE: SessionSettingsSnapshot = {
  modelId: 'gpt-5',
  reasoningEffort: 'high',
  autonomyLevel: 'off',
  availableAutonomyLevels: ['off', 'low', 'medium', 'high'],
  interactionMode: 'auto',
};

describe('SessionSettingsSheet', () => {
  it('shows the daemon values, labelling auto as Normal', async () => {
    setup(BASE);
    expect(await screen.findByTestId('session-model-select')).toHaveTextContent('GPT-5');
    expect(screen.getByTestId('session-reasoning-select')).toHaveValue('high');
    expect(screen.getByTestId('session-autonomy-select')).toHaveValue('off');
    expect(screen.getByTestId('session-mode-select')).toHaveValue('auto');
    expect(screen.getByRole('option', { name: 'Normal' })).toBeInTheDocument();
  });

  it('offers exactly the daemon autonomy levels and the three modes', async () => {
    setup({ ...BASE, availableAutonomyLevels: ['off', 'high'] });
    const autonomy = await screen.findByTestId('session-autonomy-select');
    expect(
      within(autonomy)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Off', 'High']);
    const mode = screen.getByTestId('session-mode-select');
    expect(
      within(mode)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Normal', 'Spec', 'Mission']);
  });

  it('offers only the efforts the model supports and marks its default', async () => {
    setup(BASE);
    const select = screen.getByTestId('session-reasoning-select');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Low', 'Medium (default)', 'High']);
  });

  it('lists every model, filters by search and shows an empty state', async () => {
    setup(BASE);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('session-model-select'));
    expect(await screen.findAllByTestId(/^session-model-select-option-/)).toHaveLength(2);

    await user.type(screen.getByTestId('session-model-select-search'), 'ANTHRO');
    expect(screen.getAllByTestId(/^session-model-select-option-/)).toHaveLength(1);

    await user.clear(screen.getByTestId('session-model-select-search'));
    await user.type(screen.getByTestId('session-model-select-search'), 'zzzz-none');
    expect(screen.queryAllByTestId(/^session-model-select-option-/)).toHaveLength(0);
    expect(screen.getByTestId('session-model-select-empty')).toBeInTheDocument();
  });

  it('sends a valid effort together with a model whose efforts differ', async () => {
    const { apply } = setup(BASE);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('session-model-select'));
    await user.click(await screen.findByTestId('session-model-select-option-claude-x'));

    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({ modelId: 'claude-x', reasoningEffort: 'off' }),
    );
    await waitFor(() => expect(screen.getByTestId('session-reasoning-select')).toHaveValue('off'));
  });

  it('persists autonomy and mode changes', async () => {
    const { apply } = setup(BASE);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId('session-autonomy-select'), 'high');
    await user.selectOptions(screen.getByTestId('session-mode-select'), 'mission');
    expect(apply).toHaveBeenCalledWith({ autonomyLevel: 'high' });
    expect(apply).toHaveBeenCalledWith({ interactionMode: 'mission' });
  });

  it('shows spec model and reasoning controls only in spec mode', async () => {
    setup({
      ...BASE,
      interactionMode: 'spec',
      specModeModelId: 'claude-x',
      specModeReasoningEffort: 'max',
    });
    expect(await screen.findByTestId('session-spec-model-select')).toHaveTextContent('Claude X');
    await waitFor(() =>
      expect(screen.getByTestId('session-spec-reasoning-select')).toHaveValue('max'),
    );
  });

  it('hides the spec controls in normal mode', async () => {
    setup(BASE);
    await screen.findByTestId('session-model-select');
    expect(screen.queryByTestId('session-spec-model-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-spec-reasoning-select')).not.toBeInTheDocument();
  });

  it('does not show a rejected change as applied', async () => {
    const { state } = setup(BASE, async () => {
      throw new Error('socket closed');
    });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId('session-autonomy-select'), 'high');

    expect(await screen.findByTestId('session-settings-error')).toBeInTheDocument();
    expect(screen.getByTestId('session-autonomy-select')).toHaveValue('off');
    expect(state.current.autonomyLevel).toBe('off');
  });

  it('refuses to send while the connection is not ready', async () => {
    const { apply } = setup(BASE);
    useConnectionStore.setState({ status: 'offline' });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId('session-autonomy-select'), 'high');

    expect(await screen.findByTestId('session-settings-error')).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-autonomy-select')).toHaveValue('off');
  });

  it('clears the failure text when the connection is ready again', async () => {
    setup(BASE);
    useConnectionStore.setState({ status: 'offline' });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId('session-autonomy-select'), 'high');
    expect(await screen.findByTestId('session-settings-error')).toBeInTheDocument();

    act(() => useConnectionStore.setState({ status: 'ready' }));
    await waitFor(() =>
      expect(screen.queryByTestId('session-settings-error')).not.toBeInTheDocument(),
    );
  });

  it('clears the failure text when the sheet is closed', async () => {
    const { setOpen } = setup(BASE, async () => {
      throw new Error('socket closed');
    });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId('session-autonomy-select'), 'high');
    expect(await screen.findByTestId('session-settings-error')).toBeInTheDocument();

    setOpen(false);
    setOpen(true);
    expect(await screen.findByTestId('session-autonomy-select')).toBeInTheDocument();
    expect(screen.queryByTestId('session-settings-error')).not.toBeInTheDocument();
  });

  it('follows an external change without reopening', async () => {
    const { state } = setup(BASE);
    await screen.findByTestId('session-autonomy-select');
    state.current = { ...state.current, autonomyLevel: 'medium' };
    await waitFor(
      () => expect(screen.getByTestId('session-autonomy-select')).toHaveValue('medium'),
      {
        timeout: 3000,
      },
    );
  });
});
