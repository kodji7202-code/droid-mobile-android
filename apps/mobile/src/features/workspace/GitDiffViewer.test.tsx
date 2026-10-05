import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../test/render-app';
import { GitDiffViewer } from './GitDiffViewer';

const MOD_DIFF_SAMPLE = `
diff --git a/mod.txt b/mod.txt
index a92d664..b38f00e 100644
--- a/mod.txt
+++ b/mod.txt
@@ -1,3 +1,5 @@
 line 1
-line 2
+line 2 mod
+new line 1
+new line 2
 line 3
`.trim();

const DEL_DIFF_SAMPLE = `
diff --git a/del.txt b/del.txt
deleted file mode 100644
index 2d030d7..0000000
--- a/del.txt
+++ /dev/null
@@ -1 +0,0 @@
-delete me
`.trim();

const ADD_DIFF_SAMPLE = `
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..ae5eb9b
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+added 1
+added 2
`.trim();

describe('GitDiffViewer (VAL-WS-021 & VAL-WS-024)', () => {
  it('renders modified file diff with hunk headers, line markers, line numbers, and accurate counts', () => {
    const handleBack = vi.fn();
    render(
      <AppProviders>
        <GitDiffViewer
          filePath="mod.txt"
          diffText={MOD_DIFF_SAMPLE}
          onBack={handleBack}
          fileAdditions={3}
          fileDeletions={1}
        />
      </AppProviders>,
    );

    // Root view test ID
    expect(screen.getByTestId('git-diff-view')).toBeInTheDocument();

    // Path in header
    expect(screen.getByTestId('git-diff-file-path')).toHaveTextContent('mod.txt');
    expect(screen.getByTestId('git-diff-file-additions')).toHaveTextContent('+3');
    expect(screen.getByTestId('git-diff-file-deletions')).toHaveTextContent('-1');

    // Hunk header
    const hunkHeaders = screen.getAllByTestId('diff-hunk-header');
    expect(hunkHeaders).toHaveLength(1);
    expect(hunkHeaders[0]).toHaveTextContent('@@ -1,3 +1,5 @@');

    // Added lines count and markers
    const addLines = screen.getAllByTestId('diff-line-add');
    expect(addLines).toHaveLength(3); // equal to additions
    addLines.forEach((line) => {
      expect(line.querySelector('[data-testid="diff-line-marker"]')).toHaveTextContent('+');
    });

    // Deleted lines count and markers
    const delLines = screen.getAllByTestId('diff-line-delete');
    expect(delLines).toHaveLength(1); // equal to deletions
    delLines.forEach((line) => {
      expect(line.querySelector('[data-testid="diff-line-marker"]')).toHaveTextContent('-');
    });

    // Context lines
    const ctxLines = screen.getAllByTestId('diff-line-context');
    expect(ctxLines).toHaveLength(2);
    ctxLines.forEach((line) => {
      expect(line.querySelector('[data-testid="diff-line-marker"]')?.textContent?.trim()).toBe('');
    });

    // Line text verification
    expect(screen.getByText('line 2 mod')).toBeInTheDocument();
    expect(screen.getByText('new line 1')).toBeInTheDocument();
    expect(screen.getByText('new line 2')).toBeInTheDocument();
    expect(screen.queryByText('delete me')).toBeNull();

    // Back button
    fireEvent.click(screen.getByTestId('git-diff-back'));
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('renders deleted file diff correctly', () => {
    render(
      <AppProviders>
        <GitDiffViewer
          filePath="del.txt"
          diffText={DEL_DIFF_SAMPLE}
          onBack={vi.fn()}
          fileAdditions={0}
          fileDeletions={1}
        />
      </AppProviders>,
    );

    expect(screen.getByTestId('git-diff-file-path')).toHaveTextContent('del.txt');
    expect(screen.getAllByTestId('diff-line-delete')).toHaveLength(1);
    expect(screen.queryByTestId('diff-line-add')).toBeNull();
    expect(screen.getByText('delete me')).toBeInTheDocument();
  });

  it('renders added file diff correctly', () => {
    render(
      <AppProviders>
        <GitDiffViewer
          filePath="new.txt"
          diffText={ADD_DIFF_SAMPLE}
          onBack={vi.fn()}
          fileAdditions={2}
          fileDeletions={0}
        />
      </AppProviders>,
    );

    expect(screen.getByTestId('git-diff-file-path')).toHaveTextContent('new.txt');
    expect(screen.getAllByTestId('diff-line-add')).toHaveLength(2);
    expect(screen.queryByTestId('diff-line-delete')).toBeNull();
    expect(screen.getByText('added 1')).toBeInTheDocument();
    expect(screen.getByText('added 2')).toBeInTheDocument();
  });

  it('virtualizes 5000 lines diff to strictly <= 600 DOM rows (VAL-WS-024)', () => {
    const lines = [
      'diff --git a/large.txt b/large.txt',
      '--- a/large.txt',
      '+++ b/large.txt',
      '@@ -1,5000 +1,5000 @@',
    ];
    for (let i = 1; i <= 5000; i++) {
      lines.push(`+large diff line ${i}`);
    }
    const largeDiff = lines.join('\n');

    render(
      <AppProviders>
        <GitDiffViewer
          filePath="large.txt"
          diffText={largeDiff}
          onBack={vi.fn()}
          fileAdditions={5000}
          fileDeletions={0}
        />
      </AppProviders>,
    );

    const container = screen.getByTestId('git-diff-view');
    const renderedLineRows = container.querySelectorAll('.diff-line');

    // Must be <= 600 DOM rows as per VAL-WS-024
    expect(renderedLineRows.length).toBeLessThanOrEqual(600);
    expect(renderedLineRows.length).toBeGreaterThan(0);

    // Initial view renders first hunk and lines
    expect(screen.getByText('large diff line 1')).toBeInTheDocument();

    // Scroll to the end
    const scrollContainer = screen.getByTestId('git-diff-scroll');
    fireEvent.scroll(scrollContainer, { target: { scrollTop: 5000 * 24 } });

    // Scrolling to the end displays the last lines
    const updatedLineRows = container.querySelectorAll('.diff-line');
    expect(updatedLineRows.length).toBeLessThanOrEqual(600);
    expect(screen.getByText('large diff line 5000')).toBeInTheDocument();
  });
});
