/**
 * MCP server management over the SDK facade (`droid.mcp`). Every daemon mcp.*
 * call needs an open session id, so the client owns one scratch session in
 * the user's home folder: created on first use, replaced after a reconnect,
 * closed by release(). mcp.getConfig/updateConfig are deliberately unused:
 * the daemon list is the only source of truth.
 */
import type {
  ConnectedDroid,
  ConnectedDroidSession,
  McpServerStatusInfo,
  SettingsLevel,
} from '@factory/droid-sdk';
import { DaemonClientError } from './errors';

/** The daemon only accepts user-level toggles and removals; the string equals the enum value. */
const USER_LEVEL = 'user' as SettingsLevel.User;

export interface McpServer {
  name: string;
  /** Reported status; one of connecting|connected|disconnected|failed|disabled today. */
  status: string;
  /** Reported transport: stdio|http|sse. */
  serverType: string;
  /** Settings level the server comes from (user, project, org, ...). */
  source: string;
  isManaged: boolean;
  error?: string;
  toolCount?: number;
  requiresAuth?: boolean;
  hasAuthTokens?: boolean;
  /** Authorization page of a pending sign-in. */
  pendingAuthUrl?: string;
}

export interface McpTool {
  serverName: string;
  name: string;
  description?: string;
  isEnabled: boolean;
}

export type AddMcpServerInput =
  | {
      type: 'stdio';
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | { type: 'http' | 'sse'; name: string; url: string };

export interface McpClient {
  /** Servers exactly as the daemon reports them (daemon order). */
  listServers(): Promise<McpServer[]>;
  /** Tools of the connected servers; pass a name to keep one server's tools. */
  listTools(serverName?: string): Promise<McpTool[]>;
  addServer(input: AddMcpServerInput): Promise<void>;
  toggleServer(serverName: string, enabled: boolean): Promise<void>;
  /**
   * Starts the OAuth flow. Settles only when the sign-in ends: success, or a
   * rejection after cancelAuth()/failure. The authorization page shows up as
   * `pendingAuthUrl` in listServers() while the call is pending.
   */
  authenticateServer(serverName: string): Promise<void>;
  cancelAuth(serverName: string): Promise<void>;
  clearAuth(serverName: string): Promise<void>;
  removeServer(serverName: string): Promise<void>;
  /** Closes the scratch session; the next call opens a new one. */
  release(): Promise<void>;
}

export function toMcpServer(info: Readonly<McpServerStatusInfo>): McpServer {
  return {
    name: info.name,
    status: info.status,
    serverType: info.serverType,
    source: info.source,
    isManaged: info.isManaged,
    ...(info.error !== undefined ? { error: info.error } : {}),
    ...(info.toolCount !== undefined ? { toolCount: info.toolCount } : {}),
    ...(info.requiresAuth !== undefined ? { requiresAuth: info.requiresAuth } : {}),
    ...(info.hasAuthTokens !== undefined ? { hasAuthTokens: info.hasAuthTokens } : {}),
    ...(info.pendingAuthUrl ? { pendingAuthUrl: info.pendingAuthUrl } : {}),
  };
}

export interface McpClientDeps {
  droid(): ConnectedDroid;
  /** Identity of the current facade; a different value means the socket was replaced. */
  generation(): number;
  /** Runs a facade call, converting SDK failures into classified errors. */
  run<T>(op: () => Promise<T>): Promise<T>;
}

interface ScratchSession {
  id: string;
  generation: number;
  session: ConnectedDroidSession;
}

function addParams(sessionId: string, input: AddMcpServerInput) {
  if (input.type === 'stdio') {
    return {
      sessionId,
      type: 'stdio' as const,
      name: input.name,
      command: input.command,
      ...(input.args && input.args.length > 0 ? { args: input.args } : {}),
      ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
    };
  }
  return { sessionId, type: input.type, name: input.name, url: input.url };
}

export function createMcpClient(deps: McpClientDeps): McpClient {
  let scratch: Promise<ScratchSession> | null = null;

  async function openScratch(): Promise<ScratchSession> {
    const droid = deps.droid();
    const generation = deps.generation();
    const home = await droid.workspace.validateDirectory('~');
    if (!home.isValid || !home.resolvedPath) {
      throw new DaemonClientError('unknown', home.error ?? 'The daemon has no home folder.');
    }
    const session = await droid.sessions.create({ cwd: home.resolvedPath });
    return { id: session.id, generation, session };
  }

  function sessionId(): Promise<string> {
    return deps.run(async () => {
      let current = scratch;
      if (current) {
        const known = await current.catch(() => null);
        if (!known || known.generation !== deps.generation()) {
          scratch = null;
          current = null;
        }
      }
      if (!current) {
        current = openScratch();
        scratch = current;
        current.catch(() => {
          if (scratch === current) scratch = null;
        });
      }
      return (await current).id;
    });
  }

  async function withSession<T>(op: (id: string, mcp: ConnectedDroid['mcp']) => Promise<T>) {
    const id = await sessionId();
    return deps.run(() => op(id, deps.droid().mcp));
  }

  async function expectSuccess(result: { success: boolean }, action: string): Promise<void> {
    if (!result.success) {
      throw new DaemonClientError('unknown', `The daemon did not ${action}.`);
    }
  }

  return {
    listServers: () =>
      withSession(async (id, mcp) => {
        const { servers } = await mcp.listServers(id);
        // The daemon leaves toolCount out for some servers; the tool list is the fallback,
        // read only when a connected server needs it.
        const needsCounts = servers.some(
          (info) => info.status === 'connected' && info.toolCount === undefined,
        );
        const tools = needsCounts
          ? await mcp.listTools(id).catch(() => [] as Awaited<ReturnType<typeof mcp.listTools>>)
          : [];
        const counts = new Map<string, number>();
        for (const tool of tools)
          counts.set(tool.serverName, (counts.get(tool.serverName) ?? 0) + 1);
        return servers.map((info) => {
          const server = toMcpServer(info);
          const counted = counts.get(server.name);
          return server.toolCount === undefined && counted !== undefined
            ? { ...server, toolCount: counted }
            : server;
        });
      }),
    listTools: (serverName) =>
      withSession(async (id, mcp) => {
        const tools = await mcp.listTools(id);
        return tools
          .filter((tool) => serverName === undefined || tool.serverName === serverName)
          .map((tool) => ({
            serverName: tool.serverName,
            name: tool.name,
            ...(tool.description !== undefined ? { description: tool.description } : {}),
            isEnabled: tool.isEnabled,
          }));
      }),
    addServer: (input) =>
      withSession(async (id, mcp) =>
        expectSuccess(await mcp.addServer(addParams(id, input)), 'add the server'),
      ),
    toggleServer: (serverName, enabled) =>
      withSession(async (id, mcp) =>
        expectSuccess(
          await mcp.toggleServer({ sessionId: id, serverName, enabled, settingsLevel: USER_LEVEL }),
          'switch the server',
        ),
      ),
    authenticateServer: (serverName) =>
      withSession(async (id, mcp) =>
        expectSuccess(
          await mcp.authenticateServer({ sessionId: id, serverName }),
          'finish signing in',
        ),
      ),
    cancelAuth: (serverName) =>
      withSession(async (id, mcp) =>
        expectSuccess(await mcp.cancelAuth({ sessionId: id, serverName }), 'cancel signing in'),
      ),
    clearAuth: (serverName) =>
      withSession(async (id, mcp) =>
        expectSuccess(await mcp.clearAuth({ sessionId: id, serverName }), 'clear the sign-in'),
      ),
    removeServer: (serverName) =>
      withSession(async (id, mcp) =>
        expectSuccess(
          await mcp.removeServer({ sessionId: id, serverName, settingsLevel: USER_LEVEL }),
          'remove the server',
        ),
      ),
    async release() {
      const current = scratch;
      scratch = null;
      if (!current) return;
      const known = await current.catch(() => null);
      if (!known || known.generation !== deps.generation()) return;
      await known.session.close().catch(() => undefined);
    },
  };
}
