import { describe, expect, it, vi } from 'vitest';
import type { ConnectedDroid } from '@factory/droid-sdk';
import { createCommandsClient, toSlashCommand } from './commands';

type RawCommand = Parameters<typeof toSlashCommand>[0];

function raw(overrides: Partial<RawCommand> = {}): RawCommand {
  return { name: 'val-hello', description: 'Validation hello command', ...overrides };
}

function harness(commands: RawCommand[] = [raw()]) {
  const closes: string[] = [];
  let next = 0;
  const generation = { value: 1 };
  const list = vi.fn(async (_sessionId: string) => commands);
  const create = vi.fn(async (_options: { cwd: string }) => {
    const id = `scratch-${++next}`;
    return { id, close: vi.fn(async () => void closes.push(id)) };
  });
  const droid = {
    workspace: {
      validateDirectory: vi.fn(async () => ({ isValid: true, resolvedPath: '/home/user' })),
    },
    sessions: { create },
    commands: { list },
  } as unknown as ConnectedDroid;
  const client = createCommandsClient({
    droid: () => droid,
    generation: () => generation.value,
    run: (op) => op(),
  });
  return { client, list, create, closes, generation, droid };
}

describe('toSlashCommand', () => {
  it('keeps name, description and the argument hint', () => {
    expect(toSlashCommand(raw({ argumentHint: '[topic]' }))).toEqual({
      name: 'val-hello',
      description: 'Validation hello command',
      argumentHint: '[topic]',
    });
  });

  it('omits an absent or empty argument hint and drops isExecutable', () => {
    expect(toSlashCommand(raw())).toEqual({
      name: 'val-hello',
      description: 'Validation hello command',
    });
    expect('argumentHint' in toSlashCommand(raw({ argumentHint: '' }))).toBe(false);
    expect('isExecutable' in toSlashCommand(raw({ isExecutable: true }))).toBe(false);
  });
});

describe('createCommandsClient', () => {
  it('lists through a scratch session in the given folder', async () => {
    const { client, list, create, droid } = harness();
    const result = await client.list('/work/app');
    expect(droid.workspace.validateDirectory).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ cwd: '/work/app' });
    expect(list).toHaveBeenCalledWith('scratch-1');
    expect(result.map((command) => command.name)).toEqual(['val-hello']);
  });

  it('uses the home folder when no project is given', async () => {
    const { client, create, droid } = harness();
    await client.list();
    expect(droid.workspace.validateDirectory).toHaveBeenCalledWith('~');
    expect(create).toHaveBeenCalledWith({ cwd: '/home/user' });
  });

  it('lists the commands of an open session by its own id without a scratch session', async () => {
    const { client, list, create } = harness();
    const result = await client.listForSession('sess-9');
    expect(list).toHaveBeenCalledWith('sess-9');
    expect(create).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('returns an empty list when the daemon reports no commands', async () => {
    const { client } = harness([]);
    expect(await client.list('/p')).toEqual([]);
  });

  it('closes the old session and opens a new one when the folder changes', async () => {
    const { client, create, closes } = harness();
    await client.list('/a');
    await client.list('/b');
    expect(create).toHaveBeenCalledTimes(2);
    expect(closes).toEqual(['scratch-1']);
  });

  it('closes the scratch session on release', async () => {
    const { client, closes } = harness();
    await client.list('/a');
    await client.release();
    expect(closes).toEqual(['scratch-1']);
  });
});
