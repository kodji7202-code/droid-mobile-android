import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { SessionsScreen } from './SessionsScreen';
import { PAGE_SIZE } from './sessionsPaging';
import type { DaemonSessionSummary } from './sessionsPaging';

const BASE_SECONDS = 1_790_000_000;

function summary(
  index: number,
  overrides: Partial<DaemonSessionSummary> = {},
): DaemonSessionSummary {
  return {
    id: `s${String(index).padStart(3, '0')}`,
    title: `Session ${index}`,
    messageCount: index + 2,
    modifiedTime: new Date((BASE_SECONDS - index * 60) * 1000),
    ...overrides,
  } as DaemonSessionSummary;
}

/** Stand-in for the daemon's cursor semantics: newest first, exclusive unix-second endBefore. */
function fakeConnection(all: DaemonSessionSummary[]) {
  const listSessions = vi.fn(
    async (options?: { limit?: number; endBefore?: number; includeArchived?: boolean }) => {
      const limit = options?.limit ?? 100;
      const eligible = all.filter(
        (item) =>
          (options?.includeArchived === true || item.archivedTime == null) &&
          (options?.endBefore === undefined ||
            Math.floor(item.modifiedTime.getTime() / 1000) < options.endBefore),
      );
      return eligible.slice(0, limit);
    },
  );
  const searchSessions = vi.fn(async ({ query }: { query: string }) => ({
    query,
    sessions: all
      .filter((item) => (item.title ?? '').toLowerCase().includes(query.toLowerCase()))
      .map((item) => ({
        id: item.id,
        title: item.title,
        modifiedTime: item.modifiedTime,
        hits: [],
      })),
  }));
  const archiveSession = vi.fn(async (id: string) => {
    const found = all.find((item) => item.id === id);
    if (found) found.archivedTime = new Date();
  });
  const unarchiveSession = vi.fn(async (id: string) => {
    const found = all.find((item) => item.id === id);
    if (found) delete found.archivedTime;
  });
  const renameSession = vi.fn(async (id: string, title: string) => {
    const found = all.find((item) => item.id === id);
    if (found) found.title = title;
  });
  return {
    connection: {
      listSessions,
      searchSessions,
      archiveSession,
      unarchiveSession,
      renameSession,
    } as unknown as DaemonConnection,
    listSessions,
    searchSessions,
    archiveSession,
    unarchiveSession,
    renameSession,
  };
}

function renderScreen(all: DaemonSessionSummary[], status: 'ready' | 'offline' = 'ready') {
  const fake = fakeConnection(all);
  useConnectionStore.setState({ connection: fake.connection, status, readyEpoch: 1 });
  render(
    <AppProviders>
      <MemoryRouter>
        <SessionsScreen />
      </MemoryRouter>
    </AppProviders>,
  );
  return fake;
}

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
  });
});

describe('SessionsScreen list', () => {
  it('shows a loading skeleton, then rows newest first with title, time and count', async () => {
    const all = [summary(0), summary(1, { title: '' })];
    renderScreen(all);
    expect(screen.getByTestId('sessions-list')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('sessions-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();

    await screen.findByTestId('session-item-s000');
    const items = screen.getAllByTestId(/^session-item-/);
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual([
      'session-item-s000',
      'session-item-s001',
    ]);
    expect(screen.getByTestId('session-title-s000')).toHaveTextContent('Session 0');
    expect(screen.getByTestId('session-title-s001')).toHaveTextContent('Untitled session');
    expect(screen.getByTestId('session-count-s000')).toHaveTextContent('Messages: 2');
    expect(screen.getByTestId('session-modified-s000')).not.toBeEmptyDOMElement();
    expect(screen.queryByTestId('sessions-loading')).not.toBeInTheDocument();
  });

  it('reaches every page through endBefore without duplicates', async () => {
    const all = Array.from({ length: PAGE_SIZE * 2 + 5 }, (_, index) => summary(index));
    const { listSessions } = renderScreen(all);
    await screen.findByTestId('session-item-s000');
    expect(screen.getAllByTestId(/^session-item-/)).toHaveLength(PAGE_SIZE);

    const user = userEvent.setup();
    // The boundary-second row is requested twice by design (endBefore is exclusive), so
    // reaching the end takes a few clicks; the merge keeps every id once.
    for (let clicks = 0; clicks < 5 && screen.queryByTestId('sessions-load-more'); clicks += 1) {
      await user.click(screen.getByTestId('sessions-load-more'));
      await waitFor(() => expect(screen.getByTestId('sessions-load-more')).toBeEnabled()).catch(
        () => undefined,
      );
    }
    await waitFor(() => expect(screen.getAllByTestId(/^session-item-/)).toHaveLength(all.length));

    const ids = screen.getAllByTestId(/^session-item-/).map((el) => el.getAttribute('data-testid'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.queryByTestId('sessions-load-more')).not.toBeInTheDocument();
    const limits = listSessions.mock.calls.map((call) => call[0]?.limit);
    expect(limits.every((limit) => limit !== undefined && limit <= 100)).toBe(true);
  });

  it('shows the first-run empty state with a new-session action', async () => {
    renderScreen([]);
    expect(await screen.findByText('No sessions yet')).toBeInTheDocument();
    expect(screen.getByTestId('session-new-empty')).toBeInTheDocument();
    expect(screen.getByTestId('session-new')).toBeEnabled();
    expect(screen.queryByTestId('sessions-list')).not.toBeInTheDocument();
  });

  it('shows a no-results state for a search that matches nothing', async () => {
    renderScreen([summary(0), summary(1)]);
    await screen.findByTestId('session-item-s000');
    await userEvent.setup().type(screen.getByTestId('session-search-input'), 'zzzz-no-such');
    expect(await screen.findByText(/No sessions match "zzzz-no-such"/)).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^session-item-/)).toHaveLength(0);
  });
});

describe('SessionsScreen search', () => {
  it('sends one debounced sessions.search for the full query and shows the daemon hits', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { searchSessions } = renderScreen([
      summary(0, { title: 'alpha' }),
      summary(1, { title: 'droidm-abc123def456' }),
    ]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: 50 });
    await screen.findByTestId('session-item-s000');
    await user.type(screen.getByTestId('session-search-input'), 'droidm-abc123def456');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await waitFor(() => expect(screen.getAllByTestId(/^session-item-/)).toHaveLength(1));
    expect(screen.getByTestId('session-item-s001')).toBeInTheDocument();
    expect(searchSessions.mock.calls.length).toBeLessThanOrEqual(3);
    expect(searchSessions).toHaveBeenLastCalledWith({ query: 'droidm-abc123def456' });
  });

  it('restores the loaded list when the search is cleared', async () => {
    renderScreen([summary(0, { title: 'alpha' }), summary(1, { title: 'beta' })]);
    const user = userEvent.setup();
    await screen.findByTestId('session-item-s001');
    const input = screen.getByTestId('session-search-input');
    await user.type(input, 'alpha');
    await waitFor(() => expect(screen.queryByTestId('session-item-s001')).not.toBeInTheDocument());
    await user.clear(input);
    expect(await screen.findByTestId('session-item-s001')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^session-item-/)).toHaveLength(2);
  });

  it('shows an error with retry when sessions.search fails', async () => {
    const { searchSessions } = renderScreen([summary(0)]);
    searchSessions.mockRejectedValueOnce(new Error('boom'));
    await screen.findByTestId('session-item-s000');
    await userEvent.setup().type(screen.getByTestId('session-search-input'), 'x');
    expect(await screen.findByText('Search failed. Try again.')).toBeInTheDocument();
  });
});

describe('SessionsScreen archived filter', () => {
  it('lists archived sessions only and unarchive moves a session back', async () => {
    const { unarchiveSession } = renderScreen([
      summary(0),
      summary(1, { archivedTime: new Date(BASE_SECONDS * 1000) }),
    ]);
    const user = userEvent.setup();
    await screen.findByTestId('session-item-s000');
    expect(screen.queryByTestId('session-item-s001')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('sessions-filter-archived'));
    await screen.findByTestId('session-item-s001');
    expect(screen.queryByTestId('session-item-s000')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('session-more-s001'));
    await user.click(screen.getByTestId('session-unarchive-s001'));
    await waitFor(() => expect(screen.queryByTestId('session-item-s001')).not.toBeInTheDocument());
    expect(unarchiveSession).toHaveBeenCalledWith('s001');
    await user.click(screen.getByTestId('sessions-filter-active'));
    expect(await screen.findByTestId('session-item-s001')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is archived', async () => {
    renderScreen([summary(0)]);
    const user = userEvent.setup();
    await screen.findByTestId('session-item-s000');
    await user.click(screen.getByTestId('sessions-filter-archived'));
    expect(await screen.findByText('No archived sessions')).toBeInTheDocument();
  });
});

describe('SessionsScreen connection states', () => {
  it('keeps the loaded rows with an offline indicator and disables session-new', async () => {
    renderScreen([summary(0)]);
    await screen.findByTestId('session-item-s000');
    act(() => {
      useConnectionStore.setState({ status: 'reconnecting' });
    });
    expect(screen.getByTestId('session-item-s000')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-offline')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    expect(screen.getByTestId('session-new')).toBeDisabled();
  });

  it('refetches when readyEpoch increments after a reconnect', async () => {
    const all = [summary(0)];
    const { listSessions } = renderScreen(all);
    await screen.findByTestId('session-item-s000');
    const callsBefore = listSessions.mock.calls.length;
    all.unshift(summary(-1, { id: 'fresh' }));
    act(() => {
      useConnectionStore.setState({ status: 'reconnecting' });
    });
    act(() => {
      useConnectionStore.setState({ status: 'ready', readyEpoch: 2 });
    });
    await screen.findByTestId('session-item-fresh');
    expect(listSessions.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('polls while visible so changes made elsewhere appear', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const all = [summary(0), summary(1)];
    renderScreen(all);
    await screen.findByTestId('session-item-s001');
    all.splice(1, 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    await waitFor(() => expect(screen.queryByTestId('session-item-s001')).not.toBeInTheDocument());
    expect(screen.getByTestId('session-item-s000')).toBeInTheDocument();
  });

  it('keeps the scrolled extent on refresh: an archive elsewhere shrinks the list by one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const all = Array.from({ length: PAGE_SIZE + 10 }, (_, index) => summary(index));
    renderScreen(all);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await screen.findByTestId('session-item-s000');
    await user.click(screen.getByTestId('sessions-load-more'));
    await waitFor(() =>
      expect(screen.getAllByTestId(/^session-item-/).length).toBeGreaterThan(PAGE_SIZE),
    );
    const before = screen.getAllByTestId(/^session-item-/).length;
    all.splice(3, 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    await waitFor(() => expect(screen.queryByTestId('session-item-s003')).not.toBeInTheDocument());
    expect(screen.getAllByTestId(/^session-item-/)).toHaveLength(before - 1);
  });
  it('reloads on a downward touch pull from the top', async () => {
    const { listSessions } = renderScreen([summary(0)]);
    await screen.findByTestId('session-item-s000');
    const before = listSessions.mock.calls.length;
    const screenEl = screen.getByTestId('sessions-screen');
    fireEvent.touchStart(screenEl, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(screenEl, { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(screenEl);
    await waitFor(() => expect(listSessions.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('SessionsScreen row actions', () => {
  it('archives a session from the action menu and drops it from the list', async () => {
    const { archiveSession } = renderScreen([summary(0), summary(1)]);
    const user = userEvent.setup();
    await screen.findByTestId('session-item-s000');
    await user.click(screen.getByTestId('session-more-s000'));
    const menu = screen.getByTestId('session-menu-s000');
    await user.click(within(menu).getByTestId('session-archive-s000'));
    await waitFor(() => expect(screen.queryByTestId('session-item-s000')).not.toBeInTheDocument());
    expect(archiveSession).toHaveBeenCalledWith('s000');
    expect(screen.getByTestId('session-item-s001')).toBeInTheDocument();
  });

  it('renames a session through the sheet', async () => {
    const { renameSession } = renderScreen([summary(0)]);
    const user = userEvent.setup();
    await screen.findByTestId('session-item-s000');
    await user.click(screen.getByTestId('session-more-s000'));
    await user.click(screen.getByTestId('session-rename-s000'));
    const input = screen.getByTestId('session-rename-input');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByTestId('session-rename-save'));
    await waitFor(() => expect(renameSession).toHaveBeenCalledWith('s000', 'Renamed'));
    await waitFor(() =>
      expect(screen.getByTestId('session-title-s000')).toHaveTextContent('Renamed'),
    );
  });
});

describe('SessionsScreen same-second boundary', () => {
  it('reaches every session when more than a page shares one modified second', async () => {
    const all = Array.from({ length: PAGE_SIZE * 2 + 7 }, (_, index) =>
      summary(index, { modifiedTime: new Date(BASE_SECONDS * 1000) }),
    );
    renderScreen(all);
    const user = userEvent.setup();
    await screen.findByTestId('session-item-s000');
    for (let clicks = 0; clicks < 8 && screen.queryByTestId('sessions-load-more'); clicks += 1) {
      await user.click(screen.getByTestId('sessions-load-more'));
      await waitFor(() => expect(screen.getByTestId('sessions-load-more')).toBeEnabled()).catch(
        () => undefined,
      );
    }
    await waitFor(() => expect(screen.getAllByTestId(/^session-item-/)).toHaveLength(all.length));
    const ids = screen.getAllByTestId(/^session-item-/).map((el) => el.getAttribute('data-testid'));
    expect(new Set(ids).size).toBe(all.length);
  });
});

describe('SessionsScreen infinite scroll after search', () => {
  it('observes the recreated sentinel once the search is cleared', async () => {
    const observed: Array<{ target: Element | null; disconnected: boolean; fire(): void }> = [];
    class FakeObserver {
      private record: { target: Element | null; disconnected: boolean; fire(): void };
      constructor(callback: IntersectionObserverCallback) {
        this.record = {
          target: null,
          disconnected: false,
          fire: () =>
            callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never),
        };
        observed.push(this.record);
      }
      observe(target: Element) {
        this.record.target = target;
      }
      disconnect() {
        this.record.disconnected = true;
      }
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    try {
      const all = Array.from({ length: PAGE_SIZE + 10 }, (_, index) => summary(index));
      const { listSessions } = renderScreen(all);
      const user = userEvent.setup();
      await screen.findByTestId('session-item-s000');
      const input = screen.getByTestId('session-search-input');
      await user.type(input, 'Session 1');
      await screen.findByTestId('sessions-list');
      await waitFor(() =>
        expect(screen.queryByTestId('sessions-load-more')).not.toBeInTheDocument(),
      );
      await user.clear(input);
      await screen.findByTestId('sessions-load-more');
      const live = observed.filter(
        (record) => !record.disconnected && record.target?.isConnected === true,
      );
      expect(live).toHaveLength(1);
      const before = listSessions.mock.calls.length;
      act(() => live[0]?.fire());
      await waitFor(() => expect(listSessions.mock.calls.length).toBeGreaterThan(before));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('SessionsScreen in-flight reads versus local changes', () => {
  async function startGatedRefresh(fake: ReturnType<typeof fakeConnection>) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = fake.listSessions.getMockImplementation();
    if (!original) throw new Error('missing implementation');
    fake.listSessions.mockImplementationOnce(async (options) => {
      const snapshot = (await original(options)).map((item) => ({ ...item }));
      await gate;
      return snapshot;
    });
    await userEvent.setup().click(screen.getByTestId('sessions-refresh'));
    await waitFor(() => expect(fake.listSessions).toHaveBeenCalled());
    return release;
  }

  it('does not restore the old title when a stale read resolves after a rename', async () => {
    const fake = renderScreen([summary(0)]);
    const user = userEvent.setup();
    await screen.findByTestId('session-item-s000');
    const release = await startGatedRefresh(fake);
    const callsAfterStart = fake.listSessions.mock.calls.length;
    await user.click(screen.getByTestId('session-more-s000'));
    await user.click(screen.getByTestId('session-rename-s000'));
    const input = screen.getByTestId('session-rename-input');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByTestId('session-rename-save'));
    await waitFor(() =>
      expect(screen.getByTestId('session-title-s000')).toHaveTextContent('Renamed'),
    );
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(fake.listSessions.mock.calls.length).toBeGreaterThan(callsAfterStart),
    );
    expect(screen.getByTestId('session-title-s000')).toHaveTextContent('Renamed');
  });

  it('does not bring back an archived row when a stale read resolves afterwards', async () => {
    const fake = renderScreen([summary(0), summary(1)]);
    const user = userEvent.setup();
    await screen.findByTestId('session-item-s001');
    const release = await startGatedRefresh(fake);
    const callsAfterStart = fake.listSessions.mock.calls.length;
    await user.click(screen.getByTestId('session-more-s000'));
    await user.click(screen.getByTestId('session-archive-s000'));
    await waitFor(() => expect(screen.queryByTestId('session-item-s000')).not.toBeInTheDocument());
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(fake.listSessions.mock.calls.length).toBeGreaterThan(callsAfterStart),
    );
    expect(screen.queryByTestId('session-item-s000')).not.toBeInTheDocument();
    expect(screen.getByTestId('session-item-s001')).toBeInTheDocument();
  });
});

describe('SessionsScreen archived view and search', () => {
  it('drops the active search when entering the archived view', async () => {
    renderScreen([
      summary(0, { title: 'alpha' }),
      summary(1, { title: 'alpha old', archivedTime: new Date(BASE_SECONDS * 1000) }),
    ]);
    const user = userEvent.setup();
    await screen.findByTestId('session-item-s000');
    await user.type(screen.getByTestId('session-search-input'), 'alpha');
    await screen.findByTestId('session-item-s000');
    await user.click(screen.getByTestId('sessions-filter-archived'));
    await screen.findByTestId('session-item-s001');
    expect(screen.queryByTestId('session-item-s000')).not.toBeInTheDocument();
    expect(screen.getByTestId('session-search-input')).toHaveValue('');
    await user.click(screen.getByTestId('session-more-s001'));
    expect(screen.getByTestId('session-unarchive-s001')).toBeInTheDocument();
  });
});
