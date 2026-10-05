import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection, NormalizedEvent } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { SessionScreen } from '../session/SessionScreen';

const usage = (inputTokens: number, outputTokens: number) =>
  ({
    inputTokens,
    outputTokens,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    thinkingTokens: 0,
  }) as const;

function setup(turns: NormalizedEvent[][]) {
  let turn = 0;
  const handle = {
    id: 's1',
    settings: { modelId: 'model-x' },
    cwd: 'C:\\work\\proj',
    getMessages: async () => ({ messages: [], hasMore: false }),
    stream: vi.fn(async function* () {
      yield* turns[turn++] ?? [];
    }),
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
}

afterEach(() => {
  act(() => {
    useSessionViewStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

async function send(text: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByTestId('chat-input'), text);
  await user.click(screen.getByTestId('chat-send'));
}

const finalMessage = (id: string, text: string): NormalizedEvent => ({
  type: 'assistant',
  messageId: id,
  text,
  message: { id, role: 'assistant', createdAt: 2, content: [{ type: 'text', text }] } as never,
});

describe('reasoning and usage', () => {
  it('shows reasoning collapsed and expands it on demand', async () => {
    setup([
      [
        { type: 'thinking_text_delta', messageId: 'a1', blockIndex: 0, text: '17 * 23 = 391' },
        { type: 'thinking_text_complete', messageId: 'a1', blockIndex: 0 },
        finalMessage('a1', '**391**'),
      ],
    ]);
    await send('What is 17 times 23?');
    const toggle = await screen.findByTestId('msg-thinking-toggle-1');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('msg-thinking-body-1')).toBeNull();
    expect(screen.getByTestId('msg-assistant-1').querySelector('strong')).toHaveTextContent('391');
    const user = userEvent.setup();
    await user.click(toggle);
    expect(screen.getByTestId('msg-thinking-body-1')).toHaveTextContent('17 * 23 = 391');
    await user.click(toggle);
    expect(screen.queryByTestId('msg-thinking-body-1')).toBeNull();
  });

  it('shows no usage before a turn and the latest totals after each turn', async () => {
    setup([
      [{ type: 'token_usage', usage: usage(1200, 40) }, finalMessage('a1', 'OK')],
      [{ type: 'token_usage', usage: usage(2600, 85) }, finalMessage('a2', 'OK')],
    ]);
    await screen.findByTestId('chat-input');
    expect(screen.queryByTestId('session-usage')).toBeNull();
    await send('one');
    const chip = await screen.findByTestId('session-usage');
    expect(chip).toHaveAttribute('data-input-tokens', '1200');
    expect(chip).toHaveAttribute('data-output-tokens', '40');
    await send('two');
    await waitFor(() =>
      expect(screen.getByTestId('session-usage')).toHaveAttribute('data-input-tokens', '2600'),
    );
    expect(screen.getByTestId('session-usage').textContent).not.toMatch(/NaN|undefined/);
  });
});
