import { describe, expect, it, vi } from 'vitest';
import type { ConnectedDroid, McpServerStatusInfo } from '@factory/droid-sdk';
import { classifyConnectFailure } from './classify';
import { ConnectionError, DaemonClientError } from './errors';
import { createMcpClient, toMcpServer } from './mcp';

const FAILED = 'failed' as McpServerStatusInfo['status'];

function info(overrides: Partial<McpServerStatusInfo> = {}): McpServerStatusInfo {
  return {
    name: 'val-a',
    status: 'connected',
    source: 'user',
    isManaged: false,
    serverType: 'stdio',
    ...overrides,
  } as McpServerStatusInfo;
}

function harness() {
  const closes: string[] = [];
  let next = 0;
  const generation = { value: 1 };
  const link = { down: false };
  const mcp = {
    listServers: vi.fn(async () => ({ servers: [info(), info({ name: 'val-b' })] })),
    listTools: vi.fn(async () => [
      { serverName: 'val-a', name: 'echo', description: 'Echo', isEnabled: true },
      { serverName: 'val-b', name: 'time', isEnabled: false },
    ]),
    addServer: vi.fn(async () => ({ success: true })),
    toggleServer: vi.fn(async () => ({ success: true })),
    authenticateServer: vi.fn(async () => ({ success: true })),
    cancelAuth: vi.fn(async () => ({ success: true })),
    clearAuth: vi.fn(async () => ({ success: true })),
    removeServer: vi.fn(async () => ({ success: true })),
  };
  const create = vi.fn(async () => {
    const id = `scratch-${++next}`;
    return { id, close: vi.fn(async () => void closes.push(id)) };
  });
  const resume = vi.fn(async (id: string) => ({
    id,
    close: vi.fn(async () => void closes.push(id)),
  }));
  const droid = {
    workspace: {
      validateDirectory: vi.fn(async () => ({ isValid: true, resolvedPath: '/home/user' })),
    },
    sessions: { create, resume },
    mcp,
  } as unknown as ConnectedDroid;
  const client = createMcpClient({
    droid: () => {
      if (link.down) throw new ConnectionError('The daemon connection is not ready.');
      return droid;
    },
    generation: () => generation.value,
    run: async (op) => {
      try {
        return await op();
      } catch (err) {
        throw classifyConnectFailure(err);
      }
    },
  });
  return { client, mcp, create, resume, closes, generation, droid, link };
}

/** Starts a sign-in whose call the lost socket interrupts, as the daemon reports it. */
async function interruptedSignIn(h: ReturnType<typeof harness>, name = 'val-a') {
  h.mcp.authenticateServer.mockRejectedValueOnce(new Error('Client destroyed'));
  await h.client.listServers();
  const run = h.client.authenticateServer(name);
  await run.catch(() => undefined);
  return run;
}

describe('toMcpServer', () => {
  it('keeps the reported fields and drops the auth state token', () => {
    expect(
      toMcpServer(
        info({
          status: FAILED as McpServerStatusInfo['status'],
          error: 'Authentication required',
          requiresAuth: true,
          pendingAuthUrl: 'https://auth.example/authorize?state=secret',
          pendingAuthState: 'secret',
          pendingAuthMessage: 'long text with state',
        }),
      ),
    ).toEqual({
      name: 'val-a',
      status: FAILED,
      serverType: 'stdio',
      source: 'user',
      isManaged: false,
      error: 'Authentication required',
      requiresAuth: true,
      pendingAuthUrl: 'https://auth.example/authorize?state=secret',
    });
  });

  it('omits optional fields the daemon did not report', () => {
    expect(Object.keys(toMcpServer(info()))).toEqual([
      'name',
      'status',
      'serverType',
      'source',
      'isManaged',
    ]);
  });
});

describe('createMcpClient', () => {
  it('opens one scratch session in the home folder and reuses it', async () => {
    const { client, mcp, create, droid } = harness();
    await client.listServers();
    await client.listTools();
    expect(droid.workspace.validateDirectory).toHaveBeenCalledWith('~');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ cwd: '/home/user' });
    expect(mcp.listServers).toHaveBeenCalledWith('scratch-1');
    expect(mcp.listTools).toHaveBeenCalledWith('scratch-1');
  });

  it('shares one in-flight session creation between concurrent calls', async () => {
    const { client, create } = harness();
    await Promise.all([client.listServers(), client.listServers(), client.listTools()]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('opens a new scratch session after the connection was replaced', async () => {
    const { client, mcp, create, generation } = harness();
    await client.listServers();
    generation.value = 2;
    await client.listServers();
    expect(create).toHaveBeenCalledTimes(2);
    expect(mcp.listServers).toHaveBeenLastCalledWith('scratch-2');
  });

  describe('an open sign-in', () => {
    it('resumes the same scratch session after the socket was replaced mid sign-in', async () => {
      const h = harness();
      await expect(interruptedSignIn(h)).rejects.toMatchObject({ kind: 'connection' });
      h.generation.value = 2;
      await h.client.listServers();
      expect(h.resume).toHaveBeenCalledWith('scratch-1');
      expect(h.create).toHaveBeenCalledTimes(1);
      expect(h.mcp.listServers).toHaveBeenLastCalledWith('scratch-1');
      await h.client.cancelAuth('val-a');
      expect(h.mcp.cancelAuth).toHaveBeenCalledWith({
        sessionId: 'scratch-1',
        serverName: 'val-a',
      });
    });

    it('keeps resuming across several replaced sockets until the sign-in ends', async () => {
      const h = harness();
      await expect(interruptedSignIn(h)).rejects.toBeDefined();
      h.mcp.listServers.mockResolvedValue({ servers: [info({ status: FAILED })] });
      h.generation.value = 2;
      await h.client.listServers();
      h.generation.value = 3;
      await h.client.listServers();
      expect(h.resume).toHaveBeenCalledTimes(2);
      expect(h.create).toHaveBeenCalledTimes(1);
    });

    it('opens a new session once cancelAuth ended the sign-in', async () => {
      const h = harness();
      await expect(interruptedSignIn(h)).rejects.toBeDefined();
      await h.client.cancelAuth('val-a');
      h.generation.value = 2;
      await h.client.listServers();
      expect(h.resume).not.toHaveBeenCalled();
      expect(h.create).toHaveBeenCalledTimes(2);
    });

    it('does not keep the session when the sign-in failed for a daemon reason', async () => {
      const h = harness();
      h.mcp.authenticateServer.mockRejectedValueOnce(
        Object.assign(new Error('Authorization was cancelled'), { error: { code: -32000 } }),
      );
      await h.client.authenticateServer('val-a').catch(() => undefined);
      h.generation.value = 2;
      await h.client.listServers();
      expect(h.resume).not.toHaveBeenCalled();
      expect(h.create).toHaveBeenCalledTimes(2);
    });

    it('forgets the sign-in after the daemon stopped reporting its page', async () => {
      const h = harness();
      await expect(interruptedSignIn(h)).rejects.toBeDefined();
      h.mcp.listServers.mockResolvedValueOnce({
        servers: [info({ status: FAILED, pendingAuthUrl: 'https://auth.example/a' })],
      });
      await h.client.listServers();
      h.mcp.listServers.mockResolvedValueOnce({ servers: [info({ status: FAILED })] });
      await h.client.listServers();
      h.generation.value = 2;
      await h.client.listServers();
      expect(h.resume).not.toHaveBeenCalled();
      expect(h.create).toHaveBeenCalledTimes(2);
    });

    it('replaces the session when the daemon no longer knows it', async () => {
      const h = harness();
      await expect(interruptedSignIn(h)).rejects.toBeDefined();
      h.generation.value = 2;
      h.resume.mockRejectedValueOnce(
        Object.assign(new Error('Session not found'), { name: 'SessionNotFoundError' }),
      );
      await h.client.listServers();
      expect(h.create).toHaveBeenCalledTimes(2);
      expect(h.mcp.listServers).toHaveBeenLastCalledWith('scratch-2');
      h.generation.value = 3;
      await h.client.listServers();
      expect(h.resume).toHaveBeenCalledTimes(1);
      expect(h.create).toHaveBeenCalledTimes(3);
    });

    it('retries the resume when the socket failed again, without replacing the session', async () => {
      const h = harness();
      await expect(interruptedSignIn(h)).rejects.toBeDefined();
      h.generation.value = 2;
      h.resume.mockRejectedValueOnce(new Error('socket closed'));
      await expect(h.client.listServers()).rejects.toThrow('socket closed');
      await h.client.listServers();
      expect(h.resume).toHaveBeenCalledTimes(2);
      expect(h.create).toHaveBeenCalledTimes(1);
      expect(h.mcp.listServers).toHaveBeenLastCalledWith('scratch-1');
    });

    it('survives calls made while the socket is still down', async () => {
      const h = harness();
      await expect(interruptedSignIn(h)).rejects.toBeDefined();
      h.generation.value = 2;
      h.link.down = true;
      await expect(h.client.listServers()).rejects.toBeInstanceOf(ConnectionError);
      await expect(h.client.cancelAuth('val-a')).rejects.toBeInstanceOf(ConnectionError);
      h.link.down = false;
      await h.client.cancelAuth('val-a');
      expect(h.resume).toHaveBeenCalledWith('scratch-1');
      expect(h.create).toHaveBeenCalledTimes(1);
      expect(h.mcp.cancelAuth).toHaveBeenCalledWith({
        sessionId: 'scratch-1',
        serverName: 'val-a',
      });
    });
  });

  it('closes the scratch session on release and opens a fresh one afterwards', async () => {
    const { client, create, closes } = harness();
    await client.listServers();
    await client.release();
    expect(closes).toEqual(['scratch-1']);
    await client.listServers();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('release without a session is a no-op', async () => {
    const { client, closes } = harness();
    await client.release();
    expect(closes).toEqual([]);
  });

  it('forgets a scratch session whose creation failed', async () => {
    const { client, create } = harness();
    create.mockRejectedValueOnce(new Error('no session'));
    await expect(client.listServers()).rejects.toThrow('no session');
    await expect(client.listServers()).resolves.toHaveLength(2);
  });

  it('fills a missing toolCount from the tool list and keeps a reported one', async () => {
    const { client, mcp } = harness();
    mcp.listServers.mockResolvedValueOnce({
      servers: [info({ toolCount: 7 }), info({ name: 'val-b' }), info({ name: 'val-c' })],
    });
    const servers = await client.listServers();
    expect(servers.map((server) => [server.name, server.toolCount])).toEqual([
      ['val-a', 7],
      ['val-b', 1],
      ['val-c', undefined],
    ]);
  });

  it('does not read the tool list when no connected server lacks a count', async () => {
    const { client, mcp } = harness();
    mcp.listServers.mockResolvedValueOnce({
      servers: [info({ toolCount: 2 }), info({ name: 'val-b', status: FAILED as never })],
    });
    await client.listServers();
    expect(mcp.listTools).not.toHaveBeenCalled();
  });

  it('still lists servers when the tool list fails', async () => {
    const { client, mcp } = harness();
    mcp.listTools.mockRejectedValueOnce(new Error('tools down'));
    expect(await client.listServers()).toHaveLength(2);
  });

  it('filters tools by server name', async () => {
    const { client } = harness();
    expect(await client.listTools('val-a')).toEqual([
      { serverName: 'val-a', name: 'echo', description: 'Echo', isEnabled: true },
    ]);
    expect(await client.listTools()).toHaveLength(2);
  });

  it('sends stdio and http server definitions as the daemon expects', async () => {
    const { client, mcp } = harness();
    await client.addServer({
      type: 'stdio',
      name: 'val-stdio',
      command: 'node',
      args: ['-e', 'x'],
      env: { A: '1' },
    });
    await client.addServer({ type: 'http', name: 'val-http', url: 'http://127.0.0.1:3199/mcp' });
    await client.addServer({ type: 'stdio', name: 'val-bare', command: 'node', args: [], env: {} });
    expect(mcp.addServer).toHaveBeenNthCalledWith(1, {
      sessionId: 'scratch-1',
      type: 'stdio',
      name: 'val-stdio',
      command: 'node',
      args: ['-e', 'x'],
      env: { A: '1' },
    });
    expect(mcp.addServer).toHaveBeenNthCalledWith(2, {
      sessionId: 'scratch-1',
      type: 'http',
      name: 'val-http',
      url: 'http://127.0.0.1:3199/mcp',
    });
    expect(mcp.addServer).toHaveBeenNthCalledWith(3, {
      sessionId: 'scratch-1',
      type: 'stdio',
      name: 'val-bare',
      command: 'node',
    });
  });

  it('toggles and removes at user level', async () => {
    const { client, mcp } = harness();
    await client.toggleServer('val-a', false);
    await client.removeServer('val-a');
    expect(mcp.toggleServer).toHaveBeenCalledWith({
      sessionId: 'scratch-1',
      serverName: 'val-a',
      enabled: false,
      settingsLevel: 'user',
    });
    expect(mcp.removeServer).toHaveBeenCalledWith({
      sessionId: 'scratch-1',
      serverName: 'val-a',
      settingsLevel: 'user',
    });
  });

  it('turns success:false into a typed error', async () => {
    const { client, mcp } = harness();
    mcp.addServer.mockResolvedValueOnce({ success: false });
    await expect(
      client.addServer({ type: 'http', name: 'val-x', url: 'http://x.example' }),
    ).rejects.toBeInstanceOf(DaemonClientError);
  });
});
