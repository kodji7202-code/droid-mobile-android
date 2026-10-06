import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Automation,
  AutomationHistory,
  AutomationRunDescriptor,
  DaemonConnection,
} from '@droidmobile/daemon-client';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';

const PAUSED: Automation = {
  id: 'val-auto-a',
  uuid: 'uuid-a',
  name: 'val-auto-a',
  prompt: 'Reply with the single word OK',
  status: 'paused',
  schedule: 'weekly',
  isValid: true,
};
const ACTIVE: Automation = {
  ...PAUSED,
  id: 'val-auto-b',
  uuid: 'uuid-b',
  name: 'val-auto-b',
  status: 'active',
  nextRunAt: '2026-10-12T09:00:00.000Z',
  lastRunAt: '2026-10-05T09:00:00.000Z',
  lastRunStatus: 'success',
};
const DESCRIPTOR: AutomationRunDescriptor = {
  automationName: 'val-auto-a',
  cwd: 'C:\\Users\\x\\.factory\\automations\\val-auto-a',
  prompt: '<system-reminder>scaffold</system-reminder>\nReply with the single word OK',
};

interface Fakes {
  list?: () => Promise<Automation[]>;
  run?: () => Promise<AutomationRunDescriptor>;
  pause?: (id: string) => Promise<string>;
  resume?: (id: string) => Promise<string>;
  history?: () => Promise<AutomationHistory>;
}

function setup(path: string, fakes: Fakes = {}) {
  const automations = {
    list: vi.fn(fakes.list ?? (async () => [PAUSED])),
    run: vi.fn(fakes.run ?? (async () => DESCRIPTOR)),
    pause: vi.fn(fakes.pause ?? (async () => 'paused')),
    resume: vi.fn(fakes.resume ?? (async () => 'active')),
    history: vi.fn(fakes.history ?? (async () => ({ runs: [], totalCount: 0 }))),
  };
  const handle = { id: 'new-session' };
  const connection = {
    automations,
    checkFolderTrust: vi.fn(async () => ({ promptRequired: false })),
    trustFolder: vi.fn(async () => {}),
    createSession: vi.fn(async () => handle),
    resumeSession: vi.fn(async () => {
      throw new Error('not under test');
    }),
  } as unknown as DaemonConnection;
  useConnectionStore.setState({ status: 'ready', readyEpoch: 1 });
  renderAppAt(path, { connection });
  return { automations, connection, handle };
}

const adopt = vi.fn();
const send = vi.fn(async () => {});
const original = {
  adopt: useSessionViewStore.getState().adopt,
  send: useSessionViewStore.getState().send,
};

beforeEach(() => {
  adopt.mockClear();
  send.mockClear();
  useSessionViewStore.setState({ adopt, send } as never);
});

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
    useSessionViewStore.setState({ ...original, activeSessionId: null, views: {} } as never);
  });
});

describe('Automations list', () => {
  it('is reachable from the Extensions hub, outside the five sections', async () => {
    setup('/extensions');
    const hub = screen.getByRole('navigation', { name: 'Extensions' });
    expect(within(hub).queryByTestId('automations-open')).toBeNull();
    await userEvent.setup().click(screen.getByTestId('automations-open'));
    expect(await screen.findByTestId('automations-screen')).toHaveAccessibleName('Automations');
  });

  it('shows name, human-readable schedule and one labelled badge per automation', async () => {
    setup('/extensions/automations', { list: async () => [PAUSED, ACTIVE] });
    const list = await screen.findByTestId('automations-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByTestId('automation-name-val-auto-a')).toHaveTextContent('val-auto-a');
    expect(screen.getByTestId('automation-schedule-val-auto-a')).toHaveTextContent('Weekly');
    expect(screen.getByTestId('automation-status-val-auto-a')).toHaveTextContent('Paused');
    expect(screen.getByTestId('automation-status-val-auto-b')).toHaveTextContent('Active');
    expect(
      within(screen.getByTestId('automation-row-val-auto-a')).getAllByTestId(/^automation-status-/),
    ).toHaveLength(1);
  });

  it('renders an invalid and an unknown status without throwing', async () => {
    setup('/extensions/automations', {
      list: async () => [
        { ...PAUSED, id: 'bad', name: 'bad', status: 'invalid', isValid: false },
        { ...PAUSED, id: 'odd', name: 'odd', status: 'archived' },
      ],
    });
    expect(await screen.findByTestId('automation-status-bad')).toHaveTextContent('Invalid');
    expect(screen.getByTestId('automation-status-odd')).toHaveTextContent('archived');
  });

  it('shows a labelled loading indicator while the request is pending', async () => {
    let finish: (value: Automation[]) => void = () => undefined;
    setup('/extensions/automations', {
      list: () => new Promise<Automation[]>((resolve) => (finish = resolve)),
    });
    expect(await screen.findByTestId('automations-loading')).toHaveAccessibleName(
      'Loading automations',
    );
    expect(screen.queryByTestId('automations-empty')).toBeNull();
    finish([PAUSED]);
    expect(await screen.findByTestId('automation-row-val-auto-a')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-loading')).toBeNull();
  });

  it('shows the empty state when the daemon has no automations', async () => {
    setup('/extensions/automations', { list: async () => [] });
    expect(await screen.findByTestId('automations-empty')).toHaveTextContent('No automations');
    expect(screen.getByTestId('automations-list')).toBeInTheDocument();
  });

  it('shows an error with retry, then the list after retrying', async () => {
    const list = vi
      .fn<() => Promise<Automation[]>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue([PAUSED]);
    setup('/extensions/automations', { list });
    expect(await screen.findByTestId('automations-error')).toHaveTextContent(
      'Could not load automations',
    );
    await userEvent.setup().click(screen.getByTestId('error-state-retry'));
    expect(await screen.findByTestId('automation-row-val-auto-a')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-error')).toBeNull();
  });
});

describe('Automation details', () => {
  it('shows every field of a paused automation and no next run', async () => {
    setup('/extensions/automations/val-auto-a');
    expect(await screen.findByTestId('automation-detail-name')).toHaveTextContent('val-auto-a');
    expect(screen.getByTestId('automation-detail-schedule')).toHaveTextContent('Weekly');
    expect(screen.getByTestId('automation-detail-schedule-raw')).toHaveTextContent('weekly');
    expect(screen.getByTestId('automation-detail-prompt')).toHaveTextContent(
      'Reply with the single word OK',
    );
    expect(screen.getByTestId('automation-detail-status')).toHaveTextContent('Paused');
    expect(screen.queryByTestId('automation-detail-next-run')).toBeNull();
    expect(screen.queryByTestId('automation-detail-last-run')).toBeNull();
    const text = screen.getByTestId('automation-detail').textContent ?? '';
    expect(text).not.toMatch(/undefined|null/);
  });

  it('shows next and last run for an active automation', async () => {
    setup('/extensions/automations/val-auto-b', { list: async () => [PAUSED, ACTIVE] });
    expect(await screen.findByTestId('automation-detail-next-run')).toHaveTextContent('2026');
    expect(screen.getByTestId('automation-detail-last-run')).toHaveTextContent('Succeeded');
    expect(screen.getByTestId('automation-detail').textContent ?? '').not.toMatch(/undefined|null/);
  });

  it('uses placeholders for missing optional fields', async () => {
    setup('/extensions/automations/val-auto-a', {
      list: async () => [{ ...PAUSED, prompt: undefined, schedule: undefined }],
    });
    expect(await screen.findByTestId('automation-detail-prompt')).toHaveTextContent(
      'Not available',
    );
    expect(screen.getByTestId('automation-detail-schedule')).toHaveTextContent('No schedule');
    expect(screen.queryByTestId('automation-detail-schedule-raw')).toBeNull();
  });

  it('shows a not-found state for an unknown id', async () => {
    setup('/extensions/automations/nope');
    expect(await screen.findByTestId('automation-detail-missing')).toHaveTextContent('nope');
  });
});

describe('Run now', () => {
  it('asks for confirmation first and creates nothing on Cancel', async () => {
    const { automations, connection } = setup('/extensions/automations/val-auto-a');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('automation-run'));
    expect(screen.getByTestId('automation-run-confirm')).toHaveTextContent(/consumes credits/);
    await user.click(screen.getByTestId('automation-run-confirm-cancel'));
    expect(screen.queryByTestId('automation-run-confirm')).toBeNull();
    expect(automations.run).not.toHaveBeenCalled();
    expect(connection.createSession).not.toHaveBeenCalled();
    expect(adopt).not.toHaveBeenCalled();
  });

  it('opens a session in the descriptor folder and sends the descriptor prompt', async () => {
    const { automations, connection, handle } = setup('/extensions/automations/val-auto-a');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('automation-run'));
    await user.click(screen.getByTestId('automation-run-confirm-confirm'));
    await waitFor(() => expect(connection.createSession).toHaveBeenCalled());
    expect(automations.run).toHaveBeenCalledWith('val-auto-a');
    expect(connection.createSession).toHaveBeenCalledWith({ cwd: DESCRIPTOR.cwd });
    expect(adopt).toHaveBeenCalledWith(handle, 1);
    expect(send).toHaveBeenCalledWith('new-session', DESCRIPTOR.prompt);
    expect(await screen.findByTestId('session-screen')).toBeInTheDocument();
  });

  it('trusts the automation folder when the daemon asks and applies the configured model', async () => {
    const { connection } = setup('/extensions/automations/val-auto-a', {
      run: async () => ({ ...DESCRIPTOR, model: 'custom:m1' }),
    });
    vi.mocked(connection.checkFolderTrust).mockResolvedValue({ promptRequired: true } as never);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('automation-run'));
    await user.click(screen.getByTestId('automation-run-confirm-confirm'));
    await waitFor(() => expect(connection.createSession).toHaveBeenCalled());
    expect(connection.trustFolder).toHaveBeenCalledWith(DESCRIPTOR.cwd);
    expect(connection.createSession).toHaveBeenCalledWith({
      cwd: DESCRIPTOR.cwd,
      modelId: 'custom:m1',
    });
  });

  it('reports a failed start and opens no session', async () => {
    const { connection } = setup('/extensions/automations/val-auto-a', {
      run: async () => {
        throw new Error('refused');
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('automation-run'));
    await user.click(screen.getByTestId('automation-run-confirm-confirm'));
    expect(await screen.findByTestId('automation-run-error')).toHaveTextContent(
      'Could not start val-auto-a.',
    );
    expect(connection.createSession).not.toHaveBeenCalled();
    expect(adopt).not.toHaveBeenCalled();
    expect(screen.getByTestId('automation-detail')).toBeInTheDocument();
  });
});

describe('Pause and resume', () => {
  it('resumes, re-reads the daemon and shows the active badge with a next run, then pauses again', async () => {
    let status: 'paused' | 'active' = 'paused';
    const { automations } = setup('/extensions/automations/val-auto-a', {
      list: async () => [
        status === 'active'
          ? { ...PAUSED, status, nextRunAt: '2026-10-12T09:00:00.000Z' }
          : { ...PAUSED, status },
      ],
      resume: async () => {
        status = 'active';
        return 'active';
      },
      pause: async () => {
        status = 'paused';
        return 'paused';
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('automation-resume'));
    expect(automations.resume).toHaveBeenCalledWith('val-auto-a');
    await waitFor(() =>
      expect(screen.getByTestId('automation-detail-status')).toHaveTextContent('Active'),
    );
    expect(screen.getByTestId('automation-detail-next-run')).toBeInTheDocument();
    expect(screen.queryByTestId('automation-resume')).toBeNull();

    await user.click(screen.getByTestId('automation-pause'));
    await waitFor(() =>
      expect(screen.getByTestId('automation-detail-status')).toHaveTextContent('Paused'),
    );
    expect(screen.queryByTestId('automation-detail-next-run')).toBeNull();
    expect(automations.pause).toHaveBeenCalledWith('val-auto-a');
  });

  it('keeps the daemon state and shows the daemon wording when a change is refused', async () => {
    setup('/extensions/automations/val-auto-a', {
      resume: async () => {
        throw new Error('quota reached');
      },
    });
    await userEvent.setup().click(await screen.findByTestId('automation-resume'));
    expect(await screen.findByTestId('automation-action-error')).toHaveTextContent(
      'Could not resume val-auto-a. quota reached',
    );
    expect(screen.getByTestId('automation-detail-status')).toHaveTextContent('Paused');
  });
});

describe('Controls while the connection is down', () => {
  it('disables Run now and Resume, keeps the daemon badge and recovers after reconnect', async () => {
    const { automations } = setup('/extensions/automations/val-auto-a');
    await screen.findByTestId('automation-run');
    expect(screen.getByTestId('automation-run')).toBeEnabled();

    act(() => {
      useConnectionStore.setState({ status: 'reconnecting' });
    });
    expect(await screen.findByTestId('automations-error')).toBeInTheDocument();
    expect(screen.getByTestId('automation-run')).toBeDisabled();
    expect(screen.getByTestId('automation-resume')).toBeDisabled();
    expect(screen.getByTestId('automation-controls-offline')).toBeInTheDocument();
    expect(screen.getByTestId('automation-detail-status')).toHaveTextContent('Paused');

    automations.list.mockResolvedValue([{ ...PAUSED, status: 'active' }]);
    act(() => {
      useConnectionStore.setState({ status: 'ready', readyEpoch: 2 });
    });
    await waitFor(() =>
      expect(screen.getByTestId('automation-detail-status')).toHaveTextContent('Active'),
    );
    expect(screen.getByTestId('automation-pause')).toBeEnabled();
    expect(screen.queryByTestId('automations-error')).toBeNull();
  });

  it('turns the list into an error state with Retry when the link drops', async () => {
    setup('/extensions/automations');
    await screen.findByTestId('automation-row-val-auto-a');
    act(() => {
      useConnectionStore.setState({ status: 'reconnecting' });
    });
    expect(await screen.findByTestId('automations-error')).toBeInTheDocument();
    expect(screen.getByTestId('error-state-retry')).toBeInTheDocument();
  });
});

describe('Run history', () => {
  it('shows the localised empty state for an automation without runs', async () => {
    const { automations } = setup('/extensions/automations/val-auto-a/history');
    expect(await screen.findByTestId('automation-history-empty')).toHaveTextContent('No runs yet');
    expect(automations.history).toHaveBeenCalledWith('val-auto-a', 50);
  });

  it('is opened from the details view', async () => {
    setup('/extensions/automations/val-auto-a');
    await userEvent.setup().click(await screen.findByTestId('automation-history-open'));
    expect(await screen.findByTestId('automation-history')).toBeInTheDocument();
  });

  it('lists five typed runs newest first with status, start, duration, error and session link', async () => {
    const history: AutomationHistory = {
      totalCount: 5,
      runs: [
        {
          runId: 'r2',
          status: 'failed',
          startedAt: '2026-10-02T09:00:00Z',
          durationMs: 4000,
          errorMessage: 'Model refused the prompt',
        },
        {
          runId: 'r5',
          status: 'succeeded',
          startedAt: '2026-10-05T09:00:00Z',
          durationMs: 125_000,
          sessionId: 'sess-5',
        },
        { runId: 'r1', status: 'succeeded', startedAt: '2026-10-01T09:00:00Z' },
        { runId: 'r4', status: 'failed', startedAt: '2026-10-04T09:00:00Z', durationMs: 900 },
        { runId: 'r3', status: 'succeeded', startedAt: '2026-10-03T09:00:00Z', durationMs: 12_000 },
      ],
    };
    setup('/extensions/automations/val-auto-a/history', { history: async () => history });
    const list = await screen.findByTestId('automation-history-list');
    const order = within(list)
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('data-testid'));
    expect(order).toEqual([
      'automation-run-r5',
      'automation-run-r4',
      'automation-run-r3',
      'automation-run-r2',
      'automation-run-r1',
    ]);
    expect(screen.getByTestId('automation-run-status-r5')).toHaveTextContent('Succeeded');
    expect(screen.getByTestId('automation-run-status-r2')).toHaveTextContent('Failed');
    expect(screen.getByTestId('automation-run-duration-r5')).toHaveTextContent('2 min 5 sec');
    expect(screen.getByTestId('automation-run-duration-r1')).toHaveTextContent('Not available');
    expect(screen.getByTestId('automation-run-started-r5')).toHaveTextContent('2026');
    expect(screen.getByTestId('automation-run-error-r2')).toHaveTextContent(
      'Model refused the prompt',
    );
    expect(screen.queryByTestId('automation-run-error-r5')).toBeNull();
    expect(screen.getByTestId('automation-run-session-r5')).toHaveAttribute(
      'href',
      '/sessions/sess-5',
    );
    expect(screen.queryByTestId('automation-run-session-r4')).toBeNull();
    expect(screen.queryByTestId('automation-history-partial')).toBeNull();
    expect(list.textContent ?? '').not.toMatch(/undefined|null/);
  });

  it('opens the session of a run from its link', async () => {
    setup('/extensions/automations/val-auto-a/history', {
      history: async () => ({
        totalCount: 1,
        runs: [
          { runId: 'r1', status: 'succeeded', startedAt: '2026-10-05T09:00:00Z', sessionId: 's9' },
        ],
      }),
    });
    await userEvent.setup().click(await screen.findByTestId('automation-run-session-r1'));
    expect(await screen.findByTestId('session-screen')).toBeInTheDocument();
  });

  it('says when only part of the history is shown', async () => {
    setup('/extensions/automations/val-auto-a/history', {
      history: async () => ({
        totalCount: 80,
        runs: [{ runId: 'r1', status: 'succeeded', startedAt: '2026-10-05T09:00:00Z' }],
      }),
    });
    expect(await screen.findByTestId('automation-history-partial')).toHaveTextContent('1 of 80');
  });

  it('shows loading, then an error with retry', async () => {
    const history = vi
      .fn<() => Promise<AutomationHistory>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ runs: [], totalCount: 0 });
    setup('/extensions/automations/val-auto-a/history', { history });
    expect(await screen.findByTestId('automation-history-error')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId('error-state-retry'));
    expect(await screen.findByTestId('automation-history-empty')).toBeInTheDocument();
  });
});
