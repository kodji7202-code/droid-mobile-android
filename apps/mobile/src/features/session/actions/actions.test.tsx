import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExecuteRewindResultSchema } from '@factory/droid-sdk';
import type {
  RewindInfo,
  RewindResult,
  SessionHandle,
  SessionMessage,
} from '@droidmobile/daemon-client';
import { AppProviders } from '../../../test/render-app';
import { CompactSheet } from './CompactSheet';
import { ForkSheet } from './ForkSheet';
import { RewindResultView } from './RewindResultView';
import { RewindSheet } from './RewindSheet';

const message = (id: string, role: string, text: string) =>
  ({ id, role, content: [{ type: 'text', text }] }) as unknown as SessionMessage;

function wrap(ui: React.ReactElement) {
  return render(<AppProviders>{ui}</AppProviders>);
}

describe('ForkSheet', () => {
  it('forks with the entered title and reports the new session id', async () => {
    const fork = vi.fn(async () => ({ newSessionId: 'f1' }));
    const onForked = vi.fn();
    wrap(
      <ForkSheet
        handle={{ fork } as unknown as SessionHandle}
        onClose={() => {}}
        onForked={onForked}
      />,
    );
    await userEvent.type(screen.getByTestId('session-fork-title'), 'My fork');
    await userEvent.click(screen.getByTestId('session-fork-confirm'));
    await waitFor(() => expect(onForked).toHaveBeenCalledWith('f1'));
    expect(fork).toHaveBeenCalledWith({ title: 'My fork' });
  });

  it('forks without a title when the field is empty and shows a failure', async () => {
    const fork = vi.fn().mockRejectedValueOnce(new Error('boom'));
    wrap(
      <ForkSheet
        handle={{ fork } as unknown as SessionHandle}
        onClose={() => {}}
        onForked={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('session-fork-confirm'));
    expect(await screen.findByTestId('session-fork-error')).toBeInTheDocument();
    expect(fork).toHaveBeenCalledWith(undefined);
  });
});

describe('CompactSheet', () => {
  it('sends nothing when cancelled', async () => {
    const compact = vi.fn();
    const onClose = vi.fn();
    wrap(
      <CompactSheet
        handle={{ compact } as unknown as SessionHandle}
        onClose={onClose}
        onCompacted={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('session-compact-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
  });

  it('shows progress while compacting, then the daemon removedCount and successor', async () => {
    let finish: (value: { newSessionId: string; removedCount: number }) => void = () => {};
    const compact = vi.fn(
      () =>
        new Promise<{ newSessionId: string; removedCount: number }>(
          (resolve) => (finish = resolve),
        ),
    );
    const onCompacted = vi.fn();
    wrap(
      <CompactSheet
        handle={{ compact } as unknown as SessionHandle}
        onClose={() => {}}
        onCompacted={onCompacted}
      />,
    );
    await userEvent.type(screen.getByTestId('session-compact-instructions'), 'keep the plan');
    await userEvent.click(screen.getByTestId('session-compact-confirm'));
    expect(await screen.findByTestId('session-compact-progress')).toBeInTheDocument();
    expect(compact).toHaveBeenCalledWith('keep the plan');
    finish({ newSessionId: 'c1', removedCount: 9 });
    expect(await screen.findByTestId('session-compact-removed')).toHaveAttribute(
      'data-removed',
      '9',
    );
    expect(screen.getByTestId('session-compact-removed')).toHaveTextContent('9');
    expect(screen.getByTestId('session-compact-successor')).toHaveTextContent('c1');
    expect(onCompacted).toHaveBeenCalledWith({ newSessionId: 'c1', removedCount: 9 });
  });
});

describe('RewindSheet', () => {
  const history = [
    message('a2', 'assistant', 'done'),
    message('u2', 'user', 'Reply with the single word OK'),
    message('a1', 'assistant', 'created'),
    message('u1', 'user', 'Create hello.txt'),
    message('context-u1', 'user', '<system-reminder>ctx</system-reminder>'),
  ];
  const info: RewindInfo = {
    availableFiles: [{ filePath: 'a.txt', contentHash: 'h', size: 2048 }],
    createdFiles: [{ filePath: 'hello.txt' }],
    evictedFiles: [],
  };

  function handleOf(overrides: Record<string, unknown> = {}) {
    return {
      getMessages: vi.fn(async () => ({ messages: history, hasMore: false })),
      getRewindInfo: vi.fn(async () => info),
      rewind: vi.fn(async () => ({
        newSessionId: 'r1',
        restoredCount: 1,
        deletedCount: 1,
        failedRestoreCount: 0,
        failedDeleteCount: 0,
      })),
      ...overrides,
    };
  }

  it('lists every user message, shows the rewind info and executes exactly what is displayed', async () => {
    const handle = handleOf();
    const onRewound = vi.fn();
    wrap(
      <RewindSheet
        handle={handle as unknown as SessionHandle}
        onClose={() => {}}
        onRewound={onRewound}
      />,
    );
    const list = await screen.findByTestId('session-rewind-list');
    expect(list).toHaveAttribute('data-count', '3');
    expect(screen.getByTestId('session-rewind-entry-1')).toHaveTextContent('Create hello.txt');

    await userEvent.click(screen.getByTestId('session-rewind-entry-1'));
    expect(handle.getRewindInfo).toHaveBeenCalledWith('u1');
    expect(await screen.findByTestId('session-rewind-restore')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('session-rewind-delete')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('session-rewind-delete')).toHaveTextContent('hello.txt');
    expect(screen.getByTestId('session-rewind-evicted-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('session-rewind-no-changes')).not.toBeInTheDocument();

    const title = screen.getByTestId('session-rewind-title');
    expect(title).toHaveValue('Rewind: Create hello.txt');
    await userEvent.clear(title);
    expect(screen.getByTestId('session-rewind-confirm')).toBeDisabled();
    await userEvent.type(title, 'Before hello');
    await userEvent.click(screen.getByTestId('session-rewind-confirm'));

    await waitFor(() => expect(onRewound).toHaveBeenCalled());
    expect(handle.rewind).toHaveBeenCalledWith({
      messageId: 'u1',
      filesToRestore: info.availableFiles,
      filesToDelete: info.createdFiles,
      forkTitle: 'Before hello',
    });
    expect(screen.getByTestId('session-rewind-restored')).toHaveAttribute('data-count', '1');
    expect(screen.queryByTestId('session-rewind-failure')).not.toBeInTheDocument();
  });

  it('offers a conversation-only rewind when no files change, and cancelling sends nothing', async () => {
    const handle = handleOf({
      getRewindInfo: vi.fn(async () => ({
        availableFiles: [],
        createdFiles: [],
        evictedFiles: [],
      })),
    });
    const onClose = vi.fn();
    wrap(
      <RewindSheet
        handle={handle as unknown as SessionHandle}
        onClose={onClose}
        onRewound={() => {}}
      />,
    );
    await userEvent.click(await screen.findByTestId('session-rewind-entry-2'));
    expect(await screen.findByTestId('session-rewind-no-changes')).toBeInTheDocument();
    expect(screen.getByTestId('session-rewind-confirm')).toBeEnabled();
    await userEvent.click(screen.getByTestId('session-rewind-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(handle.rewind).not.toHaveBeenCalled();
  });
});

describe('RewindResultView', () => {
  const parse = (value: unknown): RewindResult => ExecuteRewindResultSchema.parse(value);

  it('names both failed counts and still shows the restored and deleted counts', () => {
    const result = parse({
      newSessionId: 'n',
      restoredCount: 4,
      deletedCount: 5,
      failedRestoreCount: 1,
      failedDeleteCount: 2,
    });
    wrap(<RewindResultView result={result} />);
    const failure = screen.getByTestId('session-rewind-failure');
    expect(failure).toHaveTextContent('1');
    expect(failure).toHaveTextContent('2');
    expect(screen.getByTestId('session-rewind-restored')).toHaveAttribute('data-count', '4');
    expect(screen.getByTestId('session-rewind-deleted')).toHaveAttribute('data-count', '5');
  });

  it('renders no failure message when nothing failed', () => {
    const result = parse({
      newSessionId: 'n',
      restoredCount: 1,
      deletedCount: 1,
      failedRestoreCount: 0,
      failedDeleteCount: 0,
    });
    wrap(<RewindResultView result={result} />);
    expect(screen.queryByTestId('session-rewind-failure')).not.toBeInTheDocument();
  });
});
