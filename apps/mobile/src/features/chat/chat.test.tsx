import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection, NormalizedEvent } from '@droidmobile/daemon-client';
import { ConnectionError } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { SessionScreen } from '../session/SessionScreen';

type Script = (prompt: string) => AsyncGenerator<NormalizedEvent, void, undefined>;

function userEcho(id: string, text: string): NormalizedEvent {
  return {
    type: 'user',
    message: { id, role: 'user', createdAt: 1, content: [{ type: 'text', text }] } as never,
  };
}

function assistantFinal(id: string, text: string): NormalizedEvent {
  return {
    type: 'assistant',
    messageId: id,
    text,
    message: { id, role: 'assistant', createdAt: 2, content: [{ type: 'text', text }] } as never,
  };
}

function setup(script: Script) {
  const stream = vi.fn(script);
  const handle = {
    id: 's1',
    settings: { modelId: 'model-x' },
    cwd: 'C:\\work\\proj',
    getMessages: async () => ({ messages: [], hasMore: false }),
    stream,
    interrupt: vi.fn(async () => undefined),
  };
  const connection = { resumeSession: async () => handle } as unknown as DaemonConnection;
  useConnectionStore.setState({ connection, status: 'ready', readyEpoch: 1 });
  render(
    <AppProviders>
      <MemoryRouter initialEntries={['/sessions/s1']}>
        <Routes>
          <Route path="/sessions/:id" element={<SessionScreen />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
  return { stream };
}

afterEach(() => {
  act(() => {
    useSessionViewStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

async function typeAndSend(text: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByTestId('chat-input'), text);
  await user.click(screen.getByTestId('chat-send'));
}

describe('chat', () => {
  it('disables send for empty input and shows the user bubble, streamed text and idle state', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    setup(async function* () {
      yield userEcho('u1', 'Reply with the single word OK');
      yield { type: 'working_state', state: 'streaming_assistant_message' };
      yield { type: 'assistant_text_delta', messageId: 'a1', blockIndex: 0, text: 'O' };
      await gate;
      yield { type: 'assistant_text_delta', messageId: 'a1', blockIndex: 0, text: 'K' };
      yield assistantFinal('a1', 'OK');
    });

    const input = await screen.findByTestId('chat-input');
    expect(screen.getByTestId('chat-send')).toBeDisabled();
    const user = userEvent.setup();
    await user.type(input, '   ');
    expect(screen.getByTestId('chat-send')).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'Reply with the single word OK');
    await user.click(screen.getByTestId('chat-send'));

    expect(input).toHaveValue('');
    expect(screen.getByTestId('msg-user-0')).toHaveTextContent('Reply with the single word OK');
    await waitFor(() => expect(screen.getByTestId('msg-assistant-1')).toHaveTextContent('O'));
    expect(screen.getByTestId('chat-working')).toHaveAttribute(
      'data-state',
      'streaming_assistant_message',
    );
    expect(screen.getByTestId('chat-interrupt')).toBeInTheDocument();

    release();
    await waitFor(() => expect(screen.queryByTestId('chat-working')).not.toBeInTheDocument());
    expect(screen.getByTestId('msg-assistant-1').textContent?.trim()).toBe('OK');
    expect(screen.queryByTestId('chat-interrupt')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^msg-assistant-/)).toHaveLength(1);
  });

  it('renders a tool call collapsed, expands it and styles failures as errors', async () => {
    setup(async function* () {
      yield userEcho('u1', 'List files');
      yield {
        type: 'tool_call',
        toolName: 'LS',
        toolUseId: 't1',
        input: { directory_path: 'C:\\files' },
      };
      yield {
        type: 'tool_result',
        toolName: 'LS',
        toolUseId: 't1',
        content: 'notes.txt\ndata.csv',
        isError: false,
      };
      yield {
        type: 'tool_call',
        toolName: 'Read',
        toolUseId: 't2',
        input: { file_path: 'nope.txt' },
      };
      yield {
        type: 'tool_result',
        toolName: 'Read',
        toolUseId: 't2',
        content: 'File not found',
        isError: true,
      };
    });
    await typeAndSend('List files');

    const card = await screen.findByTestId('tool-call-t1');
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'completed'));
    expect(card).toHaveTextContent('LS');
    expect(card).toHaveTextContent('C:\\files');
    expect(card).not.toHaveTextContent('notes.txt');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('tool-call-toggle-t1'));
    expect(screen.getByTestId('tool-call-result-t1')).toHaveTextContent('notes.txt');
    await user.click(screen.getByTestId('tool-call-toggle-t1'));
    expect(screen.queryByTestId('tool-call-result-t1')).not.toBeInTheDocument();

    const failing = screen.getByTestId('tool-call-t2');
    expect(failing).toHaveAttribute('data-state', 'error');
    expect(within(failing).getByTestId('tool-call-status-t2')).toHaveTextContent('Error');
    await user.click(screen.getByTestId('tool-call-toggle-t2'));
    expect(screen.getByTestId('tool-call-result-t2')).toHaveTextContent('File not found');
  });

  it('shows a daemon error event and recovers to an idle, sendable session', async () => {
    setup(async function* () {
      yield userEcho('u1', 'hi');
      yield { type: 'error', message: '400 status code (no body)' };
    });
    await typeAndSend('hi');

    expect(await screen.findByTestId('chat-error-0')).toHaveTextContent('400');
    await waitFor(() => expect(screen.queryByTestId('chat-working')).not.toBeInTheDocument());
    await userEvent.setup().type(screen.getByTestId('chat-input'), 'again');
    expect(screen.getByTestId('chat-send')).toBeEnabled();
  });

  it('keeps an unsent message with a retry when the daemon is unreachable and sends it once', async () => {
    const { stream } = setup(async function* (prompt) {
      yield userEcho('u1', prompt);
      yield assistantFinal('a1', 'OK');
    });
    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeEnabled());
    act(() => useConnectionStore.setState({ status: 'reconnecting' }));
    await typeAndSend('Reply with the single word OK');

    const bubble = await screen.findByTestId('msg-user-0');
    expect(bubble).toHaveAttribute('data-delivery', 'failed');
    expect(screen.getByTestId('msg-failed-0')).toBeInTheDocument();
    expect(stream).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chat-working')).not.toBeInTheDocument();

    act(() => useConnectionStore.setState({ status: 'ready', readyEpoch: 2 }));
    await userEvent.setup().click(await screen.findByTestId('msg-retry-0'));
    await waitFor(() => expect(screen.getByTestId('msg-assistant-1')).toHaveTextContent('OK'));
    expect(stream).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId(/^msg-user-/)).toHaveLength(1);
  });

  it('fails the message when the stream rejects with a connection error', async () => {
    setup(async function* () {
      await Promise.reject(new ConnectionError('socket closed'));
      yield userEcho('u1', 'unreachable');
    });
    await typeAndSend('hello');
    const bubble = await screen.findByTestId('msg-user-0');
    await waitFor(() => expect(bubble).toHaveAttribute('data-delivery', 'failed'));
    expect(screen.getByTestId('chat-interrupted')).toBeInTheDocument();
  });

  it('stops streaming when the connection drops mid-turn and keeps the partial text', async () => {
    setup(async function* () {
      yield userEcho('u1', 'count');
      yield { type: 'assistant_text_delta', messageId: 'a1', blockIndex: 0, text: '1\n2\n' };
      await new Promise(() => undefined);
    });
    await typeAndSend('count');
    await waitFor(() => expect(screen.getByTestId('msg-assistant-1')).toHaveTextContent('1'));

    act(() => useConnectionStore.setState({ status: 'reconnecting' }));
    await waitFor(() => expect(screen.queryByTestId('chat-working')).not.toBeInTheDocument());
    expect(screen.getByTestId('msg-assistant-1')).toHaveTextContent('2');
    expect(screen.getByTestId('msg-assistant-1')).toHaveAttribute('data-streaming', 'false');
    expect(screen.getByTestId('chat-interrupted')).toBeInTheDocument();
  });
});
