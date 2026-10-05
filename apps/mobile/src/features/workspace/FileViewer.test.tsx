import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { FileViewer } from './FileViewer';

describe('FileViewer', () => {
  it('renders text file with path, size, and content (VAL-WS-013)', async () => {
    const getFileContent = vi.fn(async () => ({
      content: 'console.log("hello world");',
      byteLength: 28,
      isBinary: false,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    const onBack = vi.fn();
    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="src/index.ts" onBack={onBack} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-path')).toHaveTextContent('src/index.ts');
      expect(screen.getByTestId('file-viewer-size')).toHaveTextContent('28 B');
      expect(screen.getByTestId('file-viewer-text')).toHaveTextContent('console.log("hello world");');
    });

    fireEvent.click(screen.getByTestId('file-viewer-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders truncation notice for files over 1 MiB (VAL-WS-014)', async () => {
    const largeSize = 2 * 1024 * 1024; // 2 MiB
    const getFileContent = vi.fn(async () => ({
      content: 'A'.repeat(1024 * 1024 + 100),
      byteLength: largeSize,
      isBinary: false,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="large.log" onBack={vi.fn()} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-truncation')).toHaveTextContent(
        'Showing first 1 MiB of 2.0 MiB',
      );
    });
  });

  it('renders binary file placeholder without text dump (VAL-WS-015)', async () => {
    const getFileContent = vi.fn(async () => ({
      content: '',
      byteLength: 4096,
      isBinary: true,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="app.bin" onBack={vi.fn()} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-binary')).toBeInTheDocument();
      expect(screen.queryByTestId('file-viewer-text')).not.toBeInTheDocument();
      expect(screen.getByTestId('file-viewer-size')).toHaveTextContent('4.0 KiB');
    });
  });

  it('renders image files using base64 data uri (VAL-WS-016)', async () => {
    const getFileContent = vi.fn(async () => ({
      content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      byteLength: 70,
      isBinary: true,
      mimeType: 'image/png',
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="logo.png" onBack={vi.fn()} />
      </AppProviders>,
    );

    await waitFor(() => {
      const img = screen.getByTestId('file-viewer-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain('data:image/png;base64,');
    });

    expect(getFileContent).toHaveBeenCalledWith({
      sessionId: 's1',
      filePath: 'logo.png',
      encoding: 'base64',
    });
  });

  it('handles read errors with retry and close buttons (VAL-WS-017)', async () => {
    let callCount = 0;
    const getFileContent = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('File not found');
      }
      return {
        content: 'now found',
        byteLength: 9,
        isBinary: false,
      };
    });

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    const onBack = vi.fn();
    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="missing.txt" onBack={onBack} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-error')).toBeInTheDocument();
      expect(screen.getByTestId('file-viewer-retry')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('file-viewer-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-text')).toHaveTextContent('now found');
    });
  });
});
