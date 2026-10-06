import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DaemonConnection,
  MissionSnapshot,
  NormalizedEvent,
  PermissionAnswer,
} from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useInteractionStore } from '../../stores/interactions';
import { useMissionStore } from '../../stores/missions';
import { useSessionViewStore } from '../../stores/sessionView';
import { SessionScreen } from '../session/SessionScreen';
import {
  asMissionEvent,
  proposeMissionRequest,
  snapshot,
  startMissionRunRequest,
  workerStarted,
} from './__fixtures__/missionFixtures';

function connectionFor(options: {
  interactionMode?: string;
  mission?: MissionSnapshot;
  script?: (prompt: string) => AsyncGenerator<NormalizedEvent, void, undefined>;
}) {
  const handle = {
    id: 's1',
    settings: { modelId: 'model-x' },
    settingsSnapshot: {
      modelId: 'model-x',
      ...(options.interactionMode ? { interactionMode: options.interactionMode } : {}),
    },
    cwd: 'C:\\work\\proj',
    getMessages: async () => ({ messages: [], hasMore: false }),
    stream: vi.fn(options.script ?? async function* () {}),
    interrupt: vi.fn(async () => undefined),
  };
  const subscribe = vi.fn((_id: string, listener: (value: MissionSnapshot) => void) => {
    if (options.mission) listener(options.mission);
    return () => undefined;
  });
  const connection = {
    resumeSession: async () => handle,
    missions: { snapshot: () => options.mission, subscribe },
  } as unknown as DaemonConnection;
  useConnectionStore.setState({ connection, status: 'ready', readyEpoch: 1 });
  return { handle, subscribe };
}

function mount() {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={['/sessions/s1']}>
        <Routes>
          <Route path="/sessions/:id" element={<SessionScreen />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

afterEach(() => {
  act(() => {
    useInteractionStore.getState().reset();
    useSessionViewStore.getState().reset();
    useMissionStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

describe('Mission Control entry (VAL-MISSION-006)', () => {
  it('is absent for a normal session', async () => {
    const { subscribe } = connectionFor({ interactionMode: 'auto' });
    mount();
    await screen.findByTestId('chat-input');
    expect(screen.queryByTestId('missions-view')).not.toBeInTheDocument();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('is absent for a session without a reported mode', async () => {
    connectionFor({});
    mount();
    await screen.findByTestId('chat-input');
    expect(screen.queryByTestId('missions-view')).not.toBeInTheDocument();
  });

  it('is present for a Mission session, with the empty state and the message input', async () => {
    connectionFor({ interactionMode: 'mission' });
    mount();
    expect(await screen.findByTestId('missions-view')).toBeInTheDocument();
    expect(screen.getByTestId('missions-empty')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="mission-feature-"]')).toHaveLength(0);
  });
});

describe('re-entering the Mission view (VAL-MISSION-014)', () => {
  it('restores the snapshot without flashing the empty state or doubling rows', async () => {
    connectionFor({ interactionMode: 'mission', mission: snapshot() });
    const first = mount();
    await screen.findByTestId('missions-view');
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="mission-feature-"]')).toHaveLength(4),
    );
    const counts = () => ({
      features: document.querySelectorAll('[data-testid^="mission-feature-"]').length,
      groups: document.querySelectorAll('[data-testid^="mission-group-m"]').length,
      workers: screen.getByTestId('mission-workers').children.length,
    });
    const before = counts();
    expect(before).toEqual({ features: 4, groups: 1, workers: 2 });

    first.unmount();
    mount();
    // The first paint of the view already holds the restored state.
    const view = await screen.findByTestId('missions-view');
    expect(within(view).queryByTestId('missions-empty')).not.toBeInTheDocument();
    await waitFor(() => expect(counts()).toEqual(before));
    expect(screen.queryByTestId('missions-empty')).not.toBeInTheDocument();
  });

  it('applies a mission notification of a running turn to the open view', async () => {
    connectionFor({ interactionMode: 'mission', mission: snapshot() });
    mount();
    await screen.findByTestId('mission-workers');
    act(() => useMissionStore.getState().apply('s1', asMissionEvent(workerStarted('w-9'))));
    expect(screen.getByTestId('mission-worker-status-w-9')).toHaveTextContent('Running');
    expect(screen.getByTestId('mission-workers').children).toHaveLength(3);
  });
});

describe('mission permission requests (VAL-MISSION-013)', () => {
  async function open() {
    connectionFor({ interactionMode: 'mission' });
    mount();
    await screen.findByTestId('missions-view');
  }

  it('shows a propose_mission request and answers cancel on deny, never before the user acts', async () => {
    await open();
    const answers: PermissionAnswer[] = [];
    let promise!: Promise<PermissionAnswer>;
    act(() => {
      promise = useInteractionStore.getState().requestPermission('s1', proposeMissionRequest());
      void promise.then((answer) => answers.push(answer));
    });
    const dialog = await screen.findByTestId('permission-dialog');
    expect(dialog).toHaveAttribute('data-mission-request', 'propose_mission');
    expect(within(dialog).getByRole('heading', { name: 'Mission proposal' })).toBeInTheDocument();
    expect(within(dialog).getByTestId('mission-permission-title')).toHaveTextContent(
      'Ship the thing',
    );
    expect(within(dialog).getByTestId('mission-permission-proposal')).toHaveTextContent(
      'Build three milestones.',
    );
    expect(within(dialog).queryByTestId('permission-approve-always')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('permission-approve-once')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(answers).toEqual([]);

    await userEvent.setup().click(within(dialog).getByTestId('permission-deny'));
    expect(await promise).toBe('cancel');
    expect(answers).toEqual(['cancel']);
    await waitFor(() => expect(screen.queryByTestId('permission-dialog')).not.toBeInTheDocument());
  });

  it('shows a start_mission_run request with the running-mission count and denies it', async () => {
    await open();
    let promise!: Promise<PermissionAnswer>;
    act(() => {
      promise = useInteractionStore.getState().requestPermission('s1', startMissionRunRequest());
    });
    const dialog = await screen.findByTestId('permission-dialog');
    expect(dialog).toHaveAttribute('data-mission-request', 'start_mission_run');
    expect(within(dialog).getByRole('heading', { name: 'Start the mission run' })).toBeVisible();
    expect(within(dialog).getByTestId('mission-permission-running')).toHaveTextContent(
      '2 other missions are running.',
    );
    expect(within(dialog).getByTestId('mission-permission-running-ids')).toHaveTextContent(
      'other-1',
    );
    await userEvent.setup().click(within(dialog).getByTestId('permission-deny'));
    expect(await promise).toBe('cancel');
  });

  it('approves once only when the user chooses it', async () => {
    await open();
    let promise!: Promise<PermissionAnswer>;
    act(() => {
      promise = useInteractionStore.getState().requestPermission('s1', proposeMissionRequest());
    });
    await userEvent.setup().click(await screen.findByTestId('permission-approve-once'));
    expect(await promise).toBe('proceed_once');
  });
});
