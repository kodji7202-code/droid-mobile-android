import type {
  RewindInfo,
  RewindParams,
  SessionHandle,
  SessionMessage,
} from '@droidmobile/daemon-client';

const PREVIEW_LENGTH = 140;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

export interface RewindEntry {
  id: string;
  /** User-typed text on one line; empty for the injected session-context message. */
  preview: string;
  /** The daemon's injected context message (stored as a user message, not typed). */
  context: boolean;
}

interface Block {
  type?: unknown;
  text?: unknown;
}

export function truncatePreview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_LENGTH ? `${oneLine.slice(0, PREVIEW_LENGTH - 1)}…` : oneLine;
}

function typedText(message: SessionMessage): string {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return (content as Block[])
    .filter(
      (block) =>
        block?.type === 'text' &&
        typeof block.text === 'string' &&
        !block.text.startsWith('<system-reminder>'),
    )
    .map((block) => block.text as string)
    .join(' ');
}

/**
 * One entry per `role=user` message, oldest first. `messages` is in daemon
 * order (newest first).
 */
export function rewindEntries(messages: readonly SessionMessage[]): RewindEntry[] {
  const entries: RewindEntry[] = [];
  for (const message of messages) {
    const { id, role } = message as { id?: unknown; role?: unknown };
    if (role !== 'user' || typeof id !== 'string') continue;
    const preview = truncatePreview(typedText(message));
    entries.push({ id, preview, context: id.startsWith('context-') || preview === '' });
  }
  return entries.reverse();
}

/** Every stored message of the session, newest first. */
export async function loadAllMessages(handle: SessionHandle): Promise<SessionMessage[]> {
  const all: SessionMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await handle.getMessages({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    all.push(...result.messages);
    if (!result.hasMore || result.nextCursor === undefined) break;
    cursor = result.nextCursor;
  }
  return all;
}

/** True when the rewind would restore or delete at least one file. */
export function hasFileChanges(info: RewindInfo): boolean {
  return info.availableFiles.length > 0 || info.createdFiles.length > 0;
}

/** The request for exactly the files the sheet displayed. */
export function rewindParams(messageId: string, info: RewindInfo, forkTitle: string): RewindParams {
  return {
    messageId,
    filesToRestore: info.availableFiles,
    filesToDelete: info.createdFiles,
    forkTitle,
  };
}

export function defaultRewindTitle(preview: string, prefix: string): string {
  return preview === '' ? prefix : `${prefix}: ${preview}`;
}
