import type { SessionMessage } from '@droidmobile/daemon-client';

export interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface TextBlock {
  type?: unknown;
  text?: unknown;
}

function textOf(message: SessionMessage): string {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }
  return (content as TextBlock[])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n\n')
    .trim();
}

/**
 * The daemon's history also carries hook records (empty content) and the
 * injected context message the agent receives; neither is something the user
 * wrote or read, so they are not part of the visible conversation.
 */
function isVisible(id: string, text: string): boolean {
  return text !== '' && !id.startsWith('context-') && !text.startsWith('<system-reminder>');
}

/** Turns raw daemon messages (any order) into the visible conversation, oldest first. */
export function toHistory(messages: readonly SessionMessage[]): HistoryMessage[] {
  const ordered = [...messages].sort(
    (a, b) => (a as { createdAt: number }).createdAt - (b as { createdAt: number }).createdAt,
  );
  const history: HistoryMessage[] = [];
  for (const message of ordered) {
    const role = (message as { role?: unknown }).role;
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }
    const id = String((message as { id?: unknown }).id ?? '');
    const text = textOf(message);
    if (isVisible(id, text)) {
      history.push({ id, role, text });
    }
  }
  return history;
}

/** Merges an older page (newest-first, as the daemon returns it) in front of the loaded messages. */
export function prependPage(
  loadedOldestFirst: readonly SessionMessage[],
  pageNewestFirst: readonly SessionMessage[],
): SessionMessage[] {
  const known = new Set(loadedOldestFirst.map((m) => String((m as { id?: unknown }).id)));
  const older = [...pageNewestFirst]
    .reverse()
    .filter((m) => !known.has(String((m as { id?: unknown }).id)));
  return [...older, ...loadedOldestFirst];
}
