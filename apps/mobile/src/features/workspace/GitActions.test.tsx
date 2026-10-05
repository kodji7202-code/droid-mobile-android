import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { GitActions } from './GitActions';

function setup(overrides: Partial<DaemonConnection> = {}, online = true) {
  const connection = {
    listGitBranches: vi.fn(async () => ({
      isGitRepository: true,
      branches: ['main', 'feature-a', 'feature-b'],
      originBranches: ['release'],
      currentBranch: 'main',
    })),
    checkoutGitBranch: vi.fn(async (params: { branch: string }) => ({
      status: 'checked_out' as const,
      currentBranch: params.branch,
    })),
    commitGitChanges: vi.fn(async () => ({ success: true })),
    pushGitBranch: vi.fn(async () => ({ success: true })),
    createPullRequest: vi.fn(async () => {
      throw new Error('gh pr create failed');
    }),
    ...overrides,
  } as unknown as DaemonConnection;
  useConnectionStore.setState({ connection, status: online ? 'ready' : 'reconnecting' });
  const onRefresh = vi.fn();
  render(
    <AppProviders>
      <GitActions
        sessionId="s1"
        cwd="C:/repo"
        branch="main"
        baseBranch="main"
        pushableCommitCount={2}
        files={[
          { path: 'a.txt', additions: 1, deletions: 1, status: 'modified' },
          { path: 'new.txt', additions: 2, deletions: 0, status: 'added' },
        ]}
        online={online}
        onRefresh={onRefresh}
      />
    </AppProviders>,
  );
  return {
    connection: connection as unknown as Record<string, ReturnType<typeof vi.fn>>,
    onRefresh,
  };
}

describe('GitActions', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });

  it('lists local and origin branches, marks the current one and filters by substring', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId('git-branch-button'));
    expect(await screen.findByTestId('branch-item-feature-a')).toBeInTheDocument();
    expect(screen.getByTestId('branch-item-origin/release')).toBeInTheDocument();
    expect(screen.getByTestId('branch-item-main')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('branch-current')).toBeInTheDocument();
    await user.type(screen.getByTestId('branch-search-input'), 'feature-b');
    expect(screen.queryByTestId('branch-item-feature-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('branch-item-feature-b')).toBeInTheDocument();
  });

  it('checks out directly when the daemon answers checked_out', async () => {
    const user = userEvent.setup();
    const { connection, onRefresh } = setup();
    await user.click(screen.getByTestId('git-branch-button'));
    await user.click(await screen.findByTestId('branch-item-feature-a'));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(connection.checkoutGitBranch).toHaveBeenCalledWith({
      cwd: 'C:/repo',
      branch: 'feature-a',
    });
    expect(screen.queryByTestId('branch-sheet')).not.toBeInTheDocument();
  });

  it('asks for a resolution on needs_resolution and offers Stash, Commit, Cancel only', async () => {
    const user = userEvent.setup();
    const checkoutGitBranch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'needs_resolution',
        message: 'You have local changes',
        changedFiles: 1,
        additions: 2,
        deletions: 3,
        untrackedFiles: 4,
      })
      .mockResolvedValueOnce({
        status: 'needs_resolution',
        message: 'You have local changes',
        changedFiles: 1,
        additions: 2,
        deletions: 3,
        untrackedFiles: 4,
      })
      .mockResolvedValueOnce({ status: 'checked_out', currentBranch: 'feature-b' });
    const { onRefresh } = setup({ checkoutGitBranch } as unknown as Partial<DaemonConnection>);
    await user.click(screen.getByTestId('git-branch-button'));
    await user.click(await screen.findByTestId('branch-item-feature-b'));
    const dialog = await screen.findByTestId('branch-resolution');
    expect(dialog).toHaveTextContent('You have local changes');
    expect(dialog).toHaveTextContent('1 changed file');
    expect(dialog).toHaveTextContent('2 additions');
    expect(dialog).toHaveTextContent('3 deletions');
    expect(dialog).toHaveTextContent('4 untracked files');
    expect(dialog.querySelectorAll('button')).toHaveLength(3);

    await user.click(screen.getByTestId('branch-resolution-cancel'));
    expect(checkoutGitBranch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('branch-item-feature-b'));
    await user.click(await screen.findByTestId('branch-resolution-stash'));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(checkoutGitBranch).toHaveBeenLastCalledWith({
      cwd: 'C:/repo',
      branch: 'feature-b',
      resolution: 'stash',
    });
  });

  it('creates a branch with create:true and shows the daemon error inline', async () => {
    const user = userEvent.setup();
    const checkoutGitBranch = vi
      .fn()
      .mockRejectedValueOnce(new Error('"bad name~" is not a valid branch name'))
      .mockResolvedValueOnce({ status: 'checked_out', currentBranch: 'val-new-branch' });
    setup({ checkoutGitBranch } as unknown as Partial<DaemonConnection>);
    await user.click(screen.getByTestId('git-branch-button'));
    await user.type(await screen.findByTestId('branch-new-input'), 'bad name~');
    await user.click(screen.getByTestId('branch-new-submit'));
    expect(await screen.findByTestId('branch-error')).toHaveTextContent(
      'is not a valid branch name',
    );
    expect(checkoutGitBranch).toHaveBeenCalledWith({
      cwd: 'C:/repo',
      branch: 'bad name~',
      create: true,
    });
    await user.clear(screen.getByTestId('branch-new-input'));
    await user.type(screen.getByTestId('branch-new-input'), 'val-new-branch');
    await user.click(screen.getByTestId('branch-new-submit'));
    await waitFor(() => expect(screen.queryByTestId('branch-sheet')).not.toBeInTheDocument());
  });

  it('commits read-only listed files with a trimmed non-empty message', async () => {
    const user = userEvent.setup();
    const { connection, onRefresh } = setup();
    await user.click(screen.getByTestId('git-commit-button'));
    expect(screen.getByTestId('git-commit-files')).toHaveTextContent('a.txt');
    expect(screen.getByTestId('git-commit-files')).toHaveTextContent('new.txt');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByTestId('git-commit-submit')).toBeDisabled();
    await user.type(screen.getByTestId('git-commit-message'), '   ');
    expect(screen.getByTestId('git-commit-submit')).toBeDisabled();
    await user.type(screen.getByTestId('git-commit-message'), 'val commit one');
    await user.click(screen.getByTestId('git-commit-submit'));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(connection.commitGitChanges).toHaveBeenCalledWith('s1', 'val commit one');
    expect(screen.getByTestId('git-commit-success')).toBeInTheDocument();
  });

  it('keeps the commit sheet open with the message when the commit fails', async () => {
    const user = userEvent.setup();
    setup({
      commitGitChanges: vi.fn(async () => {
        throw new Error('Failed to commit changes');
      }),
    } as unknown as Partial<DaemonConnection>);
    await user.click(screen.getByTestId('git-commit-button'));
    await user.type(screen.getByTestId('git-commit-message'), 'nothing');
    await user.click(screen.getByTestId('git-commit-submit'));
    expect(await screen.findByTestId('git-commit-error')).toHaveTextContent(
      'Failed to commit changes',
    );
    expect(screen.getByTestId('git-commit-message')).toHaveValue('nothing');
    expect(screen.queryByTestId('git-commit-success')).not.toBeInTheDocument();
  });

  it('surfaces a push failure and re-enables the button', async () => {
    const user = userEvent.setup();
    setup({
      pushGitBranch: vi.fn(async () => {
        throw new Error('Failed to push branch to remote');
      }),
    } as unknown as Partial<DaemonConnection>);
    await user.click(screen.getByTestId('git-push-button'));
    expect(await screen.findByTestId('git-action-error')).toHaveTextContent(
      'Failed to push branch to remote',
    );
    expect(screen.queryByTestId('git-push-success')).not.toBeInTheDocument();
    expect(screen.getByTestId('git-push-button')).toBeEnabled();
  });

  it('shows push success and refreshes', async () => {
    const user = userEvent.setup();
    const { onRefresh } = setup();
    await user.click(screen.getByTestId('git-push-button'));
    expect(await screen.findByTestId('git-push-success')).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalled();
    expect(screen.getByTestId('git-pushable-count')).toHaveTextContent('2 commits to push');
  });

  it('sends create_pr with the form values and keeps the form on daemon error', async () => {
    const user = userEvent.setup();
    const { connection } = setup();
    await user.click(screen.getByTestId('git-create-pr-button'));
    expect(screen.getByTestId('git-pr-base')).toHaveValue('main');
    expect(screen.getByTestId('git-pr-submit')).toBeDisabled();
    await user.type(screen.getByTestId('git-pr-title'), 'My PR');
    await user.type(screen.getByTestId('git-pr-body'), 'Body text');
    await user.click(screen.getByTestId('git-pr-draft'));
    await user.click(screen.getByTestId('git-pr-submit'));
    expect(await screen.findByTestId('git-pr-error')).toHaveTextContent('gh pr create failed');
    expect(connection.createPullRequest).toHaveBeenCalledWith({
      sessionId: 's1',
      title: 'My PR',
      body: 'Body text',
      baseBranch: 'main',
      draft: true,
    });
    expect(screen.getByTestId('git-pr-title')).toHaveValue('My PR');
    expect(screen.queryByTestId('git-pr-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('git-pr-submit')).toBeEnabled();
  });

  it('disables every write action while the connection is not ready', () => {
    setup({}, false);
    for (const id of [
      'git-branch-button',
      'git-commit-button',
      'git-push-button',
      'git-create-pr-button',
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.getByTestId('git-offline')).toBeInTheDocument();
  });
});
