import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { SessionScreen } from './SessionScreen';

function fakeConnection() {
  const resumeSession = vi.fn(async (id: string) => ({
    id,
    settings: { modelId: 'model-x' },
    settingsSnapshot: { modelId: 'model-x' },
    cwd: `C:\\work\\${id}`,
    getMessages: vi.fn(async () => ({ messages: [], hasMore: false, nextCursor: undefined })),
    getContextBreakdown: vi.fn(async () => {
      throw new Error('unavailable');
    }),
  }));
  return { connection: { resumeSession } as unknown as DaemonConnection, resumeSession };
}

function Switcher() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="switch-to-s2" onClick={() => void navigate('/sessions/s2')}>
      s2
    </button>
  );
}

afterEach(() => {
  act(() => {
    useSessionViewStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

describe('SessionScreen when the route switches to another session (tablet two-pane)', () => {
  it('starts the other session with an empty composer and no attachments', async () => {
    const { connection } = fakeConnection();
    useConnectionStore.setState({ connection, status: 'ready', readyEpoch: 1 });
    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/sessions/s1']}>
          <Switcher />
          <Routes>
            <Route path="/sessions/:id" element={<SessionScreen />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeEnabled());
    await user.type(screen.getByTestId('chat-input'), 'draft for session A');
    await user.upload(
      screen.getByTestId('chat-attach-input'),
      new File(['hello'], 'a-notes.txt', { type: 'text/plain' }),
    );
    expect(await screen.findByTestId('chat-attachment-0')).toBeInTheDocument();

    await user.click(screen.getByTestId('switch-to-s2'));

    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeEnabled());
    expect(screen.getByTestId('chat-input')).toHaveValue('');
    expect(screen.queryByTestId('chat-attachment-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-send')).toBeDisabled();
  });
});
