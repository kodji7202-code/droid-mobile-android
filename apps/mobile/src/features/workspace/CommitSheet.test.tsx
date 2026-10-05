import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../test/render-app';
import { CommitSheet } from './CommitSheet';

const QUOTED_UNICODE = '"fi\\310\\231ier-\\304\\203.txt"';

describe('CommitSheet (VAL-WS-020)', () => {
  it('lists Git quoted paths decoded', () => {
    render(
      <AppProviders>
        <CommitSheet
          open
          sessionId="s1"
          files={[{ path: QUOTED_UNICODE, additions: 1, deletions: 0, status: 'added' }]}
          online
          onClose={vi.fn()}
          onCommitted={vi.fn()}
          onAttempt={vi.fn()}
        />
      </AppProviders>,
    );
    const row = screen.getByTestId('git-commit-file-fișier-ă.txt');
    expect(row).toHaveTextContent('fișier-ă.txt');
    expect(screen.getByTestId('git-commit-files').textContent).not.toContain('\\310');
  });
});
