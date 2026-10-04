import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection, SessionMessage } from '@droidmobile/daemon-client';
import { useSessionViewStore } from './sessionView';

function message(id: string, role: string, createdAt: number, text: string): SessionMessage {
  return {
    id,
    createdAt,
    role,
    content: [{ type: 'text', text }],
  } as unknown as SessionMessage;
}

function setup(pages: SessionMessage[][]) {
  let call = 0;
  const getMessages = vi.fn(async () => {
    const messages = pages[Math.min(call, pages.length - 1)] ?? [];
    call += 1;
    return { messages, hasMore: false, nextCursor: undefined };
  });
  const handle = { id: 's1', settings: { modelId: 'm' }, cwd: 'C:\\w', getMessages };
  const resumeSession = vi.fn(async () => handle);
  return {
    connection: { resumeSession } as unknown as DaemonConnection,
    getMessages,
    resumeSession,
  };
}

const texts = () =>
  useSessionViewStore
    .getState()
    .views['s1']?.items.map((item) => (item.kind === 'user' ? item.text : item.kind));

describe('sessionView.open on a ready cached view', () => {
  beforeEach(() => useSessionViewStore.getState().reset());

  it('refreshes history from the daemon without duplicating known items', async () => {
    const { connection, getMessages } = setup([
      [message('u1', 'user', 1, 'first')],
      [message('u2', 'user', 2, 'external'), message('u1', 'user', 1, 'first')],
    ]);
    const store = useSessionViewStore.getState();
    await store.open(connection, 's1', 1);
    expect(texts()).toEqual(['first']);

    await useSessionViewStore.getState().open(connection, 's1', 1);

    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(useSessionViewStore.getState().views['s1']?.status).toBe('ready');
    expect(texts()).toEqual(['first', 'external']);
  });

  it('keeps the view untouched while a local turn is streaming', async () => {
    const { connection, getMessages } = setup([[message('u1', 'user', 1, 'first')]]);
    await useSessionViewStore.getState().open(connection, 's1', 1);
    useSessionViewStore.setState((state) => ({
      views: { s1: { ...state.views['s1']!, turnActive: true } },
    }));

    await useSessionViewStore.getState().open(connection, 's1', 1);

    expect(getMessages).toHaveBeenCalledTimes(1);
  });

  it('keeps failed local messages and ignores refresh errors', async () => {
    const { connection, getMessages } = setup([[message('u1', 'user', 1, 'first')]]);
    await useSessionViewStore.getState().open(connection, 's1', 1);
    useSessionViewStore.setState((state) => ({
      views: {
        s1: {
          ...state.views['s1']!,
          items: [
            ...state.views['s1']!.items,
            { kind: 'user', id: 'local-1', text: 'unsent', delivery: 'failed' },
          ],
        },
      },
    }));
    getMessages.mockRejectedValueOnce(new Error('offline'));
    await useSessionViewStore.getState().open(connection, 's1', 1);
    expect(texts()).toEqual(['first', 'unsent']);

    await useSessionViewStore.getState().open(connection, 's1', 1);
    expect(texts()).toEqual(['first', 'unsent']);
  });
});

describe('lost echo recovery', () => {
  beforeEach(() => useSessionViewStore.getState().reset());

  it('drops the failed bubble once history shows the prompt was stored', async () => {
    const { connection } = setup([
      [message('u0', 'user', 1, 'first')],
      [message('u1', 'user', 2, 'hello'), message('u0', 'user', 1, 'first')],
    ]);
    await useSessionViewStore.getState().open(connection, 's1', 1);
    useSessionViewStore.setState((state) => ({
      views: {
        s1: {
          ...state.views['s1']!,
          items: [
            ...state.views['s1']!.items,
            { kind: 'user', id: 'local-1', text: 'hello', delivery: 'failed' },
          ],
        },
      },
    }));

    await useSessionViewStore.getState().open(connection, 's1', 1);

    expect(texts()).toEqual(['first', 'hello']);
  });
});
