import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router';
import type { DaemonConnection, DaemonGetGitDiffResult } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { useWorkspaceStore } from '../../stores/workspace';
import { WorkspaceScreen } from './WorkspaceScreen';

function setupConnection(overrides: Partial<DaemonConnection> = {}) {
  const listFiles = vi.fn(async (sessionId: string, showHidden?: boolean) => {
    if (sessionId === 's1') {
      return showHidden
        ? ['.env', 'src/index.ts', 'src/util.ts', 'readme.md']
        : ['src/index.ts', 'src/util.ts', 'readme.md'];
    }
    if (sessionId === 's2') {
      return ['package.json'];
    }
    return [];
  });

  const searchFiles = vi.fn(async (_sessionId: string, query: string) => {
    if (query === 'util') {
      return ['src/util.ts'];
    }
    if (query === 'none') {
      return [];
    }
    return ['src/index.ts', 'src/util.ts'];
  });

  const getFileContent = vi.fn(async ({ filePath }: { filePath: string }) => {
    return {
      content: `content of ${filePath}`,
      byteLength: 20,
      isBinary: false,
    };
  });

  const validateDirectory = vi.fn(async (path: string) => {
    if (path === 'invalid/path') {
      return { isValid: false, error: 'Directory not found' };
    }
    return { isValid: true, resolvedPath: path };
  });

  const checkFolderTrust = vi.fn(async (path: string) => {
    if (path === 'untrusted/dir') {
      return { isTrusted: false, trustRootPath: 'untrusted/dir', promptRequired: true };
    }
    return { isTrusted: true, trustRootPath: path, promptRequired: false };
  });

  const trustFolder = vi.fn(async () => undefined);

  const changeDirectory = vi.fn(async ({ workingDirectory }: { workingDirectory: string }) => {
    return { resolvedPath: workingDirectory };
  });

  const getGitDiff = vi.fn(async (): Promise<DaemonGetGitDiffResult> => ({
    success: true,
    data: {
      branch: 'main',
      baseBranch: 'main',
      totalAdditions: 3,
      totalDeletions: 1,
      files: [{ path: 'src/index.ts', additions: 3, deletions: 1, status: 'modified' }],
      diff: `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,2 +1,4 @@
 line 1
-line 2
+line 2 mod
+line 3
+line 4
`,
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
  }));

  const resolvePullRequestStatuses = vi.fn(async () => ({
    statuses: [
      {
        subject: { kind: 'branch', sessionId: 's1' },
        branch: 'main',
        status: { state: 'open' as const, number: 42, url: 'https://github.com/org/repo/pull/42' },
        resolvedAt: Date.now(),
        staleAfterMs: 30000,
      },
    ],
  }));

  const connection = {
    listFiles,
    searchFiles,
    getFileContent,
    validateDirectory,
    checkFolderTrust,
    trustFolder,
    changeDirectory,
    getGitDiff,
    resolvePullRequestStatuses,
    ...overrides,
  } as unknown as DaemonConnection;

  useConnectionStore.setState({ connection, readyEpoch: 1, status: 'ready' });
  return {
    connection,
    listFiles,
    searchFiles,
    getFileContent,
    validateDirectory,
    checkFolderTrust,
    trustFolder,
    changeDirectory,
    getGitDiff,
    resolvePullRequestStatuses,
  };
}

function renderWorkspace(initialRoute = '/workspace') {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/workspace" element={<WorkspaceScreen />} />
          <Route path="/sessions" element={<div data-testid="sessions-screen">Sessions</div>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('WorkspaceScreen', () => {
  beforeEach(() => {
    useSessionViewStore.setState({ views: {}, activeSessionId: null });
    useWorkspaceStore.setState({
      showHidden: false,
      searchQuery: '',
      expandedBySession: {},
      scrollBySession: {},
    });
  });

  it('shows guided empty state with no active session and makes no daemon requests (VAL-WS-003)', async () => {
    const { listFiles } = setupConnection();
    renderWorkspace();

    expect(screen.getByTestId('workspace-empty')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-pick-session')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-start-session')).toBeInTheDocument();

    expect(listFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('workspace-pick-session'));
    expect(screen.getByTestId('sessions-screen')).toBeInTheDocument();
  });

  it('renders active session file tree, follows session switches, and separates expansion state (VAL-WS-001)', async () => {
    const { listFiles } = setupConnection();

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

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-cwd')).toHaveTextContent('D:/alpha');
    });

    expect(listFiles).toHaveBeenCalledWith('s1', false);

    // Initial root shows folder 'src' and file 'readme.md'
    await waitFor(() => {
      expect(screen.getByTestId('tree-folder-src')).toBeInTheDocument();
      expect(screen.getByTestId('tree-file-readme.md')).toBeInTheDocument();
    });

    // Expand folder 'src'
    fireEvent.click(screen.getByTestId('tree-folder-src'));
    await waitFor(() => {
      expect(screen.getByTestId('tree-file-src/index.ts')).toBeInTheDocument();
      expect(screen.getByTestId('tree-file-src/util.ts')).toBeInTheDocument();
    });

    // Switch to session s2
    useSessionViewStore.setState({
      activeSessionId: 's2',
      views: {
        ...useSessionViewStore.getState().views,
        s2: {
          id: 's2',
          status: 'ready',
          cwd: 'D:/beta',
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

    await waitFor(() => {
      expect(screen.getByTestId('workspace-cwd')).toHaveTextContent('D:/beta');
      expect(screen.getByTestId('tree-file-package.json')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-folder-src')).not.toBeInTheDocument();
    });
  });

  it('toggles hidden files (VAL-WS-007, VAL-WS-008)', async () => {
    const { listFiles } = setupConnection();

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

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('tree-file-readme.md')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('tree-file-.env')).not.toBeInTheDocument();

    // Toggle hidden files
    fireEvent.click(screen.getByTestId('workspace-toggle-hidden'));

    await waitFor(() => {
      expect(listFiles).toHaveBeenCalledWith('s1', true);
      expect(screen.getByTestId('tree-file-.env')).toBeInTheDocument();
    });
  });

  it('debounces file search, opens result in viewer, and back preserves search (VAL-WS-011, VAL-WS-012)', async () => {
    const { searchFiles } = setupConnection();

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

    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-search-input')).toBeInTheDocument();
    });

    const input = screen.getByTestId('workspace-search-input');
    await user.type(input, 'util');

    await waitFor(() => {
      expect(searchFiles).toHaveBeenCalledWith('s1', 'util', undefined, false);
      expect(screen.getByTestId('search-result-src/util.ts')).toBeInTheDocument();
    });

    // Tap search result
    fireEvent.click(screen.getByTestId('search-result-src/util.ts'));

    // File viewer opens
    await waitFor(() => {
      expect(screen.getByTestId('file-viewer')).toBeInTheDocument();
      expect(screen.getByTestId('file-viewer-path')).toHaveTextContent('src/util.ts');
    });

    // Tap back button
    fireEvent.click(screen.getByTestId('file-viewer-back'));

    // Returns to search with search query intact
    await waitFor(() => {
      expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument();
      expect(screen.getByTestId('workspace-search-input')).toHaveValue('util');
      expect(screen.getByTestId('search-result-src/util.ts')).toBeInTheDocument();
    });

    // Clear search
    fireEvent.click(screen.getByTestId('workspace-search-clear'));
    await waitFor(() => {
      expect(screen.getByTestId('workspace-search-input')).toHaveValue('');
      expect(screen.getByTestId('files-tree')).toBeInTheDocument();
    });
  });

  it('changes directory with validation and trust prompt gating (VAL-WS-004, VAL-WS-006)', async () => {
    const { changeDirectory, trustFolder } = setupConnection();

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

    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-change-directory')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('workspace-change-directory'));

    const input = screen.getByTestId('change-directory-input');

    // Invalid path shows inline error
    await user.clear(input);
    await user.type(input, 'invalid/path');

    await waitFor(() => {
      expect(screen.getByTestId('change-directory-error')).toHaveTextContent('Directory not found');
      expect(screen.getByTestId('change-directory-submit')).toBeDisabled();
    });

    // Untrusted path prompts for trust
    await user.clear(input);
    await user.type(input, 'untrusted/dir');

    await waitFor(() => {
      expect(screen.queryByTestId('change-directory-error')).not.toBeInTheDocument();
      expect(screen.getByTestId('change-directory-submit')).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId('change-directory-submit'));

    // Trust dialog appears
    await waitFor(() => {
      expect(screen.getByTestId('trust-dialog')).toBeInTheDocument();
    });

    // Decline leaves cwd unchanged and sends no trust
    fireEvent.click(screen.getByTestId('trust-dialog-cancel'));
    expect(trustFolder).not.toHaveBeenCalled();
    expect(changeDirectory).not.toHaveBeenCalled();

    // Submit again and accept
    fireEvent.click(screen.getByTestId('change-directory-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('trust-dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('trust-dialog-confirm'));

    await waitFor(() => {
      expect(trustFolder).toHaveBeenCalledWith('untrusted/dir');
      expect(changeDirectory).toHaveBeenCalledWith({
        sessionId: 's1',
        workingDirectory: 'untrusted/dir',
      });
      expect(screen.getByTestId('workspace-cwd')).toHaveTextContent('untrusted/dir');
    });
  });

  it('preserves tree expansion state when navigating back from file viewer (VAL-WS-019)', async () => {
    setupConnection();

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

    renderWorkspace();

    // Initial root shows folder 'src'
    await waitFor(() => {
      expect(screen.getByTestId('tree-folder-src')).toBeInTheDocument();
    });

    // Expand folder 'src'
    fireEvent.click(screen.getByTestId('tree-folder-src'));
    await waitFor(() => {
      expect(screen.getByTestId('tree-file-src/util.ts')).toBeInTheDocument();
    });

    // Open file into viewer
    fireEvent.click(screen.getByTestId('tree-file-src/util.ts'));
    await waitFor(() => {
      expect(screen.getByTestId('file-viewer')).toBeInTheDocument();
    });

    // Press back from viewer
    fireEvent.click(screen.getByTestId('file-viewer-back'));

    // Viewer is dismissed, folder 'src' is still expanded, file still visible
    await waitFor(() => {
      expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument();
      expect(screen.getByTestId('tree-folder-src')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('tree-file-src/util.ts')).toBeInTheDocument();
    });
  });

  it('closes the viewer by popping its history entry (VAL-WS-019)', async () => {
    setupConnection();
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
    const router = createMemoryRouter(
      [
        { path: '/workspace', element: <WorkspaceScreen /> },
        { path: '/sessions', element: <div data-testid="sessions-screen">Sessions</div> },
      ],
      { initialEntries: ['/sessions', '/workspace'], initialIndex: 1 },
    );
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('tree-file-readme.md')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('tree-file-readme.md'));
    await waitFor(() => expect(screen.getByTestId('file-viewer')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('file-viewer-back'));
    await waitFor(() => expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument());
    expect(router.state.location.search).toBe('');
    expect(router.state.historyAction).toBe('POP');

    // One more Back leaves Workspace: no stale viewer entry is left behind.
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/sessions');
  });

  it('replaces a deep-linked viewer instead of popping out of Workspace (VAL-WS-019)', async () => {
    setupConnection();
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
    const router = createMemoryRouter(
      [
        { path: '/workspace', element: <WorkspaceScreen /> },
        { path: '/sessions', element: <div data-testid="sessions-screen">Sessions</div> },
      ],
      { initialEntries: ['/sessions', '/workspace?file=readme.md'], initialIndex: 1 },
    );
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('file-viewer')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('file-viewer-back'));
    await waitFor(() => expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/workspace');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('switches to Changes tab, displays repo diff and PR status (VAL-WS-020, VAL-WS-039)', async () => {
    const { getGitDiff, resolvePullRequestStatuses } = setupConnection();

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

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-tab-changes')).toBeInTheDocument();
    });

    // Switch to Changes tab
    fireEvent.click(screen.getByTestId('workspace-tab-changes'));

    await waitFor(() => {
      expect(getGitDiff).toHaveBeenCalledWith({ sessionId: 's1' });
      expect(resolvePullRequestStatuses).toHaveBeenCalledWith({
        lookups: [{ subject: { kind: 'branch', sessionId: 's1' } }],
      });
    });

    // Ground truth metadata
    await waitFor(() => {
      expect(screen.getByTestId('git-branch')).toHaveTextContent('main');
      expect(screen.getByTestId('git-base-branch')).toHaveTextContent('main');
      expect(screen.getByTestId('git-total-additions')).toHaveTextContent('+3');
      expect(screen.getByTestId('git-total-deletions')).toHaveTextContent('-1');
    });

    // Changed file row
    expect(screen.getByTestId('git-change-src/index.ts')).toBeInTheDocument();
    expect(screen.getByTestId('git-status-badge')).toHaveTextContent('modified');
    expect(screen.getByTestId('git-file-additions')).toHaveTextContent('+3');
    expect(screen.getByTestId('git-file-deletions')).toHaveTextContent('-1');

    // PR status chip
    const prChip = screen.getByTestId('pr-status-chip');
    expect(prChip).toBeInTheDocument();
    expect(prChip).toHaveTextContent('#42');
  });

  it('opens unified diff view and navigates back (VAL-WS-021)', async () => {
    setupConnection();

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

    renderWorkspace('/workspace?tab=changes');

    await waitFor(() => {
      expect(screen.getByTestId('git-change-src/index.ts')).toBeInTheDocument();
    });

    // Tap changed file to open diff viewer
    fireEvent.click(screen.getByTestId('git-change-src/index.ts'));

    await waitFor(() => {
      expect(screen.getByTestId('git-diff-view')).toBeInTheDocument();
      expect(screen.getByTestId('git-diff-file-path')).toHaveTextContent('src/index.ts');
      expect(screen.getByTestId('diff-hunk-header')).toHaveTextContent('@@ -1,2 +1,4 @@');
    });

    // Tap back button in diff viewer
    fireEvent.click(screen.getByTestId('git-diff-back'));

    await waitFor(() => {
      expect(screen.queryByTestId('git-diff-view')).not.toBeInTheDocument();
      expect(screen.getByTestId('git-change-src/index.ts')).toBeInTheDocument();
    });
  });

  it.each([
    ['decoded changed-file path', 'café.txt'],
    ['C-quoted changed-file path', '"caf\\303\\251.txt"'],
  ])(
    'shows the diff for a non-ASCII filename with a %s (VAL-WS-021)',
    async (_name, listedPath) => {
      setupConnection({
        getGitDiff: vi.fn(async (): Promise<DaemonGetGitDiffResult> => ({
          success: true,
          data: {
            branch: 'main',
            baseBranch: 'main',
            totalAdditions: 1,
            totalDeletions: 1,
            files: [{ path: listedPath, additions: 1, deletions: 1, status: 'modified' }],
            diff: [
              'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
              '--- "a/caf\\303\\251.txt"',
              '+++ "b/caf\\303\\251.txt"',
              '@@ -1 +1 @@',
              '-vechi',
              '+nou',
              '',
            ].join('\n'),
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

      renderWorkspace('/workspace?tab=changes');

      await waitFor(() => {
        expect(screen.getByTestId('git-change-café.txt')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('git-change-café.txt'));

      await waitFor(() => {
        expect(screen.getByTestId('git-diff-file-path')).toHaveTextContent('café.txt');
        expect(screen.getByTestId('diff-hunk-header')).toHaveTextContent('@@ -1 +1 @@');
      });
      expect(screen.queryByText('No changes in this file')).not.toBeInTheDocument();
    },
  );

  it('handles clean repository state (VAL-WS-023)', async () => {
    setupConnection({
      getGitDiff: vi.fn(async (): Promise<DaemonGetGitDiffResult> => ({
        success: true,
        data: {
          branch: 'main',
          baseBranch: 'main',
          totalAdditions: 0,
          totalDeletions: 0,
          files: [],
          diff: '',
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

    renderWorkspace('/workspace?tab=changes');

    await waitFor(() => {
      expect(screen.getByTestId('git-no-changes')).toBeInTheDocument();
      expect(screen.queryByTestId('git-not-a-repo')).toBeNull();
    });
  });

  it('handles non-git repository folder state without error toasts (VAL-WS-023)', async () => {
    setupConnection({
      getGitDiff: vi.fn(async (): Promise<DaemonGetGitDiffResult> => ({
        success: false,
        unavailableReason: 'not_git_repository' as unknown as Extract<
          DaemonGetGitDiffResult,
          { success: false }
        >['unavailableReason'],
        unavailableMessage: 'Not a git repository',
      })),
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

    renderWorkspace('/workspace?tab=changes');

    await waitFor(() => {
      expect(screen.getByTestId('git-not-a-repo')).toBeInTheDocument();
      expect(screen.queryByTestId('toast-container')).toBeNull();
    });
  });
});
