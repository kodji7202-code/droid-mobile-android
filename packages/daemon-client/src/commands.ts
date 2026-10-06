/**
 * Custom slash commands over the SDK facade (`droid.commands`). The daemon
 * lists only `.factory/commands/*.md` files of an open session's cwd plus
 * `~/.factory` (no built-ins), and the command runs when its text is sent as a
 * normal prompt, so this client only reads.
 */
import type { ConnectedDroid } from '@factory/droid-sdk';
import { createCwdScratchSession } from './scratch-session';
import type { ScratchSessionDeps } from './scratch-session';

export interface SlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface CommandsClient {
  /** Commands the daemon reports for the project `cwd` (home when omitted), read through a scratch session. */
  list(cwd?: string): Promise<SlashCommand[]>;
  /** Commands for a session the app already has open; scoped to that session's cwd. */
  listForSession(sessionId: string): Promise<SlashCommand[]>;
  /** Closes the scratch session; the next list() opens a new one. */
  release(): Promise<void>;
}

export type CommandsClientDeps = ScratchSessionDeps;

type RawCommand = Awaited<ReturnType<ConnectedDroid['commands']['list']>>[number];

export function toSlashCommand(info: Readonly<RawCommand>): SlashCommand {
  return {
    name: info.name,
    description: info.description,
    ...(info.argumentHint ? { argumentHint: info.argumentHint } : {}),
  };
}

export function createCommandsClient(deps: CommandsClientDeps): CommandsClient {
  const scratch = createCwdScratchSession(deps);

  const read = async (sessionId: string): Promise<SlashCommand[]> =>
    (await deps.run(() => deps.droid().commands.list(sessionId))).map(toSlashCommand);

  return {
    list: async (cwd) => read(await scratch.id(cwd)),
    listForSession: read,
    release: () => scratch.release(),
  };
}
