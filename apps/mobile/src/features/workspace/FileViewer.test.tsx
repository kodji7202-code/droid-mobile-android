import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { FileViewer } from './FileViewer';

describe('FileViewer', () => {
  it('renders text file with path, size, content, line numbers, and syntax highlighting (VAL-WS-013)', async () => {
    const tsCode = [
      '// Sample TypeScript file with comments, keywords, and strings',
      'import { useState } from "react";',
      '',
      'interface Config {',
      '  enabled: boolean;',
      '  name: string;',
      '}',
      '',
      'export function demo(flag: boolean): string {',
      '  /* multiline comment block */',
      '  if (flag) {',
      '    const greeting = "hello world";',
      '    return greeting;',
      '  }',
      '  return "default";',
      '}',
    ].join('\n');

    const getFileContent = vi.fn(async () => ({
      content: tsCode,
      byteLength: Buffer.byteLength(tsCode, 'utf8'),
      isBinary: false,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    const onBack = vi.fn();
    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="src/sample.ts" onBack={onBack} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-path')).toHaveTextContent('src/sample.ts');
      expect(screen.getByTestId('file-viewer-size')).toHaveTextContent('B');
      // Content equals file after newline normalization:
      const textElem = screen.getByTestId('file-viewer-text');
      expect(textElem.textContent?.replace(/\r\n/g, '\n')).toBe(tsCode.replace(/\r\n/g, '\n'));
    });

    // Line numbers are shown
    const lineNumbersGutter = screen.getByTestId('file-viewer-line-numbers');
    expect(lineNumbersGutter).toBeInTheDocument();
    const lineElements = screen.getAllByTestId('file-viewer-line-number');
    expect(lineElements.length).toBe(tsCode.split('\n').length);
    expect(lineElements[0]).toHaveTextContent('1');
    expect(lineElements[lineElements.length - 1]).toHaveTextContent(String(lineElements.length));

    // Highlighted DOM has at least 3 distinct token style classes (keyword, string, comment)
    const textElem = screen.getByTestId('file-viewer-text');
    const keywordTokens = textElem.querySelectorAll('.hljs-keyword');
    const stringTokens = textElem.querySelectorAll('.hljs-string');
    const commentTokens = textElem.querySelectorAll('.hljs-comment');

    expect(keywordTokens.length).toBeGreaterThanOrEqual(1);
    expect(stringTokens.length).toBeGreaterThanOrEqual(1);
    expect(commentTokens.length).toBeGreaterThanOrEqual(1);

    // Back button works
    fireEvent.click(screen.getByTestId('file-viewer-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders .txt file without syntax highlighting and without error (VAL-WS-013)', async () => {
    const plainText = 'Plain text file without keywords or syntax highlighting.\nSecond line.';
    const getFileContent = vi.fn(async () => ({
      content: plainText,
      byteLength: Buffer.byteLength(plainText, 'utf8'),
      isBinary: false,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="notes.txt" onBack={vi.fn()} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-path')).toHaveTextContent('notes.txt');
      const textElem = screen.getByTestId('file-viewer-text');
      expect(textElem.textContent).toBe(plainText);
      // No hljs tokens
      expect(textElem.querySelectorAll('.hljs-keyword').length).toBe(0);
      expect(textElem.querySelectorAll('.hljs-string').length).toBe(0);
      expect(textElem.querySelectorAll('.hljs-comment').length).toBe(0);
      // No syntax language class on code
      const codeElem = textElem.querySelector('code');
      expect(codeElem?.className).not.toContain('hljs');
    });

    // Line numbers are still shown for plain text
    expect(screen.getAllByTestId('file-viewer-line-number').length).toBe(2);
  });

  it('renders truncation notice for files over 1 MiB and does not show notice below 1 MiB (VAL-WS-014)', async () => {
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
      const notice = screen.getByTestId('file-viewer-truncation');
      expect(notice).toHaveTextContent('Showing first 1 MiB of 2.0 MiB');
      // Text is capped at 1 MiB
      const textElem = screen.getByTestId('file-viewer-text');
      expect(textElem.textContent?.length).toBeLessThanOrEqual(1024 * 1024);
    });
  });

  it.each([
    ['two-byte characters', 'ă'],
    ['three-byte characters', '€'],
    ['supplementary characters', '😀'],
  ])('caps %s at 1 MiB of UTF-8 bytes (VAL-WS-014)', async (_name, char) => {
    const content = char.repeat(Math.ceil((5 * 1024 * 1024) / Buffer.byteLength(char, 'utf8')));
    const getFileContent = vi.fn(async () => ({
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      isBinary: false,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="multibyte.txt" onBack={vi.fn()} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-truncation')).toBeInTheDocument();
      const shown = screen.getByTestId('file-viewer-text').textContent ?? '';
      expect(Buffer.byteLength(shown, 'utf8')).toBeLessThanOrEqual(1024 * 1024);
      expect(Buffer.byteLength(shown, 'utf8')).toBeGreaterThan(1024 * 1024 - 4);
    });
  });

  it('shows the truncation notice when multibyte content exceeds 1 MiB despite a small reported size (VAL-WS-014)', async () => {
    const content = 'ă'.repeat(600 * 1024);
    const getFileContent = vi.fn(async () => ({
      content,
      byteLength: 1024,
      isBinary: false,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="multibyte.txt" onBack={vi.fn()} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-truncation')).toBeInTheDocument();
      const shown = screen.getByTestId('file-viewer-text').textContent ?? '';
      expect(Buffer.byteLength(shown, 'utf8')).toBeLessThanOrEqual(1024 * 1024);
    });
  });

  it('shows no truncation notice for files under 1 MiB (VAL-WS-014)', async () => {
    const smallContent = 'Small file content under 1 MiB';
    const getFileContent = vi.fn(async () => ({
      content: smallContent,
      byteLength: 30,
      isBinary: false,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="small.txt" onBack={vi.fn()} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-text')).toHaveTextContent(smallContent);
      expect(screen.queryByTestId('file-viewer-truncation')).not.toBeInTheDocument();
    });
  });

  it('uses pre line-number element for files with over 2000 lines to avoid freezing (VAL-WS-014)', async () => {
    const manyLines = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join('\n');
    const getFileContent = vi.fn(async () => ({
      content: manyLines,
      byteLength: manyLines.length,
      isBinary: false,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="many.log" onBack={vi.fn()} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-line-numbers')).toBeInTheDocument();
      // Individual div elements are skipped to keep DOM lean
      expect(screen.queryAllByTestId('file-viewer-line-number').length).toBe(0);
      expect(
        screen.getByTestId('file-viewer-line-numbers').querySelector('pre'),
      ).toBeInTheDocument();
    });
  });

  it('allows closing via header close button (VAL-WS-014)', async () => {
    const getFileContent = vi.fn(async () => ({
      content: 'test',
      byteLength: 4,
      isBinary: false,
    }));

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    const onBack = vi.fn();
    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="test.txt" onBack={onBack} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-close-header')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('file-viewer-close-header'));
    expect(onBack).toHaveBeenCalled();
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
      const binaryElem = screen.getByTestId('file-viewer-binary');
      expect(binaryElem).toBeInTheDocument();
      expect(binaryElem.textContent?.length).toBeLessThan(500);
      expect(binaryElem.textContent).toContain('4096');
      expect(screen.queryByTestId('file-viewer-text')).not.toBeInTheDocument();
      expect(screen.getByTestId('file-viewer-size')).toHaveTextContent('4.0 KiB');
    });
  });

  it('renders image files using base64 data uri (VAL-WS-016)', async () => {
    const getFileContent = vi.fn(async () => ({
      content:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
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
      expect(img.alt).toBe('logo.png');
      expect(screen.queryByTestId('file-viewer-text')).not.toBeInTheDocument();
    });

    expect(getFileContent).toHaveBeenCalledWith({
      sessionId: 's1',
      filePath: 'logo.png',
      encoding: 'base64',
    });
  });

  it('handles read errors with retry and close buttons returning to tree (VAL-WS-017)', async () => {
    let callCount = 0;
    const getFileContent = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('File not found: gone.txt');
      }
      return {
        content: 'restored content',
        byteLength: 16,
        isBinary: false,
      };
    });

    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });

    const onBack = vi.fn();
    render(
      <AppProviders>
        <FileViewer sessionId="s1" filePath="gone.txt" onBack={onBack} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-error')).toBeInTheDocument();
      expect(screen.getByTestId('file-viewer-error')).toHaveTextContent('File not found: gone.txt');
      expect(screen.getByTestId('file-viewer-retry')).toBeInTheDocument();
      expect(screen.getByTestId('file-viewer-close')).toBeInTheDocument();
    });

    // Close button returns to tree (calls onBack)
    fireEvent.click(screen.getByTestId('file-viewer-close'));
    expect(onBack).toHaveBeenCalled();

    // Retry button refetches
    fireEvent.click(screen.getByTestId('file-viewer-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer-text')).toHaveTextContent('restored content');
    });
  });

  it('ignores a late response for the previous file (stale-response fence)', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const getFileContent = vi.fn(
      ({ filePath }: { filePath: string }) =>
        new Promise((resolve) => {
          pending.set(filePath, resolve);
        }),
    );
    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });
    const view = (filePath: string) => (
      <AppProviders>
        <FileViewer sessionId="s1" filePath={filePath} onBack={vi.fn()} />
      </AppProviders>
    );
    const result = (text: string) => ({ content: text, byteLength: text.length, isBinary: false });

    const { rerender } = render(view('one.txt'));
    await waitFor(() => expect(pending.has('one.txt')).toBe(true));
    rerender(view('two.txt'));
    await waitFor(() => expect(pending.has('two.txt')).toBe(true));

    pending.get('two.txt')?.(result('content two'));
    await waitFor(() =>
      expect(screen.getByTestId('file-viewer-text')).toHaveTextContent('content two'),
    );
    pending.get('one.txt')?.(result('content one'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('file-viewer-path')).toHaveTextContent('two.txt');
    expect(screen.getByTestId('file-viewer-text')).toHaveTextContent('content two');
    expect(screen.getByTestId('file-viewer-text')).not.toHaveTextContent('content one');
  });

  it('does not let a late response from the first file overwrite a pending newer request', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const getFileContent = vi.fn(
      ({ filePath }: { filePath: string }) =>
        new Promise((resolve) => {
          pending.set(filePath, resolve);
        }),
    );
    useConnectionStore.setState({
      connection: { getFileContent } as unknown as DaemonConnection,
    });
    const view = (filePath: string) => (
      <AppProviders>
        <FileViewer sessionId="s1" filePath={filePath} onBack={vi.fn()} />
      </AppProviders>
    );
    const { rerender } = render(view('one.txt'));
    await waitFor(() => expect(pending.has('one.txt')).toBe(true));
    rerender(view('two.txt'));
    await waitFor(() => expect(pending.has('two.txt')).toBe(true));

    pending.get('one.txt')?.({ content: 'content one', byteLength: 11, isBinary: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('file-viewer-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('file-viewer-text')).not.toBeInTheDocument();
  });
});
