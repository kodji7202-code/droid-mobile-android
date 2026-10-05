import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { FileSearch } from './FileSearch';

function renderSearch(cwd: string) {
  const ui = (dir: string) => (
    <AppProviders>
      <FileSearch
        sessionId="s1"
        cwd={dir}
        query="util"
        showHidden={false}
        onQueryChange={vi.fn()}
        onSelectFile={vi.fn()}
        onClear={vi.fn()}
      />
    </AppProviders>
  );
  const view = render(ui(cwd));
  return { rerenderWith: (dir: string) => view.rerender(ui(dir)) };
}

describe('FileSearch results region', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });

  it('renders every match inside the dedicated results region and opens the last one', async () => {
    const hits = Array.from(
      { length: 70 },
      (_, i) => `src/dir/util-${String(i).padStart(2, '0')}.ts`,
    );
    const searchFiles = vi.fn(async () => hits);
    useConnectionStore.setState({
      connection: { searchFiles } as unknown as DaemonConnection,
      readyEpoch: 1,
      status: 'ready',
    });
    const onSelectFile = vi.fn();

    const { findByTestId } = render(
      <AppProviders>
        <FileSearch
          sessionId="s1"
          cwd="/repo"
          query="util"
          showHidden={false}
          onQueryChange={vi.fn()}
          onSelectFile={onSelectFile}
          onClear={vi.fn()}
        />
      </AppProviders>,
    );

    const body = await findByTestId('workspace-search-body');
    const results = await findByTestId('workspace-search-results');
    expect(body.contains(results)).toBe(true);
    expect(results.querySelectorAll('li')).toHaveLength(70);

    const last = await findByTestId('search-result-src/dir/util-69.ts');
    expect(body.contains(last)).toBe(true);
    fireEvent.click(last);
    expect(onSelectFile).toHaveBeenCalledWith('src/dir/util-69.ts');
  });

  it('keeps the results region scrollable inside the height-constrained workspace shell', () => {
    const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
    const rule = (selector: string) => {
      const match = new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(
        css,
      );
      return match?.[1] ?? '';
    };

    expect(rule('.workspace-search__body')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.workspace-search__body')).toMatch(/min-height:\s*0/);
    expect(rule('.workspace-search')).toMatch(/min-height:\s*0/);
    expect(rule('.workspace-header')).toMatch(/min-height:\s*0/);
    expect(rule('.terminal-view')).toMatch(/min-height:\s*0/);
  });
});

describe('FileSearch', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });

  it('refetches the same query when the session cwd changes (WS-SCR-002)', async () => {
    let dir = 'A';
    const searchFiles = vi.fn(async () => (dir === 'A' ? ['a/util.ts'] : ['b/util.ts']));
    useConnectionStore.setState({
      connection: { searchFiles } as unknown as DaemonConnection,
      readyEpoch: 1,
      status: 'ready',
    });

    const { rerenderWith } = renderSearch('/repo/a');
    await waitFor(() => expect(document.body.textContent).toContain('util.tsa'));
    expect(searchFiles).toHaveBeenCalledTimes(1);

    dir = 'B';
    await act(async () => {
      rerenderWith('/repo/b');
    });
    await waitFor(() => expect(searchFiles).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.body.textContent).toContain('util.tsb'));
    expect(document.body.textContent).not.toContain('util.tsa');
  });
});
