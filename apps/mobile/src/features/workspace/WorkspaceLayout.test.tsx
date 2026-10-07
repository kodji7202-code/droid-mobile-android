import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { DaemonConnection, DaemonGetGitDiffResult } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { stubMatchMedia } from '../../test/match-media';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { useWorkspaceStore } from '../../stores/workspace';
import { WorkspaceScreen } from './WorkspaceScreen';

vi.mock('../terminal/TerminalView', () => ({
  TerminalView: () => <div data-testid="terminal-view" />,
}));

const DIFF = [
  'diff --git a/src/index.ts b/src/index.ts',
  '--- a/src/index.ts',
  '+++ b/src/index.ts',
  '@@ -1,2 +1,3 @@',
  ' line 1',
  '-line 2',
  '+line 2 mod',
  '+line 3',
  '',
].join('\n');

function setupConnection() {
  const listFiles = vi.fn(async () => ['src/index.ts', 'src/util.ts', 'readme.md']);
  const connection = {
    listFiles,
    searchFiles: vi.fn(async () => []),
    getFileContent: vi.fn(async ({ filePath }: { filePath: string }) => ({
      content: `content of ${filePath}`,
      byteLength: 20,
      isBinary: false,
    })),
    getGitDiff: vi.fn(async (): Promise<DaemonGetGitDiffResult> => ({
      success: true,
      data: {
        branch: 'main',
        baseBranch: 'main',
        totalAdditions: 2,
        totalDeletions: 1,
        files: [{ path: 'src/index.ts', additions: 2, deletions: 1, status: 'modified' }],
        diff: DIFF,
        remoteUrl: null,
        commits: [],
        committedDiff: '',
        committedFiles: [],
        committedTotalAdditions: 0,
        committedTotalDeletions: 0,
        localDiff: '',
        localFiles: [],
        localTotalAdditions: 0,
        localTotalDeletions: 0,
        unstagedDiff: '',
        unstagedFiles: [],
        unstagedTotalAdditions: 0,
        unstagedTotalDeletions: 0,
      },
    })),
  } as unknown as DaemonConnection;
  useConnectionStore.setState({ connection, readyEpoch: 1, status: 'ready' });
  return { listFiles };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="probe-location">{`${location.pathname}${location.search}`}</span>;
}

function renderWorkspace(initialRoute = '/workspace') {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[initialRoute]}>
        <LocationProbe />
        <Routes>
          <Route path="/workspace" element={<WorkspaceScreen />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('WorkspaceScreen layout', () => {
  let restore: (() => void) | undefined;

  let listFiles: ReturnType<typeof setupConnection>['listFiles'];

  beforeEach(() => {
    ({ listFiles } = setupConnection());
    useWorkspaceStore.setState({
      showHidden: false,
      searchQuery: '',
      expandedBySession: { s1: ['src'] },
      scrollBySession: {},
    });
    useSessionViewStore.setState({
      activeSessionId: 's1',
      views: {
        s1: {
          id: 's1',
          status: 'ready',
          cwd: 'D:/alpha',
          items: [],
          queued: [],
          turnActive: false,
          workingState: 'idle',
          stopRequested: false,
          interrupted: false,
          hasMore: false,
          loadingOlder: false,
          epoch: 1,
        },
      },
    });
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('reloads the file list when returning to the Files tab', async () => {
    renderWorkspace('/workspace?tab=changes');
    await waitFor(() => expect(screen.getByTestId('git-changes-list')).toBeInTheDocument());
    expect(listFiles).toHaveBeenCalledTimes(0);

    // A terminal command or an agent turn created this file while the tree was not on screen.
    listFiles.mockResolvedValue(['src/index.ts', 'src/util.ts', 'readme.md', 'cross.txt']);
    fireEvent.click(screen.getByTestId('workspace-tab-files'));

    await waitFor(() => expect(screen.getByTestId('tree-file-cross.txt')).toBeInTheDocument());
  });

  describe('on a tablet (>= 840 px)', () => {
    beforeEach(() => {
      restore = stubMatchMedia(true);
    });

    it('shows the tree beside a select-a-file prompt before any file is open', async () => {
      renderWorkspace();
      await waitFor(() => expect(screen.getByTestId('files-tree')).toBeInTheDocument());
      expect(screen.getByTestId('workspace-layout')).toBeInTheDocument();
      expect(
        within(screen.getByTestId('workspace-detail')).getByTestId('workspace-select-file'),
      ).toBeInTheDocument();
    });

    it('keeps the tree visible beside the viewer, marks the open file and drops the back control', async () => {
      renderWorkspace('/workspace?file=src/index.ts');
      await waitFor(() => expect(screen.getByTestId('file-viewer')).toBeInTheDocument());
      expect(screen.getByTestId('files-tree')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-detail')).toContainElement(
        screen.getByTestId('file-viewer'),
      );
      expect(screen.getByTestId('tree-file-src/index.ts')).toHaveAttribute('aria-current', 'true');
      expect(screen.getByTestId('tree-file-src/util.ts')).not.toHaveAttribute('aria-current');
      expect(screen.queryByTestId('file-viewer-back')).not.toBeInTheDocument();
      expect(screen.queryByTestId('workspace-select-file')).not.toBeInTheDocument();
    });

    it('selecting another file swaps the viewer without hiding the tree or growing history', async () => {
      renderWorkspace('/workspace');
      await waitFor(() => expect(screen.getByTestId('tree-file-src/index.ts')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('tree-file-src/index.ts'));
      await waitFor(() =>
        expect(screen.getByTestId('file-viewer-path')).toHaveTextContent('src/index.ts'),
      );
      fireEvent.click(screen.getByTestId('tree-file-src/util.ts'));
      await waitFor(() =>
        expect(screen.getByTestId('file-viewer-path')).toHaveTextContent('src/util.ts'),
      );
      expect(screen.getByTestId('files-tree')).toBeInTheDocument();
      expect(screen.getByTestId('tree-file-src/util.ts')).toHaveAttribute('aria-current', 'true');
      expect(screen.getByTestId('tree-file-src/index.ts')).not.toHaveAttribute('aria-current');

      // Closing the viewer pops a single pushed entry, so the tree-only URL is restored.
      fireEvent.click(screen.getByTestId('file-viewer-close-header'));
      await waitFor(() =>
        expect(screen.getByTestId('probe-location')).toHaveTextContent(/^\/workspace$/),
      );
      expect(screen.getByTestId('workspace-select-file')).toBeInTheDocument();
    });

    it('shows the changes list beside the diff viewer', async () => {
      renderWorkspace('/workspace?tab=changes&diff=src/index.ts');
      await waitFor(() => expect(screen.getByTestId('git-diff-view')).toBeInTheDocument());
      expect(screen.getByTestId('git-changes-list')).toBeInTheDocument();
      expect(screen.getByTestId('git-change-src/index.ts')).toHaveAttribute('aria-current', 'true');
      expect(screen.queryByTestId('git-diff-back')).not.toBeInTheDocument();
    });

    it('gives the terminal tab the full width', async () => {
      renderWorkspace('/workspace?tab=terminal');
      await waitFor(() => expect(screen.getByTestId('terminal-view')).toBeInTheDocument());
      expect(screen.queryByTestId('workspace-detail')).not.toBeInTheDocument();
    });
  });

  describe('on a phone (< 840 px)', () => {
    it('replaces the tree with the viewer and keeps the back control', async () => {
      renderWorkspace('/workspace?file=src/index.ts');
      await waitFor(() => expect(screen.getByTestId('file-viewer')).toBeInTheDocument());
      expect(screen.queryByTestId('files-tree')).not.toBeInTheDocument();
      expect(screen.queryByTestId('workspace-layout')).not.toBeInTheDocument();
      expect(screen.getByTestId('file-viewer-back')).toBeInTheDocument();
    });

    it('shows only the tree without the select-a-file prompt', async () => {
      renderWorkspace();
      await waitFor(() => expect(screen.getByTestId('files-tree')).toBeInTheDocument());
      expect(screen.queryByTestId('workspace-select-file')).not.toBeInTheDocument();
    });
  });
});
