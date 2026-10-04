import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection, SessionMessage } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { SessionScreen } from './SessionScreen';

function message(id: string, role: string, createdAt: number, text: string): SessionMessage {
  return { id, role, createdAt, content: [{ type: 'text', text }] } as unknown as SessionMessage;
}

function fakeConnection(pages: SessionMessage[][]) {
  let call = 0;
  const getMessages = vi.fn(async () => {
    const messages = pages[call] ?? [];
    call += 1;
    const last = messages[messages.length - 1] as { id?: string } | undefined;
    return { messages, hasMore: call < pages.length, nextCursor: last?.id };
  });
  const handle = { id: 's1', settings: { modelId: 'model-x' }, cwd: 'C:\\work\\proj', getMessages };
  const resumeSession = vi.fn(async () => handle);
  return {
    connection: { resumeSession } as unknown as DaemonConnection,
    resumeSession,
    getMessages,
  };
}

function renderRoute(connection: DaemonConnection) {
  useConnectionStore.setState({ connection, status: 'ready', readyEpoch: 1 });
  render(
    <AppProviders>
      <MemoryRouter initialEntries={['/sessions/s1']}>
        <Routes>
          <Route path="/sessions/:id" element={<SessionScreen />} />
          <Route path="/sessions" element={<p data-testid="list-route">list</p>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

afterEach(() => {
  act(() => {
    useSessionViewStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

describe('SessionScreen', () => {
  it('resumes the session and shows the history oldest first with the session model', async () => {
    const { connection, resumeSession } = fakeConnection([
      [
        message('a1', 'assistant', 40, 'OK'),
        message('u1', 'user', 30, 'Reply with the single word OK'),
      ],
    ]);
    renderRoute(connection);

    await screen.findByTestId('msg-user-0');
    expect(resumeSession).toHaveBeenCalledWith('s1');
    expect(screen.getByTestId('msg-user-0')).toHaveTextContent('Reply with the single word OK');
    expect(screen.getByTestId('msg-assistant-1')).toHaveTextContent('OK');
    expect(screen.getByTestId('session-model-select')).toHaveValue('model-x');
    expect(screen.getByTestId('session-title')).toHaveTextContent('proj');
  });

  it('loads earlier messages in front of the loaded ones', async () => {
    const { connection, getMessages } = fakeConnection([
      [message('c', 'user', 3, 'third'), message('b', 'assistant', 2, 'second')],
      [message('a', 'user', 1, 'first')],
    ]);
    renderRoute(connection);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('session-load-older'));
    await waitFor(() => expect(screen.getByTestId('msg-user-0')).toHaveTextContent('first'));
    expect(getMessages).toHaveBeenLastCalledWith({ limit: 50, cursor: 'b' });
    const texts = screen
      .getAllByTestId(/^msg-/)
      .map((el) => el.querySelector('.session-message__text')?.textContent);
    expect(texts).toEqual(['first', 'second', 'third']);
    expect(screen.queryByTestId('session-load-older')).not.toBeInTheDocument();
  });

  it('shows an empty chat for a session without messages', async () => {
    const { connection } = fakeConnection([[]]);
    renderRoute(connection);
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
    expect(screen.queryByTestId('session-messages')).not.toBeInTheDocument();
  });

  it('offers a retry when the daemon cannot resume the session', async () => {
    const { connection, resumeSession } = fakeConnection([[]]);
    resumeSession.mockRejectedValueOnce(new Error('nope'));
    renderRoute(connection);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('error-state-retry'));
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
    expect(resumeSession).toHaveBeenCalledTimes(2);
  });

  it('goes back to the list', async () => {
    const { connection } = fakeConnection([[]]);
    renderRoute(connection);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('session-back'));
    expect(screen.getByTestId('list-route')).toBeInTheDocument();
  });
});
