/** Non-secret connection metadata. The API key lives in the secure store. */
export interface SavedConnection {
  id: string;
  label: string;
  url: string;
}

export interface SavedConnectionsState {
  activeId: string | null;
  connections: SavedConnection[];
}

export const SAVED_CONNECTIONS_KEY = 'droidmobile.connections';

const EMPTY: SavedConnectionsState = { activeId: null, connections: [] };

function isSavedConnection(value: unknown): value is SavedConnection {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.url === 'string'
  );
}

export function loadSavedConnections(): SavedConnectionsState {
  try {
    const raw = window.localStorage.getItem(SAVED_CONNECTIONS_KEY);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    const { activeId, connections } = parsed as Record<string, unknown>;
    if (!Array.isArray(connections)) return EMPTY;
    const valid = connections.filter(isSavedConnection);
    return {
      activeId: typeof activeId === 'string' ? activeId : null,
      connections: valid.map(({ id, label, url }) => ({ id, label, url })),
    };
  } catch {
    return EMPTY;
  }
}

/** Adds or updates a connection (matched by id) and makes it the active one. */
export function saveActiveConnection(connection: SavedConnection): void {
  const { connections } = loadSavedConnections();
  const others = connections.filter((entry) => entry.id !== connection.id);
  const next: SavedConnectionsState = {
    activeId: connection.id,
    connections: [...others, { id: connection.id, label: connection.label, url: connection.url }],
  };
  window.localStorage.setItem(SAVED_CONNECTIONS_KEY, JSON.stringify(next));
}

function write(state: SavedConnectionsState): void {
  window.localStorage.setItem(SAVED_CONNECTIONS_KEY, JSON.stringify(state));
}

/** Adds a connection without changing which one is active. */
export function addSavedConnection(connection: SavedConnection): void {
  const state = loadSavedConnections();
  write({
    ...state,
    connections: [
      ...state.connections,
      { id: connection.id, label: connection.label, url: connection.url },
    ],
  });
}

export function updateSavedConnection(
  id: string,
  patch: Partial<Pick<SavedConnection, 'label' | 'url'>>,
): void {
  const state = loadSavedConnections();
  write({
    ...state,
    connections: state.connections.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    ),
  });
}

export function setActiveSavedConnection(id: string | null): void {
  write({ ...loadSavedConnections(), activeId: id });
}

/** Removes the entry; the active marker is cleared when it pointed at it. */
export function removeSavedConnection(id: string): void {
  const state = loadSavedConnections();
  write({
    activeId: state.activeId === id ? null : state.activeId,
    connections: state.connections.filter((entry) => entry.id !== id),
  });
}
