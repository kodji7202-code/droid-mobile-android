import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection, NormalizedEvent } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { SessionScreen } from '../session/SessionScreen';

function setup() {
  let finish!: (event: NormalizedEvent) => void;
  const ended = new Promise<NormalizedEvent>((resolve) => (finish = resolve));
  const handle = {
    id: 's1',
    settings: { modelId: 'model-x' },
    cwd: 'C:\\work\\proj',
    getMessages: async () => ({ messages: [], hasMore: false }),
    stream: vi.fn(async function* (): AsyncGenerator<NormalizedEvent, void, undefined> {
      yield { type: 'working_state', state: 'streaming_assistant_message' };
      yield await ended;
    }),
    interrupt: vi.fn(async () => undefined),
    queueMessage: vi.fn(async () => ({ requestId: 'q1' })),
    cancelQueued: vi.fn(async () => undefined),
  };
  const connection = { resumeSession: async () => handle } as unknown as DaemonConnection;
  useConnectionStore.setState({ connection, status: 'ready', readyEpoch: 1 });
  const rendered = render(
    <AppProviders>
      <MemoryRouter initialEntries={['/sessions/s1']}>
        <Routes>
          <Route path="/sessions/:id" element={<SessionScreen />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
  return { handle, finish, rendered };
}

afterEach(() => {
  act(() => {
    useSessionViewStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

const stopped: NormalizedEvent = {
  type: 'result',
  sessionId: 's1',
  subtype: 'cancelled',
  success: false,
  interrupted: true,
  durationMs: 1,
  text: '',
  turnCount: 1,
  tokenUsage: null,
};

describe('queued messages UI', () => {
  it('shows a queued item with a cancel control while a turn runs, and removes it on cancel', async () => {
    const user = userEvent.setup();
    const { handle, finish } = setup();
    await user.type(await screen.findByTestId('chat-input'), 'Count to 200');
    await user.click(screen.getByTestId('chat-send'));
    await screen.findByTestId('chat-interrupt');

    await user.type(screen.getByTestId('chat-input'), 'Reply with the single word OK');
    expect(screen.getByTestId('chat-send')).toBeEnabled();
    await user.click(screen.getByTestId('chat-send'));

    const item = await screen.findByTestId('chat-queued-0');
    expect(item).toHaveTextContent('Reply with the single word OK');
    expect(screen.getByTestId('chat-input')).toHaveValue('');
    expect(screen.getAllByTestId(/^msg-user-/)).toHaveLength(1);

    await user.click(screen.getByTestId('chat-queued-cancel-0'));
    await waitFor(() => expect(screen.queryByTestId('chat-queued-0')).not.toBeInTheDocument());
    expect(handle.cancelQueued).toHaveBeenCalledWith('q1');

    finish(stopped);
    await waitFor(() => expect(screen.queryByTestId('chat-interrupt')).not.toBeInTheDocument());
  });

  it('puts the text back into the input when the interrupt drops the queued message', async () => {
    const user = userEvent.setup();
    const { finish } = setup();
    await user.type(await screen.findByTestId('chat-input'), 'Count to 200');
    await user.click(screen.getByTestId('chat-send'));
    await screen.findByTestId('chat-interrupt');
    await user.type(screen.getByTestId('chat-input'), 'Reply with the single word OK');
    await user.click(screen.getByTestId('chat-send'));
    await screen.findByTestId('chat-queued-0');

    await user.click(screen.getByTestId('chat-interrupt'));
    finish(stopped);

    await waitFor(() => expect(screen.queryByTestId('chat-queued-0')).not.toBeInTheDocument());
    expect(screen.getByTestId('chat-input')).toHaveValue('Reply with the single word OK');
    expect(screen.getByTestId('chat-send')).toBeEnabled();
  });

  it('does not restore the same text again after the session screen remounts', async () => {
    const user = userEvent.setup();
    const { finish, rendered } = setup();
    await user.type(await screen.findByTestId('chat-input'), 'Count to 200');
    await user.click(screen.getByTestId('chat-send'));
    await screen.findByTestId('chat-interrupt');
    await user.type(screen.getByTestId('chat-input'), 'Reply with the single word OK');
    await user.click(screen.getByTestId('chat-send'));
    await screen.findByTestId('chat-queued-0');
    await user.click(screen.getByTestId('chat-interrupt'));
    finish(stopped);
    await waitFor(() =>
      expect(screen.getByTestId('chat-input')).toHaveValue('Reply with the single word OK'),
    );

    rendered.unmount();
    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/sessions/s1']}>
          <Routes>
            <Route path="/sessions/:id" element={<SessionScreen />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );

    expect(await screen.findByTestId('chat-input')).toHaveValue('');
  });
});
