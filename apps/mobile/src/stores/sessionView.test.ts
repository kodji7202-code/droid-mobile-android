import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection, SessionMessage } from '@droidmobile/daemon-client';
import { useConnectionStore } from './connection';
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

describe('cached refresh racing an older-page load', () => {
  beforeEach(() => useSessionViewStore.getState().reset());

  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) =>
      message('m' + (from + index), 'user', from + index, 'm' + (from + index)),
    );

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  type Page = { messages: SessionMessage[]; hasMore: boolean; nextCursor?: string };

  async function openWithPendingOlder() {
    const older = deferred<Page>();
    const refresh = deferred<Page>();
    const getMessages = vi
      .fn()
      .mockResolvedValueOnce({ messages: range(51, 100), hasMore: true, nextCursor: 'c1' })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(refresh.promise);
    const handle = { id: 's1', settings: { modelId: 'm' }, cwd: 'C:\\w', getMessages };
    const connection = { resumeSession: vi.fn(async () => handle) } as unknown as DaemonConnection;
    await useSessionViewStore.getState().open(connection, 's1', 1);
    const loading = useSessionViewStore.getState().loadOlder('s1');
    const refreshing = useSessionViewStore.getState().open(connection, 's1', 1);
    return { older, refresh, loading, refreshing, getMessages };
  }

  const ids = () => useSessionViewStore.getState().views['s1']?.items.map((item) => item.id);

  it('discards an older page that resolves after the window moved, leaving no gap', async () => {
    const { older, refresh, loading, refreshing, getMessages } = await openWithPendingOlder();
    refresh.resolve({ messages: range(55, 104), hasMore: true, nextCursor: 'c2' });
    await refreshing;
    older.resolve({ messages: range(1, 50), hasMore: false, nextCursor: undefined });
    await loading;

    const view = useSessionViewStore.getState().views['s1']!;
    expect(ids()).toEqual(range(55, 104).map((item) => item.id));
    expect(view.nextCursor).toBe('c2');
    expect(view.hasMore).toBe(true);
    expect(view.loadingOlder).toBe(false);

    getMessages.mockResolvedValueOnce({ messages: range(5, 54), hasMore: false });
    await useSessionViewStore.getState().loadOlder('s1');
    expect(getMessages).toHaveBeenLastCalledWith({ limit: expect.any(Number), cursor: 'c2' });
    expect(ids()?.slice(0, 2)).toEqual(['m5', 'm6']);
    expect(ids()).toContain('m54');
    expect(ids()).toContain('m104');
  });

  it('keeps the refreshed window when the older page resolves first', async () => {
    const { older, refresh, loading, refreshing } = await openWithPendingOlder();
    older.resolve({ messages: range(1, 50), hasMore: false, nextCursor: undefined });
    await loading;
    refresh.resolve({ messages: range(55, 104), hasMore: true, nextCursor: 'c2' });
    await refreshing;

    const view = useSessionViewStore.getState().views['s1']!;
    expect(ids()?.[0]).toBe('m55');
    expect(ids()).toHaveLength(50);
    expect(view.nextCursor).toBe('c2');
    expect(view.hasMore).toBe(true);
  });
});

describe('sessionView across connection replacement', () => {
  beforeEach(() => {
    useSessionViewStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });

  it('drops the previous daemon transcript so an old route never renders it', async () => {
    const a = setup([[message('u1', 'user', 1, 'daemon A secret')]]);
    useConnectionStore.setState({ connection: a.connection, status: 'ready' });
    await useSessionViewStore.getState().open(a.connection, 's1', 1);
    expect(texts()).toEqual(['daemon A secret']);

    const b = setup([[]]);
    b.resumeSession.mockRejectedValue(new Error('unknown session'));
    useConnectionStore.setState({ connection: b.connection });
    expect(useSessionViewStore.getState().views['s1']).toBeUndefined();

    await useSessionViewStore.getState().open(b.connection, 's1', 2);
    expect(useSessionViewStore.getState().views['s1']?.status).toBe('error');
    expect(texts()).toEqual([]);
  });

  it('ignores a load that resolves after the connection was replaced', async () => {
    const a = setup([[message('u1', 'user', 1, 'daemon A secret')]]);
    useConnectionStore.setState({ connection: a.connection, status: 'ready' });
    const loading = useSessionViewStore.getState().open(a.connection, 's1', 1);
    useConnectionStore.setState({ connection: setup([[]]).connection });
    await loading;
    expect(useSessionViewStore.getState().views['s1']).toBeUndefined();
  });
});

describe('early Stop on a restored dialog', () => {
  beforeEach(() => {
    useSessionViewStore.getState().reset();
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });

  it('sends the interrupt once the handle exists although history is still loading', async () => {
    const { connection, resumeSession } = setup([[message('u1', 'user', 1, 'first')]]);
    type Page = { messages: SessionMessage[]; hasMore: boolean; nextCursor: undefined };
    let resolveHistory: (page: Page) => void = () => undefined;
    const history = {
      promise: new Promise<Page>((resolve) => {
        resolveHistory = resolve;
      }),
      resolve: (page: Page) => resolveHistory(page),
    };
    const interrupt = vi.fn(async () => undefined);
    const handle = {
      id: 's1',
      settings: { modelId: 'm' },
      cwd: 'C:\\w',
      getMessages: vi.fn(() => history.promise),
      interrupt,
    };
    resumeSession.mockResolvedValue(handle);
    useConnectionStore.setState({ connection, status: 'ready' });

    const opening = useSessionViewStore.getState().open(connection, 's1', 1);
    await vi.waitFor(() => expect(handle.getMessages).toHaveBeenCalled());
    await useSessionViewStore.getState().interrupt('s1');
    history.resolve({ messages: [], hasMore: false, nextCursor: undefined });
    await opening;

    expect(interrupt).toHaveBeenCalledTimes(1);
  });
});
