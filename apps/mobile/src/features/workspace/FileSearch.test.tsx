import { act, render, waitFor } from '@testing-library/react';
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
