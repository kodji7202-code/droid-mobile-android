import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '@droidmobile/daemon-client';
import { buildRows, estimateRowHeight } from './transcriptRows';

const user = (id: string, text = 'hi', extra: Partial<TranscriptItem> = {}): TranscriptItem =>
  ({ kind: 'user', id, text, delivery: 'sent', ...extra }) as TranscriptItem;
const assistant = (id: string, text = 'hello'): TranscriptItem => ({
  kind: 'assistant',
  id,
  text,
  streaming: false,
});

describe('buildRows', () => {
  it('numbers bubbles, errors and notices independently and in order', () => {
    const rows = buildRows([
      user('u1'),
      { kind: 'tool', id: 't1', name: 'Read', input: {}, status: 'completed' },
      assistant('a1'),
      { kind: 'error', id: 'e1', text: 'boom' },
      user('n1', '/cmd', { notice: true }),
      user('u2'),
      { kind: 'error', id: 'e2', text: 'again' },
    ]);
    expect(rows.map((row) => [row.key, row.n])).toEqual([
      ['user:u1', 0],
      ['tool:t1', 0],
      ['assistant:a1', 1],
      ['error:e1', 0],
      ['notice:n1', 0],
      ['user:u2', 2],
      ['error:e2', 1],
    ]);
  });

  it('keeps the key and number of a row when older items are prepended', () => {
    const tail = [user('u9'), assistant('a9')];
    const before = buildRows(tail);
    const after = buildRows([user('u1'), assistant('a1'), ...tail]);
    expect(after.slice(2).map((row) => row.key)).toEqual(before.map((row) => row.key));
    expect(after.slice(2).map((row) => row.n)).toEqual([2, 3]);
  });
});

describe('estimateRowHeight', () => {
  it('grows with text length and stays bounded', () => {
    const [short] = buildRows([assistant('a', 'short')]);
    const [long] = buildRows([assistant('b', 'word '.repeat(400))]);
    const [huge] = buildRows([assistant('c', 'x'.repeat(200_000))]);
    expect(estimateRowHeight(long!)).toBeGreaterThan(estimateRowHeight(short!));
    expect(estimateRowHeight(huge!)).toBeLessThanOrEqual(1600 + 44);
  });

  it('counts blank lines and attachments', () => {
    const [plain] = buildRows([user('a', 'a\n\n\nb')]);
    const [one] = buildRows([user('b', 'ab')]);
    const [withFile] = buildRows([
      user('c', 'ab', { attachments: [{ kind: 'image' }] } as Partial<TranscriptItem>),
    ]);
    expect(estimateRowHeight(plain!)).toBeGreaterThan(estimateRowHeight(one!));
    expect(estimateRowHeight(withFile!)).toBeGreaterThan(estimateRowHeight(one!));
  });
});
