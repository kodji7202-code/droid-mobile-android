import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DaemonConnection,
  NormalizedEvent,
  PermissionAnswer,
  PermissionRequest,
} from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useInteractionStore } from '../../stores/interactions';
import { useSessionViewStore } from '../../stores/sessionView';
import { SessionScreen } from '../session/SessionScreen';

const OPTIONS = [
  'proceed_once',
  'proceed_auto_run_low',
  'proceed_auto_run_medium',
  'proceed_auto_run_high',
  'proceed_new_session',
  'proceed_new_session_low',
  'proceed_new_session_medium',
  'proceed_new_session_high',
  'cancel',
];

const specRequest = {
  options: OPTIONS.map((value) => ({ value, label: value })),
  toolUses: [
    {
      toolUse: { type: 'tool_use', id: 'spec-1', name: 'ExitSpecMode', input: {} },
      details: { type: 'exit_spec_mode', plan: '# Plan\n\n- create **hello.txt**' },
      confirmationType: 'exit_spec_mode',
    },
  ],
} as unknown as PermissionRequest;

function Session() {
  const { id } = useParams();
  return id === 's1' ? <SessionScreen /> : <p data-testid="landed">{id}</p>;
}

function setup(listSessions: ReturnType<typeof vi.fn>) {
  const answers: PermissionAnswer[] = [];
  const handle = {
    id: 's1',
    settings: { modelId: 'model-x' },
    cwd: 'C:\\work\\proj',
    getMessages: async () => ({ messages: [], hasMore: false }),
    stream: async function* (): AsyncGenerator<NormalizedEvent, void, undefined> {
      yield { type: 'working_state', state: 'waiting_for_tool_confirmation' };
      answers.push(await useInteractionStore.getState().requestPermission('s1', specRequest));
    },
    interrupt: vi.fn(async () => undefined),
  };
  const connection = {
    resumeSession: async () => handle,
    listSessions,
  } as unknown as DaemonConnection;
  useConnectionStore.setState({ connection, status: 'ready', readyEpoch: 1 });
  render(
    <AppProviders>
      <MemoryRouter initialEntries={['/sessions/s1']}>
        <Routes>
          <Route path="/sessions/:id" element={<Session />} />
          <Route path="/sessions" element={<p data-testid="list-screen" />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
  return { answers };
}

afterEach(() => {
  act(() => {
    useInteractionStore.getState().reset();
    useSessionViewStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

async function openPrompt() {
  const user = userEvent.setup();
  await user.type(await screen.findByTestId('chat-input'), 'plan it');
  await user.click(screen.getByTestId('chat-send'));
  await screen.findByTestId('permission-dialog');
  return user;
}

describe('exit spec mode prompt', () => {
  it('shows the plan as markdown and exactly the daemon options', async () => {
    setup(vi.fn(async () => []));
    await openPrompt();
    expect(screen.getByTestId('permission-plan').querySelector('strong')).toHaveTextContent(
      'hello.txt',
    );
    const shown = [
      ...screen.getAllByTestId(/^exit-spec-option-/).map((node) => node.dataset.testid),
      ...(screen.queryByTestId('permission-deny') ? ['cancel'] : []),
    ].map((id) => id?.replace('exit-spec-option-', ''));
    expect(shown.sort()).toEqual([...OPTIONS].sort());
    expect(screen.getByTestId('exit-spec-option-proceed_new_session_high')).toHaveTextContent(
      'New session, high autonomy',
    );
  });

  it('proceed once answers proceed_once and stays on the same session', async () => {
    const { answers } = setup(vi.fn(async () => []));
    const user = await openPrompt();
    await user.click(screen.getByTestId('exit-spec-option-proceed_once'));
    await waitFor(() => expect(answers).toEqual(['proceed_once']));
    expect(screen.queryByTestId('permission-dialog')).toBeNull();
    expect(screen.getByTestId('session-screen')).toBeInTheDocument();
  });

  it('cancel answers cancel and stays on the session', async () => {
    const { answers } = setup(vi.fn(async () => []));
    const user = await openPrompt();
    await user.click(screen.getByTestId('permission-deny'));
    await waitFor(() => expect(answers).toEqual(['cancel']));
    expect(screen.getByTestId('session-screen')).toBeInTheDocument();
  });

  it('new session high autonomy opens the session the daemon created in the same folder', async () => {
    const summary = (id: string, cwd: string) => ({ id, cwd, modifiedTime: new Date() });
    const calls: number[] = [];
    const listSessions = vi.fn(async () => {
      calls.push(1);
      if (calls.length === 1) return [summary('s1', 'C:\\work\\proj')];
      return [
        summary('other', 'C:\\elsewhere'),
        summary('fresh', 'c:\\work\\proj\\'),
        summary('s1', 'C:\\work\\proj'),
      ];
    });
    const { answers } = setup(listSessions);
    const user = await openPrompt();
    await user.click(screen.getByTestId('exit-spec-option-proceed_new_session_high'));
    await waitFor(() => expect(answers).toEqual(['proceed_new_session_high']));
    expect(await screen.findByTestId('landed')).toHaveTextContent('fresh');
  });
});
