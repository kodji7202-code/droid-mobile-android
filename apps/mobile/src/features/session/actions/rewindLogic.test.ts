import { describe, expect, it, vi } from 'vitest';
import type { RewindInfo, SessionHandle, SessionMessage } from '@droidmobile/daemon-client';
import {
  defaultRewindTitle,
  hasFileChanges,
  loadAllMessages,
  rewindEntries,
  rewindParams,
  truncatePreview,
} from './rewindLogic';

const message = (id: string, role: string, ...texts: string[]) =>
  ({
    id,
    role,
    content: texts.map((text) => ({ type: 'text', text })),
  }) as unknown as SessionMessage;

describe('rewindEntries', () => {
  it('lists one entry per user message, oldest first, with a text preview', () => {
    const newestFirst = [
      message('a2', 'assistant', 'done'),
      message('u2', 'user', 'Reply with the single word OK'),
      message('a1', 'assistant', 'hi'),
      message('t1', 'tool', 'output'),
      message('u1', 'user', '<system-reminder>ignore</system-reminder>', 'Create hello.txt'),
      message('context-u1', 'user', '<system-reminder>context</system-reminder>'),
    ];
    const entries = rewindEntries(newestFirst);
    expect(entries.map((e) => e.id)).toEqual(['context-u1', 'u1', 'u2']);
    expect(entries.map((e) => e.preview)).toEqual([
      '',
      'Create hello.txt',
      'Reply with the single word OK',
    ]);
    expect(entries.map((e) => e.context)).toEqual([true, false, false]);
  });

  it('truncates long previews on one line', () => {
    expect(truncatePreview('a\n\n  b'.padEnd(300, 'x')).length).toBeLessThanOrEqual(140);
    expect(truncatePreview('a\n\n  b')).toBe('a b');
  });
});

describe('rewind helpers', () => {
  const info: RewindInfo = {
    availableFiles: [{ filePath: 'a.txt', contentHash: 'h', size: 3 }],
    createdFiles: [{ filePath: 'hello.txt' }],
    evictedFiles: [{ filePath: 'old.txt', reason: 'too large' }],
  };

  it('detects whether a rewind touches files', () => {
    expect(hasFileChanges(info)).toBe(true);
    expect(hasFileChanges({ availableFiles: [], createdFiles: [], evictedFiles: [] })).toBe(false);
    expect(
      hasFileChanges({
        availableFiles: [],
        createdFiles: [],
        evictedFiles: [{ filePath: 'x', reason: 'r' }],
      }),
    ).toBe(false);
  });

  it('sends exactly the displayed files and the entered title', () => {
    expect(rewindParams('u1', info, 'My title')).toEqual({
      messageId: 'u1',
      filesToRestore: info.availableFiles,
      filesToDelete: info.createdFiles,
      forkTitle: 'My title',
    });
  });

  it('prefixes a default title and keeps it non-empty', () => {
    expect(defaultRewindTitle('Create hello.txt', 'Rewind')).toBe('Rewind: Create hello.txt');
    expect(defaultRewindTitle('', 'Rewind')).toBe('Rewind');
  });
});

describe('loadAllMessages', () => {
  it('follows the cursor until the last page', async () => {
    const pages = [
      { messages: [message('3', 'user', 'c')], hasMore: true, nextCursor: '3' },
      { messages: [message('2', 'user', 'b')], hasMore: true, nextCursor: '2' },
      { messages: [message('1', 'user', 'a')], hasMore: false, nextCursor: '1' },
    ];
    const getMessages = vi.fn(async () => pages.shift()!);
    const all = await loadAllMessages({ getMessages } as unknown as SessionHandle);
    expect(all.map((m) => (m as { id: string }).id)).toEqual(['3', '2', '1']);
    expect(getMessages).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: '3' }));
  });
});
