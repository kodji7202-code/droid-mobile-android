import { describe, expect, it } from 'vitest';
import type { SessionMessage } from '@factory/droid-sdk';
import type { NormalizedEvent } from './normalize';
import {
  addPendingUser,
  applyStreamEvent,
  failPendingUser,
  itemsFromMessages,
  localOnlyItems,
  markStopped,
  markToolsDenied,
  prependItems,
  reconcileLocalItems,
  settleTurn,
} from './transcript';
import type { TranscriptItem } from './transcript';

function msg(id: string, role: string, createdAt: number, content: unknown[]): SessionMessage {
  return { id, role, createdAt, content } as unknown as SessionMessage;
}
const text = (value: string) => [{ type: 'text', text: value }];

function replay(events: NormalizedEvent[], start: readonly TranscriptItem[] = []) {
  return events.reduce<readonly TranscriptItem[]>(applyStreamEvent, start);
}

describe('itemsFromMessages', () => {
  it('orders by time, hides hook and context messages and pairs tool results with their call', () => {
    const items = itemsFromMessages([
      msg('a2', 'assistant', 50, text('Done')),
      msg('r1', 'tool', 40, [
        { type: 'tool_result', toolUseId: 't1', content: 'notes.txt\ndata.csv', isError: false },
      ]),
      msg('a1', 'assistant', 30, [
        { type: 'tool_use', id: 't1', name: 'LS', input: { path: '.' } },
      ]),
      msg('u1', 'user', 20, text('List files')),
      msg('context-u1', 'user', 10, text('<system-reminder>x</system-reminder>')),
      msg('hook', 'user', 5, []),
    ]);
    expect(items).toEqual([
      { kind: 'user', id: 'u1', text: 'List files', delivery: 'sent' },
      {
        kind: 'tool',
        id: 't1',
        name: 'LS',
        input: { path: '.' },
        result: 'notes.txt\ndata.csv',
        status: 'completed',
      },
      { kind: 'assistant', id: 'a2', text: 'Done', streaming: false },
    ]);
  });

  it('marks error results and flattens array result content', () => {
    const items = itemsFromMessages([
      msg('a1', 'assistant', 1, [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
      msg('r1', 'tool', 2, [
        {
          type: 'tool_result',
          toolUseId: 't1',
          content: [{ type: 'text', text: 'ENOENT' }],
          isError: true,
        },
      ]),
    ]);
    expect(items[0]).toMatchObject({ kind: 'tool', status: 'error', result: 'ENOENT' });
  });
});

describe('applyStreamEvent', () => {
  it('shows the optimistic user bubble once and adopts the daemon id on echo', () => {
    const pending = addPendingUser([], 'local-1', 'hi');
    const echoed = replay(
      [{ type: 'user', message: msg('u9', 'user', 1, text('hi')) as never }],
      pending,
    );
    expect(echoed).toEqual([{ kind: 'user', id: 'u9', text: 'hi', delivery: 'sent' }]);
  });

  it('merges partial deltas into one assistant item and the final message replaces it', () => {
    const delta = (value: string): NormalizedEvent => ({
      type: 'assistant_text_delta',
      messageId: 'm1',
      blockIndex: 0,
      text: value,
    });
    const partial = replay([delta('Hel'), delta('lo')]);
    expect(partial).toEqual([
      { kind: 'assistant', id: 'm1', text: 'Hello', streaming: true, blocks: ['Hello'] },
    ]);
    const final = replay(
      [
        {
          type: 'assistant',
          messageId: 'm1',
          text: 'Hello!',
          message: msg('m1', 'assistant', 2, text('Hello!')) as never,
        },
      ],
      partial,
    );
    expect(final).toEqual([{ kind: 'assistant', id: 'm1', text: 'Hello!', streaming: false }]);
  });

  it('tracks a tool call from running to completed and error', () => {
    const items = replay([
      { type: 'tool_call_delta', toolName: 'unknown', toolUseId: '', input: {} },
      { type: 'tool_call', toolName: 'Read', toolUseId: 't1', input: { file_path: 'x' } },
      { type: 'tool_result', toolName: 'Read', toolUseId: 't1', content: 'nope', isError: true },
    ]);
    expect(items).toEqual([
      {
        kind: 'tool',
        id: 't1',
        name: 'Read',
        input: { file_path: 'x' },
        result: 'nope',
        status: 'error',
      },
    ]);
  });

  it('is idempotent: replaying the same events does not duplicate items', () => {
    const events: NormalizedEvent[] = [
      { type: 'user', message: msg('u1', 'user', 1, text('hi')) as never },
      {
        type: 'assistant',
        messageId: 'a1',
        text: 'OK',
        message: msg('a1', 'assistant', 2, text('OK')) as never,
      },
    ];
    expect(replay(events, replay(events))).toEqual(replay(events));
  });

  it('records daemon error events as visible items', () => {
    const items = replay([{ type: 'error', message: '400 status code (no body)' }]);
    expect(items).toEqual([{ kind: 'error', id: 'error-0', text: '400 status code (no body)' }]);
  });

  it('retracts an assistant message', () => {
    const items = replay([
      { type: 'assistant_text_delta', messageId: 'm1', blockIndex: 0, text: 'x' },
      { type: 'assistant_message_retracted', messageId: 'm1' },
    ]);
    expect(items).toEqual([]);
  });
});

describe('turn bookkeeping', () => {
  it('fails an unconfirmed message, keeps it across a reload and settles streaming text', () => {
    const items = failPendingUser(addPendingUser([], 'local-1', 'hi'), 'local-1');
    expect(items[0]).toMatchObject({ delivery: 'failed' });
    expect(localOnlyItems(items)).toHaveLength(1);
    const settled = settleTurn([
      { kind: 'assistant', id: 'm', text: 'par', streaming: true, blocks: ['par'] },
    ]);
    expect(settled).toEqual([{ kind: 'assistant', id: 'm', text: 'par', streaming: false }]);
  });

  it('prepends older items without duplicates', () => {
    const loaded = itemsFromMessages([
      msg('c', 'user', 3, text('c')),
      msg('d', 'assistant', 4, text('d')),
    ]);
    const older = itemsFromMessages([
      msg('b', 'assistant', 2, text('b')),
      msg('c', 'user', 3, text('c')),
    ]);
    expect(prependItems(loaded, older).map((item) => item.id)).toEqual(['b', 'c', 'd']);
  });
});

describe('interrupt and denial markers', () => {
  const assistant = (id: string, text: string): TranscriptItem => ({
    kind: 'assistant',
    id,
    text,
    streaming: false,
  });

  it('flags only the last assistant message as stopped and keeps its text', () => {
    const items: TranscriptItem[] = [assistant('a1', '1'), assistant('a2', '1\n2')];
    const next = markStopped(items);
    expect(next[0]).toEqual(assistant('a1', '1'));
    expect(next[1]).toMatchObject({ id: 'a2', text: '1\n2', stopped: true });
    expect(markStopped([])).toEqual([]);
  });

  it('keeps the denied status when the daemon then reports an error result', () => {
    const denied = markToolsDenied([], [{ id: 't1', name: 'Create', input: { file_path: 'x' } }]);
    expect(denied[0]).toMatchObject({ kind: 'tool', id: 't1', status: 'denied', name: 'Create' });
    const after = applyStreamEvent(denied, {
      type: 'tool_result',
      toolName: 'Create',
      toolUseId: 't1',
      content: 'cancelled',
      isError: true,
    });
    expect(after[0]).toMatchObject({ status: 'denied', result: 'cancelled' });
  });
});

describe('tool metadata across page boundaries', () => {
  it('keeps the call name and input when the result page was loaded first', () => {
    const newer = itemsFromMessages([
      msg('r1', 'tool', 20, [{ type: 'tool_result', toolUseId: 't1', content: 'ok' }]),
    ]);
    const older = itemsFromMessages([
      msg('a1', 'assistant', 10, [
        { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'x' } },
      ]),
    ]);
    const merged = prependItems(newer, older);
    expect(merged).toEqual([
      {
        kind: 'tool',
        id: 't1',
        name: 'Read',
        input: { path: 'x' },
        result: 'ok',
        status: 'completed',
      },
    ]);
  });
});

describe('reconcileLocalItems', () => {
  const sent = (id: string, text: string): TranscriptItem => ({
    kind: 'user',
    id,
    text,
    delivery: 'sent',
  });

  it('drops a failed local prompt that the daemon stored meanwhile', () => {
    const previous: TranscriptItem[] = [
      sent('u0', 'hi'),
      { kind: 'user', id: 'local-1', text: 'hello', delivery: 'failed' },
    ];
    const recovered = [sent('u0', 'hi'), sent('u1', 'hello')];
    expect(reconcileLocalItems(recovered, previous)).toEqual(recovered);
  });

  it('keeps a failed prompt whose text only matches an older sent message', () => {
    const previous: TranscriptItem[] = [
      sent('u0', 'ok'),
      { kind: 'user', id: 'local-1', text: 'ok', delivery: 'failed' },
    ];
    const recovered = [sent('u0', 'ok')];
    expect(reconcileLocalItems(recovered, previous).map((item) => item.id)).toEqual([
      'u0',
      'local-1',
    ]);
  });
});
