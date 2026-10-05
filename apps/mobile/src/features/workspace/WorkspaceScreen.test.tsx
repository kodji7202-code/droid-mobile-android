import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { DaemonConnection } from '@droidmobile/daemon-client';
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

  const connection = {
    listFiles,
    searchFiles,
    getFileContent,
    validateDirectory,
    checkFolderTrust,
    trustFolder,
    changeDirectory,
    ...overrides,
  } as unknown as DaemonConnection;

  useConnectionStore.setState({ connection, readyEpoch: 1 });
  return {
    connection,
    listFiles,
    searchFiles,
    getFileContent,
    validateDirectory,
    checkFolderTrust,
    trustFolder,
    changeDirectory,
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
});
