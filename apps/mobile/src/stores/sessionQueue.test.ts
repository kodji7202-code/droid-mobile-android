import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent, SessionMessage } from '@droidmobile/daemon-client';
import { useConnectionStore } from './connection';
import { useSessionViewStore } from './sessionView';

const userMessage = (id: string, text: string) =>
  ({
    id,
    role: 'user',
    createdAt: 1,
    content: [{ type: 'text', text }],
  }) as unknown as SessionMessage;

const echo = (id: string, text: string): NormalizedEvent => ({
  type: 'user',
  message: userMessage(id, text) as never,
});

const result = (interrupted: boolean): NormalizedEvent => ({
  type: 'result',
  sessionId: 's1',
  subtype: interrupted ? 'cancelled' : 'success',
  success: !interrupted,
  interrupted,
  durationMs: 1,
  text: '',
  turnCount: 1,
  tokenUsage: null,
});

/** A stream the test drives by hand: push events, then end it. */
function controlledStream() {
  const events: NormalizedEvent[] = [];
  let wake: () => void = () => undefined;
  let ended = false;
  return {
    push(event: NormalizedEvent) {
      events.push(event);
      wake();
    },
    end() {
      ended = true;
      wake();
    },
    async *stream(): AsyncGenerator<NormalizedEvent, void, undefined> {
      for (;;) {
        const next = events.shift();
        if (next) yield next;
        else if (ended) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}

function setup(stored: () => SessionMessage[] = () => []) {
  const turn = controlledStream();
  const handle = {
    id: 's1',
    settings: { modelId: 'm' },
    cwd: 'C:\\w',
    getMessages: vi.fn(async () => ({ messages: stored(), hasMore: false })),
    stream: vi.fn(() => turn.stream()),
    interrupt: vi.fn(async () => undefined),
    queueMessage: vi.fn(async () => ({ requestId: 'q1' })),
    cancelQueued: vi.fn(async () => undefined),
  };
  const connection = { resumeSession: async () => handle } as never;
  useConnectionStore.setState({ connection, status: 'ready', readyEpoch: 1 });
  return { handle, turn, connection };
}

const view = () => useSessionViewStore.getState().views['s1']!;
const userTexts = () => view().items.flatMap((item) => (item.kind === 'user' ? [item.text] : []));

async function startTurn(connection: never) {
  await useSessionViewStore.getState().open(connection, 's1', 1);
  const running = useSessionViewStore.getState().send('s1', 'Count from 1 to 200');
  await vi.waitFor(() => expect(view().turnActive).toBe(true));
  return { running };
}

describe('queued messages', () => {
  beforeEach(() => useSessionViewStore.getState().reset());
  afterEach(() => vi.useRealTimers());

  it('queues a message sent during a turn instead of showing a user bubble', async () => {
    const { handle, turn, connection } = setup();
    const { running } = await startTurn(connection);

    await useSessionViewStore.getState().send('s1', '  Reply with the single word OK ');

    expect(handle.queueMessage).toHaveBeenCalledWith('Reply with the single word OK', {});
    expect(view().queued).toEqual([{ requestId: 'q1', text: 'Reply with the single word OK' }]);
    expect(userTexts()).toEqual(['Count from 1 to 200']);

    turn.push(echo('q1', 'Reply with the single word OK'));
    turn.push(result(false));
    turn.end();
    await running;
  });

  it('turns the queued item into exactly one normal user message when the daemon echoes it', async () => {
    const { turn, connection } = setup();
    const { running } = await startTurn(connection);
    await useSessionViewStore.getState().send('s1', 'Reply with the single word OK');

    turn.push(echo('q1', 'Reply with the single word OK'));
    await vi.waitFor(() => expect(view().queued).toEqual([]));
    turn.push(result(false));
    turn.end();
    await running;

    expect(userTexts()).toEqual(['Count from 1 to 200', 'Reply with the single word OK']);
    expect(view().restored).toBeUndefined();
  });

  it('cancel deletes the queued entry on the daemon and removes it', async () => {
    const { handle, turn, connection } = setup();
    const { running } = await startTurn(connection);
    await useSessionViewStore.getState().send('s1', 'Reply with the single word OK');

    await useSessionViewStore.getState().cancelQueued('s1', 'q1');

    expect(handle.cancelQueued).toHaveBeenCalledWith('q1');
    expect(view().queued).toEqual([]);

    turn.push(result(false));
    turn.end();
    await running;
    expect(userTexts()).toEqual(['Count from 1 to 200']);
    expect(view().restored).toBeUndefined();
  });

  it('keeps the entry and reports an error when the daemon refuses the cancel', async () => {
    const { handle, turn, connection } = setup();
    const { running } = await startTurn(connection);
    await useSessionViewStore.getState().send('s1', 'Reply with the single word OK');
    handle.cancelQueued.mockRejectedValueOnce(new Error('already running'));

    await useSessionViewStore.getState().cancelQueued('s1', 'q1');

    expect(view().queued).toHaveLength(1);
    expect(view().items.some((item) => item.kind === 'error')).toBe(true);

    turn.push(echo('q1', 'Reply with the single word OK'));
    turn.push(result(false));
    turn.end();
    await running;
    expect(view().queued).toEqual([]);
  });

  it('restores the text to the composer when an interrupt makes the daemon drop the queue', async () => {
    const { turn, connection } = setup(() => [userMessage('u0', 'Count from 1 to 200')]);
    const { running } = await startTurn(connection);
    await useSessionViewStore.getState().send('s1', 'Reply with the single word OK');

    await useSessionViewStore.getState().interrupt('s1');
    turn.push(result(true));
    turn.end();
    await running;

    expect(view().queued).toEqual([]);
    expect(view().restored?.text).toBe('Reply with the single word OK');
    expect(userTexts().filter((text) => text === 'Reply with the single word OK')).toEqual([]);
  });

  it('does not restore a queued message the daemon stored before the interrupt took effect', async () => {
    const { turn, connection } = setup(() => [
      userMessage('q1', 'Reply with the single word OK'),
      userMessage('u0', 'Count from 1 to 200'),
    ]);
    const { running } = await startTurn(connection);
    await useSessionViewStore.getState().send('s1', 'Reply with the single word OK');

    await useSessionViewStore.getState().interrupt('s1');
    turn.push(result(true));
    turn.end();
    await running;

    expect(view().queued).toEqual([]);
    expect(view().restored).toBeUndefined();
    expect(userTexts().filter((text) => text === 'Reply with the single word OK')).toHaveLength(1);
  });

  it('restores the text and reports the failure when the daemon rejects the queued message', async () => {
    const { handle, turn, connection } = setup();
    const { running } = await startTurn(connection);
    handle.queueMessage.mockRejectedValueOnce(new Error('queue refused'));

    await useSessionViewStore.getState().send('s1', 'Reply with the single word OK');

    expect(view().queued).toEqual([]);
    expect(view().restored?.text).toBe('Reply with the single word OK');
    expect(view().items.some((item) => item.kind === 'error')).toBe(true);

    turn.push(result(false));
    turn.end();
    await running;
  });

  it('gives a normally ended turn time to start the queued message, then hands the text back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { handle, turn, connection } = setup();
    const { running } = await startTurn(connection);
    await useSessionViewStore.getState().send('s1', 'Reply with the single word OK');

    turn.push(result(false));
    turn.end();
    await vi.advanceTimersByTimeAsync(10_000);
    await running;

    expect(handle.getMessages.mock.calls.length).toBeGreaterThan(2);
    expect(view().queued).toEqual([]);
    expect(view().restored?.text).toBe('Reply with the single word OK');
  });
});
