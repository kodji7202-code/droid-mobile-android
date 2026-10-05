import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../test/render-app';
import { SessionRow } from './SessionRow';
import type { SessionRowData } from './sessionsPaging';

function renderRow(row: SessionRowData) {
  render(
    <AppProviders>
      <ul>
        <SessionRow
          row={row}
          now={10_000}
          menuOpen={false}
          onOpen={vi.fn()}
          onToggleMenu={vi.fn()}
          onRename={vi.fn()}
          onArchive={vi.fn()}
          onUnarchive={vi.fn()}
        />
      </ul>
    </AppProviders>,
  );
}

describe('SessionRow worktree label', () => {
  it('shows a badge with the branch and the worktree path for worktree sessions', () => {
    renderRow({
      id: 'w1',
      title: 'Feature',
      messageCount: 2,
      modifiedMs: 5_000,
      cwd: 'C:\\wt\\S',
      worktree: { branch: 'main-wt', path: 'C:\\wt\\S' },
    });
    expect(screen.getByTestId('session-worktree-badge-w1')).toHaveTextContent('Worktree');
    expect(screen.getByTestId('session-worktree-branch-w1')).toHaveTextContent('main-wt');
    expect(screen.getByTestId('session-worktree-path-w1')).toHaveTextContent('C:\\wt\\S');
  });

  it('shows nothing worktree-related for plain sessions', () => {
    renderRow({ id: 'p1', title: 'Plain', messageCount: 2, modifiedMs: 5_000, cwd: 'C:\\S' });
    expect(screen.queryByTestId('session-worktree-badge-p1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-worktree-path-p1')).not.toBeInTheDocument();
  });
});
