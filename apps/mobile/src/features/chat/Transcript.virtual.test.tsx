import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptItem } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { Transcript } from './Transcript';
import type { TranscriptHandle } from './Transcript';

const ROW_HEIGHT = 100;

function conversation(count: number): TranscriptItem[] {
  return Array.from({ length: count }, (_, i): TranscriptItem =>
    i % 2 === 0
      ? { kind: 'user', id: `u${i}`, text: `question ${i}`, delivery: 'sent' }
      : { kind: 'assistant', id: `a${i}`, text: `answer ${i}`, streaming: false },
  );
}

const mountedMessages = () => document.querySelectorAll('[data-testid^="msg-"]').length;

describe('Transcript windowing', () => {
  beforeEach(() => {
    // jsdom has no layout: every row measures as ROW_HEIGHT tall.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const isRow = this.tagName === 'LI' && this.dataset.rowKey !== undefined;
      return new DOMRect(0, 0, 320, isRow ? ROW_HEIGHT : 0);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts only the rows around the viewport of a 1000-message session', () => {
    render(
      <AppProviders>
        <Transcript items={conversation(1000)} onRetry={() => undefined} />
      </AppProviders>,
    );
    expect(mountedMessages()).toBeGreaterThan(0);
    expect(mountedMessages()).toBeLessThan(100);
    expect(document.querySelectorAll('*').length).toBeLessThan(5000);
    expect(screen.getByTestId('msg-user-0')).toHaveTextContent('question 0');
    expect(screen.queryByTestId('msg-assistant-999')).toBeNull();
  });

  it('pads the list with the height of the rows that are not mounted', () => {
    render(
      <AppProviders>
        <Transcript items={conversation(1000)} onRetry={() => undefined} />
      </AppProviders>,
    );
    const list = screen.getByTestId('session-messages');
    const bottom = parseFloat(list.style.paddingBottom);
    const mounted = list.children.length;
    // Every unmounted row is estimated or measured; the pad must account for most of them.
    expect(bottom).toBeGreaterThan((1000 - mounted - 5) * 60);
    expect(list.style.paddingTop).toBe('0px');
  });

  it('labels each mounted row with its position in the full transcript', () => {
    render(
      <AppProviders>
        <Transcript items={conversation(300)} onRetry={() => undefined} />
      </AppProviders>,
    );
    const first = screen.getByTestId('msg-user-0');
    expect(first).toHaveAttribute('aria-posinset', '1');
    expect(first).toHaveAttribute('aria-setsize', '300');
  });

  it('keeps bubble numbers when older rows are prepended', () => {
    const all = conversation(400);
    const { rerender } = render(
      <AppProviders>
        <Transcript items={all.slice(100)} onRetry={() => undefined} />
      </AppProviders>,
    );
    expect(screen.getByTestId('msg-user-0')).toHaveTextContent('question 100');
    rerender(
      <AppProviders>
        <Transcript items={all} onRetry={() => undefined} />
      </AppProviders>,
    );
    expect(screen.getByTestId('msg-user-0')).toHaveTextContent('question 0');
  });

  it('exposes scrollToKey for rows that are not mounted', () => {
    const handle = createRef<TranscriptHandle>();
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    render(
      <AppProviders>
        <Transcript ref={handle} items={conversation(500)} onRetry={() => undefined} />
      </AppProviders>,
    );
    expect(handle.current?.scrollToKey('assistant:a499', 24)).toBe(true);
    const [, y] = scrollTo.mock.calls.at(-1) as [number, number];
    expect(y).toBeGreaterThan(400 * 60);
    expect(handle.current?.scrollToKey('assistant:missing', 0)).toBe(false);
    vi.unstubAllGlobals();
  });
});
