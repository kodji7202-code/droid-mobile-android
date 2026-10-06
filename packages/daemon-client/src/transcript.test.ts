import { describe, expect, it } from 'vitest';
import type { SessionMessage } from '@factory/droid-sdk';
import type { NormalizedEvent } from './normalize';
import {
  addPendingUser,
  appendError,
  appendTurnFailure,
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
  it('turns interrupt marker messages into the stopped flag, never a user bubble', () => {
    const items = itemsFromMessages([
      msg('u1', 'user', 1, text('Count to 100')),
      msg('a1', 'assistant', 2, text('1, 2, 3')),
      msg('m1', 'user', 3, text('Request cancelled by user')),
      msg('m2', 'user', 4, text('Request interrupted by user')),
      msg('u2', 'user', 5, text('Next')),
      msg('m3', 'user', 6, text('Request interrupted by user')),
    ]);
    expect(items).toEqual([
      { kind: 'user', id: 'u1', text: 'Count to 100', delivery: 'sent' },
      { kind: 'assistant', id: 'a1', text: '1, 2, 3', streaming: false, stopped: true },
      { kind: 'user', id: 'u2', text: 'Next', delivery: 'sent' },
    ]);
  });

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

describe('user attachments', () => {
  const png = { type: 'image', source: { type: 'base64', data: 'AAAA', mediaType: 'image/png' } };

  it('keeps stored images on the user message and shows an image-only message', () => {
    const items = itemsFromMessages([
      msg('u1', 'user', 1, [{ type: 'text', text: 'what colour?' }, png]),
      msg('u2', 'user', 2, [png]),
    ]);
    const image = { kind: 'image', mediaType: 'image/png', data: 'AAAA' };
    expect(items).toEqual([
      { kind: 'user', id: 'u1', text: 'what colour?', delivery: 'sent', attachments: [image] },
      { kind: 'user', id: 'u2', text: '', delivery: 'sent', attachments: [image] },
    ]);
  });

  it('drops the injected reminder block and restores stored documents as files', () => {
    const reminder = {
      type: 'text',
      text: '<system-reminder>Attached image paths</system-reminder>',
    };
    const doc = {
      type: 'document',
      source: { type: 'text', mediaType: 'text/plain', data: 'ZEBRA', name: 'token.txt' },
    };
    const items = itemsFromMessages([
      msg('u1', 'user', 1, [png, reminder, { type: 'text', text: 'colour?' }]),
      msg('u2', 'user', 2, [doc, { type: 'text', text: 'token?' }]),
    ]);
    expect(items).toMatchObject([
      { text: 'colour?', attachments: [{ kind: 'image' }] },
      {
        text: 'token?',
        attachments: [{ kind: 'file', name: 'token.txt', mediaType: 'text/plain', data: 'ZEBRA' }],
      },
    ]);
  });

  it('keeps the local attachments, including files, when the daemon echoes the message', () => {
    const attachments = [
      { kind: 'file' as const, name: 'token.txt', mediaType: 'text/plain', data: 'ZEBRA' },
    ];
    const pending = addPendingUser([], 'local-1', 'read it', attachments);
    expect(pending[0]).toMatchObject({ delivery: 'sending', attachments });
    const echoed = replay(
      [{ type: 'user', message: msg('u9', 'user', 1, text('read it')) as never }],
      pending,
    );
    expect(echoed).toEqual([
      {
        kind: 'user',
        id: 'u9',
        localId: 'local-1',
        text: 'read it',
        delivery: 'sent',
        attachments,
      },
    ]);
  });
});

describe('applyStreamEvent', () => {
  it('shows the optimistic user bubble once and adopts the daemon id on echo', () => {
    const pending = addPendingUser([], 'local-1', 'hi');
    const echoed = replay(
      [{ type: 'user', message: msg('u9', 'user', 1, text('hi')) as never }],
      pending,
    );
    expect(echoed).toEqual([
      { kind: 'user', id: 'u9', localId: 'local-1', text: 'hi', delivery: 'sent' },
    ]);
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

describe('thinking text', () => {
  it('accumulates thinking deltas on the assistant message and keeps them when the final text lands', () => {
    const streamed = replay([
      { type: 'thinking_text_delta', messageId: 'a1', blockIndex: 0, text: '17 times ' },
      { type: 'thinking_text_delta', messageId: 'a1', blockIndex: 0, text: '23 is 391.' },
      { type: 'thinking_text_complete', messageId: 'a1', blockIndex: 0 },
      { type: 'assistant_text_delta', messageId: 'a1', blockIndex: 1, text: '391' },
    ]);
    expect(streamed).toHaveLength(1);
    expect(streamed[0]).toMatchObject({ kind: 'assistant', thinking: '17 times 23 is 391.' });
    const finished = applyStreamEvent(streamed, {
      type: 'assistant',
      messageId: 'a1',
      text: '391',
      message: msg('a1', 'assistant', 1, text('391')) as never,
    });
    expect(finished[0]).toMatchObject({ text: '391', thinking: '17 times 23 is 391.' });
  });

  it('reads thinking blocks from stored messages and shows thinking-only messages', () => {
    const items = itemsFromMessages([
      msg('a1', 'assistant', 1, [
        { type: 'thinking', thinking: 'plan', signature: 's' },
        { type: 'text', text: 'ok' },
      ]),
      msg('a2', 'assistant', 2, [
        { type: 'thinking', thinking: 'more', signature: 's' },
        { type: 'tool_use', id: 't1', name: 'LS', input: {} },
      ]),
    ]);
    expect(items[0]).toMatchObject({ id: 'a1', text: 'ok', thinking: 'plan' });
    expect(items[1]).toMatchObject({ kind: 'assistant', id: 'a2', text: '', thinking: 'more' });
  });

  it('omits the thinking key when there is none', () => {
    const items = itemsFromMessages([msg('a1', 'assistant', 1, text('hi'))]);
    expect(items[0]).not.toHaveProperty('thinking');
  });
});

describe('appendTurnFailure', () => {
  const result = (over: Record<string, unknown> = {}) =>
    ({
      type: 'result',
      sessionId: 's1',
      subtype: 'error_during_execution',
      success: false,
      interrupted: false,
      durationMs: 1,
      text: '',
      turnCount: 0,
      tokenUsage: null,
      ...over,
    }) as NormalizedEvent & { type: 'result' };
  const pending = addPendingUser([], 'local-1', 'hi');

  it('adds an error with the subtype when the turn produced nothing', () => {
    const items = appendTurnFailure(pending, 'local-1', result());
    expect(items.at(-1)).toMatchObject({
      kind: 'error',
      text: expect.stringContaining('error_during_execution'),
    });
  });

  it('prefers the redacted result text', () => {
    const items = appendTurnFailure(pending, 'local-1', result({ text: 'bad token=abc123 here' }));
    const last = items.at(-1);
    expect(last?.kind === 'error' && last.text).toContain('[REDACTED]');
    expect(last?.kind === 'error' && last.text).not.toContain('abc123');
  });

  it('explains a failure after the daemon echoed the prompt and marks it for retry', () => {
    const echoed = applyStreamEvent(pending, {
      type: 'user',
      sessionId: 's1',
      message: msg('daemon-1', 'user', 5, text('hi')),
    } as unknown as NormalizedEvent);
    expect(echoed[0]).toMatchObject({ id: 'daemon-1', delivery: 'sent' });

    const items = failPendingUser(appendTurnFailure(echoed, 'local-1', result()), 'local-1');
    expect(items.at(-1)).toMatchObject({
      kind: 'error',
      text: expect.stringContaining('error_during_execution'),
    });
    expect(items[0]).toMatchObject({ kind: 'user', delivery: 'failed', text: 'hi' });
  });

  it('leaves successful, interrupted and answered turns unchanged', () => {
    expect(appendTurnFailure(pending, 'local-1', result({ success: true }))).toEqual(pending);
    expect(appendTurnFailure(pending, 'local-1', result({ interrupted: true }))).toEqual(pending);
    const answered = [...pending, { kind: 'assistant', id: 'a', text: 'ok' } as TranscriptItem];
    expect(appendTurnFailure(answered, 'local-1', result())).toEqual(answered);
    const errored = appendError(pending, 'boom');
    expect(appendTurnFailure(errored, 'local-1', result())).toEqual(errored);
  });
});

describe('custom slash commands', () => {
  const echo = (text: string): NormalizedEvent => ({
    type: 'user',
    message: msg('u9', 'user', 1, [{ type: 'text', text }]) as never,
  });
  const expanded =
    '<system-notification>\nReply with the single word OK.\n\n</system-notification>';

  it('settles the pending bubble when the daemon echoes "/<name> is running"', () => {
    const pending = addPendingUser([], 'local-1', '/val-hello');
    expect(replay([echo('/val-hello is running')], pending)).toEqual([
      {
        kind: 'user',
        id: 'u9',
        localId: 'local-1',
        text: '/val-hello is running',
        delivery: 'sent',
      },
    ]);
  });

  it('matches a command sent with arguments and ignores a different command name', () => {
    const withArgs = addPendingUser([], 'local-1', '/review main branch');
    expect(replay([echo('/review is running')], withArgs)[0]).toMatchObject({
      delivery: 'sent',
      id: 'u9',
    });
    const other = addPendingUser([], 'local-1', '/review');
    const result = replay([echo('/val-hello is running')], other);
    expect(result.map((item) => (item as { delivery: string }).delivery).sort()).toEqual([
      'sending',
      'sent',
    ]);
  });

  it('does not treat plain text that merely looks like an echo as a command', () => {
    const pending = addPendingUser([], 'local-1', 'review is running');
    expect(replay([echo('/review is running')], pending)).toHaveLength(2);
  });

  it('settles a pending command bubble from the streamed body, which arrives without an echo', () => {
    const pending = addPendingUser([], 'local-1', '/val-hello topic');
    const live = replay([echo(expanded)], pending);
    expect(live).toEqual([
      {
        kind: 'user',
        id: 'command-u9',
        localId: 'local-1',
        text: '/val-hello is running',
        delivery: 'sent',
      },
      {
        kind: 'user',
        id: 'u9',
        text: 'Reply with the single word OK.',
        delivery: 'sent',
        notice: true,
      },
    ]);
  });

  it('leaves a pending plain message alone when a notification arrives', () => {
    const pending = addPendingUser([], 'local-1', 'hello');
    expect(replay([echo(expanded)], pending)[0]).toMatchObject({ delivery: 'sending' });
  });
  it('shows the expanded command prompt as a notice without its wrapper', () => {
    const items = itemsFromMessages([
      msg('u1', 'user', 1, text('/val-hello is running')),
      msg('n1', 'user', 2, text(expanded)),
      msg('a1', 'assistant', 3, text('OK')),
    ]);
    expect(items).toEqual([
      { kind: 'user', id: 'u1', text: '/val-hello is running', delivery: 'sent' },
      {
        kind: 'user',
        id: 'n1',
        text: 'Reply with the single word OK.',
        delivery: 'sent',
        notice: true,
      },
      { kind: 'assistant', id: 'a1', text: 'OK', streaming: false },
    ]);
  });

  it('drops a lost-echo local command bubble once the daemon stored its echo', () => {
    const previous: TranscriptItem[] = [
      { kind: 'user', id: 'local-1', text: '/val-hello', delivery: 'failed' },
    ];
    const recovered = itemsFromMessages([msg('u1', 'user', 1, text('/val-hello is running'))]);
    expect(reconcileLocalItems(recovered, previous)).toEqual(recovered);
  });
});
