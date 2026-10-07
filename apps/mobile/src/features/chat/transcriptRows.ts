import type { TranscriptItem } from '@droidmobile/daemon-client';

/** One rendered row of the transcript with the ordinal its test id carries. */
export interface TranscriptRow {
  /** Stable across prepends and streaming updates; the virtualiser caches measured heights by it. */
  key: string;
  item: TranscriptItem;
  /** Position among the rows that share a counter: bubbles, errors or command notices. */
  n: number;
}

/** Numbers every row up front so a row keeps its `msg-*-<n>` id whether or not it is mounted. */
export function buildRows(items: readonly TranscriptItem[]): TranscriptRow[] {
  let bubbles = 0;
  let errors = 0;
  let notices = 0;
  return items.map((item): TranscriptRow => {
    switch (item.kind) {
      case 'tool':
        return { key: `tool:${item.id}`, item, n: 0 };
      case 'error':
        return { key: `error:${item.id}`, item, n: errors++ };
      case 'user':
        return item.notice
          ? { key: `notice:${item.id}`, item, n: notices++ }
          : { key: `user:${item.id}`, item, n: bubbles++ };
      case 'assistant':
        return { key: `assistant:${item.id}`, item, n: bubbles++ };
    }
  });
}

const CHARS_PER_LINE = 36;
const LINE_HEIGHT = 24;
const BUBBLE_CHROME = 36;
const MAX_ESTIMATE = 1600;

const textHeight = (text: string, chrome: number): number => {
  const lines = text
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);
  return Math.min(MAX_ESTIMATE, chrome + lines * LINE_HEIGHT);
};

/** First-paint guess for a row that has not been measured yet; the real height replaces it. */
export function estimateRowHeight(row: TranscriptRow): number {
  const { item } = row;
  switch (item.kind) {
    case 'tool':
      return 52;
    case 'error':
      return textHeight(item.text, BUBBLE_CHROME);
    case 'user':
      return textHeight(item.text, BUBBLE_CHROME) + (item.attachments?.length ? 96 : 0);
    case 'assistant':
      return textHeight(item.text, BUBBLE_CHROME) + (item.thinking ? 44 : 0);
  }
}
