import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../test/render-app';
import { GitChangesList } from './GitChangesList';
import type { GitDiffFile } from '@droidmobile/daemon-client';

describe('GitChangesList (VAL-WS-020 & VAL-WS-023)', () => {
  const sampleFiles: GitDiffFile[] = [
    { path: 'del.txt', additions: 0, deletions: 1, status: 'deleted' },
    { path: 'mod.txt', additions: 3, deletions: 1, status: 'modified' },
    { path: 'new.txt', additions: 2, deletions: 0, status: 'added' },
  ];

  it('renders changes list matching repo ground truth (VAL-WS-020)', () => {
    const handleSelect = vi.fn();
    render(
      <AppProviders>
        <GitChangesList
          files={sampleFiles}
          branch="main"
          baseBranch="main"
          totalAdditions={5}
          totalDeletions={2}
          onSelectFile={handleSelect}
        />
      </AppProviders>,
    );

    // Branch & Base branch
    expect(screen.getByTestId('git-branch')).toHaveTextContent('main');
    expect(screen.getByTestId('git-base-branch')).toHaveTextContent('main');

    // Totals
    expect(screen.getByTestId('git-total-additions')).toHaveTextContent('+5');
    expect(screen.getByTestId('git-total-deletions')).toHaveTextContent('-2');

    // 3 changed files
    expect(screen.getByTestId('git-change-del.txt')).toBeInTheDocument();
    expect(screen.getByTestId('git-change-mod.txt')).toBeInTheDocument();
    expect(screen.getByTestId('git-change-new.txt')).toBeInTheDocument();

    // Check status badges
    const badges = screen.getAllByTestId('git-status-badge');
    expect(badges).toHaveLength(3);
    expect(badges[0]).toHaveTextContent('deleted');
    expect(badges[1]).toHaveTextContent('modified');
    expect(badges[2]).toHaveTextContent('added');

    // Check per-file additions & deletions
    const fileAdditions = screen.getAllByTestId('git-file-additions');
    const fileDeletions = screen.getAllByTestId('git-file-deletions');

    expect(fileAdditions[0]).toHaveTextContent('+0');
    expect(fileDeletions[0]).toHaveTextContent('-1');

    expect(fileAdditions[1]).toHaveTextContent('+3');
    expect(fileDeletions[1]).toHaveTextContent('-1');

    expect(fileAdditions[2]).toHaveTextContent('+2');
    expect(fileDeletions[2]).toHaveTextContent('-0');

    // Tap file to view diff
    fireEvent.click(screen.getByTestId('git-change-mod.txt'));
    expect(handleSelect).toHaveBeenCalledWith('mod.txt');
  });

  it('renders localized status badges when Romanian is selected', async () => {
    await i18next.changeLanguage('ro');
    try {
      const files: GitDiffFile[] = [
        { path: 'a.txt', additions: 0, deletions: 0, status: 'modified' },
        { path: 'b.txt', additions: 0, deletions: 0, status: 'added' },
        { path: 'c.txt', additions: 0, deletions: 0, status: 'deleted' },
        { path: 'd.txt', additions: 0, deletions: 0, status: 'renamed' },
        { path: 'e.txt', additions: 0, deletions: 0, status: 'untracked' },
        { path: 'f.txt', additions: 0, deletions: 0, status: 'conflicted' },
      ];
      render(
        <AppProviders>
          <GitChangesList
            files={files}
            branch="main"
            baseBranch="main"
            totalAdditions={0}
            totalDeletions={0}
            onSelectFile={vi.fn()}
          />
        </AppProviders>,
      );

      const labels = screen.getAllByTestId('git-status-badge').map((badge) => badge.textContent);
      expect(labels).toEqual([
        'modificat',
        'adăugat',
        'șters',
        'redenumit',
        'neurmărit',
        'conflicted',
      ]);
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('renders clean repository "no changes" state (VAL-WS-023)', () => {
    render(
      <AppProviders>
        <GitChangesList
          files={[]}
          branch="main"
          baseBranch="main"
          totalAdditions={0}
          totalDeletions={0}
          onSelectFile={vi.fn()}
        />
      </AppProviders>,
    );

    expect(screen.getByTestId('git-no-changes')).toBeInTheDocument();
    expect(screen.getByTestId('git-no-changes')).toHaveTextContent('No changes');
    expect(screen.queryByTestId('git-not-a-repo')).toBeNull();
  });

  it('renders plain folder "not a git repository" state (VAL-WS-023)', () => {
    render(
      <AppProviders>
        <GitChangesList
          files={[]}
          branch=""
          baseBranch=""
          totalAdditions={0}
          totalDeletions={0}
          notGitRepo={true}
          onSelectFile={vi.fn()}
        />
      </AppProviders>,
    );

    expect(screen.getByTestId('git-not-a-repo')).toBeInTheDocument();
    expect(screen.getByTestId('git-not-a-repo')).toHaveTextContent('Not a git repository');
    expect(screen.queryByTestId('git-no-changes')).toBeNull();
  });
});
