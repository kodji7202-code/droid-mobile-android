/**
 * Per-session transcript model: an append-only list of items built from the
 * daemon's stored messages and kept current by merging stream events.
 * Items are keyed by the daemon's message / tool-use ids, so replaying the same
 * event or re-reading history never produces duplicates. Pure functions only.
 */
import type { SessionMessage } from '@factory/droid-sdk';
import type { NormalizedEvent } from './normalize';
import { redactSecrets } from './redact';

export type UserDelivery = 'sending' | 'sent' | 'failed';
export type ToolStatus = 'running' | 'completed' | 'error' | 'denied';

/** An image (base64) or file the user sent with a message. */
export type UserAttachment =
  | { kind: 'image'; mediaType: string; data: string }
  | { kind: 'file'; name: string; mediaType: string; data: string };

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  delivery: UserDelivery;
  /** Absent when the message carried none. */
  attachments?: UserAttachment[];
}

export interface AssistantItem {
  kind: 'assistant';
  id: string;
  text: string;
  streaming: boolean;
  /** True when the user interrupted the turn that produced this message. */
  stopped?: boolean;
  /** Partial text per content block while streaming; dropped when the final message lands. */
  blocks?: string[];
  /** The model's reasoning text, when the turn produced any. */
  thinking?: string;
  /** Partial thinking per content block while streaming; dropped when the turn settles. */
  thinkingBlocks?: string[];
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
  thinking?: unknown;
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

function attachmentsOfBlocks(blocks: readonly Block[]): UserAttachment[] {
  const found: UserAttachment[] = [];
  for (const block of blocks) {
    const source = (block as { source?: { data?: unknown; mediaType?: unknown; name?: unknown } })
      .source;
    if (typeof source?.data !== 'string') continue;
    const mediaType = typeof source.mediaType === 'string' ? source.mediaType : '';
    if (block?.type === 'image') {
      found.push({ kind: 'image', mediaType: mediaType || 'image/png', data: source.data });
    } else if (block?.type === 'document') {
      const name = typeof source.name === 'string' ? source.name : '';
      found.push({ kind: 'file', name, mediaType, data: source.data });
    }
  }
  return found;
}

/** The daemon prepends <system-reminder> text blocks (e.g. image paths) to the user's own text. */
const isReminderBlock = (block: Block) =>
  block?.type === 'text' &&
  typeof block.text === 'string' &&
  block.text.startsWith('<system-reminder>');

function thinkingOfBlocks(blocks: readonly Block[]): string {
  return blocks
    .filter((block) => block?.type === 'thinking' && typeof block.thinking === 'string')
    .map((block) => block.thinking as string)
    .join('\n\n')
    .trim();
}

function findAssistant(items: readonly TranscriptItem[], id: string): AssistantItem | undefined {
  return items.find((item): item is AssistantItem => item.kind === 'assistant' && item.id === id);
}

function idOf(message: unknown): string {
  return String((message as { id?: unknown } | undefined)?.id ?? '');
}

/** The daemon also stores the injected context message the agent receives; it is not conversation. */
export function isHiddenUserMessage(id: string, text: string): boolean {
  return text === '' || id.startsWith('context-') || text.startsWith('<system-reminder>');
}

/** After an interrupt the daemon stores these as user messages; they are not something the user typed. */
const INTERRUPT_MARKERS = new Set(['Request cancelled by user', 'Request interrupted by user']);

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
    const text = textOfBlocks(blocks.filter((block) => !isReminderBlock(block)));
    const images = attachmentsOfBlocks(blocks);
    if (isHiddenUserMessage(id, text) && !(text === '' && images.length > 0)) return next;
    if (INTERRUPT_MARKERS.has(text)) {
      // Only the turn being cut short is flagged, not an earlier answered one.
      const lastTalk = [...next].reverse().find((item) => item.kind !== 'tool');
      return lastTalk?.kind === 'assistant' ? markStopped(next) : next;
    }
    const pending = next.findIndex(
      (item) => item.kind === 'user' && item.delivery === 'sending' && item.text === text,
    );
    const local = pending === -1 ? undefined : (next[pending] as UserItem).attachments;
    // The daemon only echoes images; files the user attached exist only on this device.
    const attachments = local ?? images;
    const sent: UserItem = {
      kind: 'user',
      id,
      text,
      delivery: 'sent',
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    if (pending !== -1) {
      const copy = next.slice();
      copy[pending] = sent;
      return copy;
    }
    return upsert(next, sent);
  }
  if (role === 'assistant') {
    const text = textOfBlocks(blocks);
    const thinking = thinkingOfBlocks(blocks) || findAssistant(next, id)?.thinking || '';
    // Tool-use blocks come first in arrival order when a message carries both.
    if (text !== '' || thinking !== '') {
      next = upsert(next, {
        kind: 'assistant',
        id,
        text,
        streaming: false,
        ...(thinking === '' ? {} : { thinking }),
      });
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
  const loadedTools = new Map(
    loaded.filter((item): item is ToolItem => item.kind === 'tool').map((item) => [item.id, item]),
  );
  const mergedIds = new Set<string>();
  const known = new Set(loaded.map((item) => `${item.kind}:${item.id}`));
  const front: TranscriptItem[] = [];
  for (const item of older) {
    const key = `${item.kind}:${item.id}`;
    const twin = item.kind === 'tool' ? loadedTools.get(item.id) : undefined;
    if (item.kind === 'tool' && twin) {
      // A call and its result can sit on different pages; each page only knows its half.
      front.push(mergeTools(item, twin));
      mergedIds.add(item.id);
    } else if (!known.has(key)) {
      front.push(item);
    }
  }
  const rest = loaded.filter((item) => !(item.kind === 'tool' && mergedIds.has(item.id)));
  return [...front, ...rest];
}

const isPlaceholderTool = (tool: ToolItem) =>
  tool.name === 'tool' && Object.keys(tool.input).length === 0;

/** `older` comes from the earlier page; the call half wins for name/input, the result half for outcome. */
function mergeTools(older: ToolItem, loaded: ToolItem): ToolItem {
  const callSide = isPlaceholderTool(older) ? loaded : older;
  const resultSide = loaded.result !== undefined || older.result === undefined ? loaded : older;
  return {
    kind: 'tool',
    id: older.id,
    name: callSide.name,
    input: callSide.input,
    result: resultSide.result,
    status: resultSide.status,
  };
}

/**
 * Re-attaches this device's unsent user bubbles to freshly recovered history. A
 * bubble whose prompt the daemon stored after it was last known (the echo was
 * lost) is dropped so it is neither shown twice nor offered for retry.
 */
export function reconcileLocalItems(
  recovered: readonly TranscriptItem[],
  previous: readonly TranscriptItem[],
): TranscriptItem[] {
  const knownIds = new Set(
    previous.filter((item) => item.kind === 'user' && item.delivery === 'sent').map((i) => i.id),
  );
  const claimed = new Set<string>();
  const local = localOnlyItems(previous).filter((item) => {
    if (item.kind !== 'user') return true;
    const match = recovered.find(
      (candidate) =>
        candidate.kind === 'user' &&
        candidate.text === item.text &&
        !knownIds.has(candidate.id) &&
        !claimed.has(candidate.id),
    );
    if (match) claimed.add(match.id);
    return !match;
  });
  return [...recovered, ...local];
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
  attachments: readonly UserAttachment[] = [],
): TranscriptItem[] {
  return [
    ...items,
    {
      kind: 'user',
      id: localId,
      text,
      delivery: 'sending',
      ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
    },
  ];
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
      const { blocks: _blocks, thinkingBlocks: _thinking, ...rest } = item;
      return { ...rest, streaming: false };
    }
    return item;
  });
}

/** Flags the last assistant message as cut short by an interrupt. */
export function markStopped(items: readonly TranscriptItem[]): TranscriptItem[] {
  let index = items.length - 1;
  while (index >= 0 && items[index]!.kind !== 'assistant') index -= 1;
  if (index < 0) return [...items];
  const next = items.slice();
  next[index] = { ...(items[index] as AssistantItem), stopped: true };
  return next;
}

/** Marks tool calls the user refused; a later error result keeps the denied status. */
export function markToolsDenied(
  items: readonly TranscriptItem[],
  tools: readonly { id: string; name: string; input: Record<string, unknown> }[],
): TranscriptItem[] {
  return tools.reduce<TranscriptItem[]>(
    (acc, tool) => withTool(acc, { ...tool, status: 'denied' }),
    items as TranscriptItem[],
  );
}

export function appendError(items: readonly TranscriptItem[], text: string): TranscriptItem[] {
  return [...items, { kind: 'error', id: `error-${items.length}`, text }];
}

/**
 * Explains a turn that ended with success: false and left nothing visible
 * after the user's message, so it does not settle as a silent "Not sent".
 */
export function appendTurnFailure(
  items: readonly TranscriptItem[],
  localId: string,
  result: Extract<NormalizedEvent, { type: 'result' }>,
): TranscriptItem[] {
  const start = items.findIndex((item) => item.id === localId);
  const visible = start >= 0 && items.slice(start + 1).some((item) => item.kind !== 'user');
  if (result.success || result.interrupted || start < 0 || visible) return [...items];
  const reason = redactSecrets(result.text.trim() || result.subtype);
  return appendError(items, reason);
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
      const existing = findAssistant(items, event.messageId);
      const blocks = [...(existing?.blocks ?? [])];
      blocks[event.blockIndex] = (blocks[event.blockIndex] ?? '') + event.text;
      const text = Array.from(blocks, (block) => block ?? '').join('\n\n');
      return upsert(items as TranscriptItem[], {
        ...existing,
        kind: 'assistant',
        id: event.messageId,
        text,
        streaming: true,
        blocks,
      });
    }
    case 'thinking_text_delta': {
      const existing = findAssistant(items, event.messageId);
      const thinkingBlocks = [...(existing?.thinkingBlocks ?? [])];
      thinkingBlocks[event.blockIndex] = (thinkingBlocks[event.blockIndex] ?? '') + event.text;
      return upsert(items as TranscriptItem[], {
        text: '',
        ...existing,
        kind: 'assistant',
        id: event.messageId,
        streaming: true,
        thinking: Array.from(thinkingBlocks, (block) => block ?? '').join('\n\n'),
        thinkingBlocks,
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
        status:
          findTool(items, event.toolUseId)?.status === 'denied'
            ? 'denied'
            : event.isError
              ? 'error'
              : 'completed',
      });
    case 'error':
      return appendError(items, event.message);
    default:
      return items;
  }
}
