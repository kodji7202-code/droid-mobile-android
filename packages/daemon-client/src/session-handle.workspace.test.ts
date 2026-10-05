import { describe, expect, it, vi } from 'vitest';
import type { ConnectedDroidSession } from '@factory/droid-sdk';
import { SessionHandle } from './session-handle';
import type { SessionHost } from './session-handle';

describe('SessionHandle workspace methods', () => {
  it('calls host.changeDirectory and updates handle cwd', async () => {
    const changeDirectory = vi.fn(async (_id: string, dir: string) => ({
      resolvedPath: dir.endsWith('/') ? dir.slice(0, -1) : dir,
    }));
    const host = {
      currentDroidToken: () => 1,
      changeDirectory,
    } as unknown as SessionHost;

    const handle = new SessionHandle('s-ws', host);
    handle.attach(
      { id: 's-ws', settings: {}, cwd: '/initial/dir' } as unknown as ConnectedDroidSession,
      1,
    );
    expect(handle.cwd).toBe('/initial/dir');

    const result = await handle.changeDirectory('/new/dir');
    expect(changeDirectory).toHaveBeenCalledWith('s-ws', '/new/dir');
    expect(result.resolvedPath).toBe('/new/dir');
    expect(handle.cwd).toBe('/new/dir');
  });

  it('delegates listFiles, searchFiles, and getFileContent to host', async () => {
    const listFiles = vi.fn(async () => ['a.ts', 'b.md']);
    const searchFiles = vi.fn(async () => ['a.ts']);
    const getFileContent = vi.fn(async () => ({ content: 'hello', byteLength: 5 }));

    const host = {
      currentDroidToken: () => 1,
      listFiles,
      searchFiles,
      getFileContent,
    } as unknown as SessionHost;

    const handle = new SessionHandle('s-ws', host);
    handle.attach(
      { id: 's-ws', settings: {}, cwd: '/some/dir' } as unknown as ConnectedDroidSession,
      1,
    );

    await expect(handle.listFiles(true)).resolves.toEqual(['a.ts', 'b.md']);
    expect(listFiles).toHaveBeenCalledWith('s-ws', true);

    await expect(handle.searchFiles('query', 10, false)).resolves.toEqual(['a.ts']);
    expect(searchFiles).toHaveBeenCalledWith('s-ws', 'query', 10, false);

    await expect(
      handle.getFileContent({ filePath: 'a.ts', encoding: 'utf8' }),
    ).resolves.toEqual({ content: 'hello', byteLength: 5 });
    expect(getFileContent).toHaveBeenCalledWith({
      sessionId: 's-ws',
      filePath: 'a.ts',
      encoding: 'utf8',
    });
  });

  it('updates handle.cwd when stream receives session_working_directory_changed event', async () => {
    async function* rawStream() {
      yield {
        type: 'session_working_directory_changed',
        cwd: '/stream/new-cwd',
      };
    }

    const session = {
      id: 's-stream',
      cwd: '/stream/initial',
      stream: vi.fn(() => rawStream()),
    } as unknown as ConnectedDroidSession;

    const host = {
      currentDroidToken: () => 1,
    } as unknown as SessionHost;

    const handle = new SessionHandle('s-stream', host);
    handle.attach(session, 1);
    expect(handle.cwd).toBe('/stream/initial');

    const events = [];
    for await (const event of handle.stream('test prompt')) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'session_working_directory_changed', cwd: '/stream/new-cwd' },
    ]);
    expect(handle.cwd).toBe('/stream/new-cwd');
  });
});
