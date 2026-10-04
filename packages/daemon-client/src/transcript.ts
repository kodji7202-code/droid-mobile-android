/**
 * Per-session transcript model: an append-only list of items built from the
 * daemon's stored messages and kept current by merging stream events.
 * Items are keyed by the daemon's message / tool-use ids, so replaying the same
 * event or re-reading history never produces duplicates. Pure functions only.
 */
import type { SessionMessage } from '@factory/droid-sdk';
import type { NormalizedEvent } from './normalize';

export type UserDelivery = 'sending' | 'sent' | 'failed';
export type ToolStatus = 'running' | 'completed' | 'error';

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  delivery: UserDelivery;
}

export interface AssistantItem {
  kind: 'assistant';
  id: string;
  text: string;
  streaming: boolean;
  /** Partial text per content block while streaming; dropped when the final message lands. */
  blocks?: string[];
}

export interface ToolItem {
  kind: 'tool';
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  status: ToolStatus;
}

export interface ErrorItem {
  kind: 'error';
  id: string;
  text: string;
}

export type TranscriptItem = UserItem | AssistantItem | ToolItem | ErrorItem;

interface Block {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  toolUseId?: unknown;
  content?: unknown;
  isError?: unknown;
}

function blocksOf(message: unknown): Block[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? (content as Block[]) : [];
}

function textOfBlocks(blocks: readonly Block[]): string {
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n\n')
    .trim();
}

function idOf(message: unknown): string {
  return String((message as { id?: unknown } | undefined)?.id ?? '');
}

/** The daemon also stores the injected context message the agent receives; it is not conversation. */
export function isHiddenUserMessage(id: string, text: string): boolean {
  return text === '' || id.startsWith('context-') || text.startsWith('<system-reminder>');
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.map((part) =>
      typeof part === 'object' && part !== null && typeof (part as Block).text === 'string'
        ? ((part as Block).text as string)
        : JSON.stringify(part),
    );
    return parts.join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function asInput(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function upsert(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const index = items.findIndex(
    (existing) => existing.kind === item.kind && existing.id === item.id,
  );
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}

function findTool(items: readonly TranscriptItem[], id: string): ToolItem | undefined {
  return items.find((item): item is ToolItem => item.kind === 'tool' && item.id === id);
}

function withTool(
  items: TranscriptItem[],
  update: Partial<ToolItem> & { id: string },
): TranscriptItem[] {
  const existing = findTool(items, update.id);
  const merged: ToolItem = {
    kind: 'tool',
    name: 'tool',
    input: {},
    status: 'running',
    ...existing,
    ...update,
  };
  return upsert(items, merged);
}

/** Applies one stored message (any role) to the list. */
function applyMessage(items: TranscriptItem[], message: SessionMessage): TranscriptItem[] {
  const role = (message as { role?: unknown }).role;
  const id = idOf(message);
  const blocks = blocksOf(message);
  let next = items;
  if (role === 'user') {
    const text = textOfBlocks(blocks);
    if (isHiddenUserMessage(id, text)) return next;
    const pending = next.findIndex(
      (item) => item.kind === 'user' && item.delivery === 'sending' && item.text === text,
    );
    if (pending !== -1) {
      const copy = next.slice();
      copy[pending] = { kind: 'user', id, text, delivery: 'sent' };
      return copy;
    }
    return upsert(next, { kind: 'user', id, text, delivery: 'sent' });
  }
  if (role === 'assistant') {
    const text = textOfBlocks(blocks);
    // Tool-use blocks come first in arrival order when a message carries both.
    if (text !== '') {
      next = upsert(next, { kind: 'assistant', id, text, streaming: false });
    }
    for (const block of blocks) {
      if (block?.type === 'tool_use' && typeof block.id === 'string') {
        next = withTool(next, {
          id: block.id,
          name: typeof block.name === 'string' ? block.name : 'tool',
          input: asInput(block.input),
        });
      }
    }
    return next;
  }
  if (role === 'tool') {
    for (const block of blocks) {
      if (block?.type === 'tool_result' && typeof block.toolUseId === 'string') {
        const failed = block.isError === true;
        next = withTool(next, {
          id: block.toolUseId,
          result: resultText(block.content),
          status: failed ? 'error' : 'completed',
        });
      }
    }
  }
  return next;
}

/** Builds the transcript from stored daemon messages (any order). */
export function itemsFromMessages(messages: readonly SessionMessage[]): TranscriptItem[] {
  const ordered = [...messages].sort(
    (a, b) => (a as { createdAt: number }).createdAt - (b as { createdAt: number }).createdAt,
  );
  return ordered.reduce<TranscriptItem[]>(applyMessage, []);
}

/** Puts an older page in front of the loaded items, skipping anything already known. */
export function prependItems(
  loaded: readonly TranscriptItem[],
  older: readonly TranscriptItem[],
): TranscriptItem[] {
  const known = new Set(loaded.map((item) => `${item.kind}:${item.id}`));
  return [...older.filter((item) => !known.has(`${item.kind}:${item.id}`)), ...loaded];
}

/** Items that exist only on this device and must survive a reload from the daemon. */
export function localOnlyItems(items: readonly TranscriptItem[]): TranscriptItem[] {
  return items.filter(
    (item) => item.kind === 'error' || (item.kind === 'user' && item.delivery !== 'sent'),
  );
}

/** Adds the optimistic user bubble for a message that is about to be sent. */
export function addPendingUser(
  items: readonly TranscriptItem[],
  localId: string,
  text: string,
): TranscriptItem[] {
  return [...items, { kind: 'user', id: localId, text, delivery: 'sending' }];
}

export function removeItem(items: readonly TranscriptItem[], id: string): TranscriptItem[] {
  return items.filter((item) => item.id !== id);
}

/** Marks an unconfirmed user message as failed so the UI can offer a retry. */
export function failPendingUser(
  items: readonly TranscriptItem[],
  localId: string,
): TranscriptItem[] {
  return items.map((item) =>
    item.kind === 'user' && item.id === localId && item.delivery === 'sending'
      ? { ...item, delivery: 'failed' }
      : item,
  );
}

/** Ends the live turn: nothing is streaming any more and no tool is left running. */
export function settleTurn(items: readonly TranscriptItem[]): TranscriptItem[] {
  return items.map((item) => {
    if (item.kind === 'assistant' && item.streaming) {
      const { blocks: _blocks, ...rest } = item;
      return { ...rest, streaming: false };
    }
    return item;
  });
}

export function appendError(items: readonly TranscriptItem[], text: string): TranscriptItem[] {
  return [...items, { kind: 'error', id: `error-${items.length}`, text }];
}

/** Merges one stream event into the transcript. Unrelated events return the same array. */
export function applyStreamEvent(
  items: readonly TranscriptItem[],
  event: NormalizedEvent,
): readonly TranscriptItem[] {
  switch (event.type) {
    case 'user':
    case 'assistant':
      return applyMessage(items as TranscriptItem[], event.message as SessionMessage);
    case 'assistant_text_delta': {
      const existing = items.find(
        (item): item is AssistantItem => item.kind === 'assistant' && item.id === event.messageId,
      );
      const blocks = [...(existing?.blocks ?? [])];
      blocks[event.blockIndex] = (blocks[event.blockIndex] ?? '') + event.text;
      const text = Array.from(blocks, (block) => block ?? '').join('\n\n');
      return upsert(items as TranscriptItem[], {
        kind: 'assistant',
        id: event.messageId,
        text,
        streaming: true,
        blocks,
      });
    }
    case 'assistant_message_retracted':
      return items.filter((item) => !(item.kind === 'assistant' && item.id === event.messageId));
    case 'tool_call':
    case 'tool_call_delta':
      if (event.toolUseId === '') return items;
      return withTool(items as TranscriptItem[], {
        id: event.toolUseId,
        name: event.toolName,
        input: event.input,
      });
    case 'tool_result':
      return withTool(items as TranscriptItem[], {
        id: event.toolUseId,
        ...(event.toolName === 'unknown' ? {} : { name: event.toolName }),
        result: resultText(event.content),
        status: event.isError ? 'error' : 'completed',
      });
    case 'error':
      return appendError(items, event.message);
    default:
      return items;
  }
}
