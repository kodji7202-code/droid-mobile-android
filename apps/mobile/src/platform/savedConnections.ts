/** Non-secret connection metadata. The API key lives in the secure store. */
export interface SavedConnection {
  id: string;
  label: string;
  url: string;
}

interface SavedConnectionsState {
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
