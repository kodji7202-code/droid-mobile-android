import { describe, expect, it } from 'vitest';
import type { SessionMessage } from '@droidmobile/daemon-client';
import { prependPage, toHistory } from './history';

function msg(id: string, role: string, createdAt: number, text?: string): SessionMessage {
  return {
    id,
    role,
    createdAt,
    content: text === undefined ? [] : [{ type: 'text', text }],
  } as unknown as SessionMessage;
}

describe('toHistory', () => {
  it('orders oldest first and keeps only user and assistant text', () => {
    const raw = [
      msg('h2', 'user', 50),
      msg('a1', 'assistant', 40, 'OK'),
      msg('u1', 'user', 30, 'Reply with the single word OK'),
      msg('context-u1', 'user', 20, '<system-reminder>\nTools\n</system-reminder>'),
      msg('h1', 'user', 10),
      msg('t1', 'tool', 35, 'ignored'),
    ];
    expect(toHistory(raw)).toEqual([
      { id: 'u1', role: 'user', text: 'Reply with the single word OK' },
      { id: 'a1', role: 'assistant', text: 'OK' },
    ]);
  });

  it('joins multiple text blocks and skips non-text blocks', () => {
    const message = {
      id: 'a',
      role: 'assistant',
      createdAt: 1,
      content: [
        { type: 'text', text: 'one' },
        { type: 'tool_use', id: 'x' },
        { type: 'text', text: 'two' },
      ],
    } as unknown as SessionMessage;
    expect(toHistory([message])[0]?.text).toBe('one\n\ntwo');
  });
});

describe('prependPage', () => {
  it('puts an older newest-first page in front, oldest first, without duplicates', () => {
    const loaded = [msg('c', 'user', 3), msg('d', 'assistant', 4)];
    const page = [msg('c', 'user', 3), msg('b', 'assistant', 2), msg('a', 'user', 1)];
    const merged = prependPage(loaded, page).map((m) => (m as { id: string }).id);
    expect(merged).toEqual(['a', 'b', 'c', 'd']);
  });
});
