import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { useDiagnosticsStore } from '../../diagnostics/capture';
import { appLog } from '../../diagnostics/logBuffer';
import { changeAppLanguage } from '../../i18n/init';

const exportLogFile = vi.hoisted(() => vi.fn());
vi.mock('../../platform/logExport', () => ({ exportLogFile }));

const connection = {
  url: 'ws://127.0.0.1:3101',
  getDaemonIdentity: async () => ({
    userId: 'user-1',
    orgId: 'org-1',
    daemonProtocolVersion: '1.244.0',
    daemonVersion: '0.232.0',
  }),
} as unknown as DaemonConnection;

function renderDiagnostics(status: 'ready' | 'reconnecting' | 'offline' = 'ready') {
  useConnectionStore.setState({ status });
  return renderAppAt('/settings/about', { connection });
}

beforeEach(() => {
  appLog.clear();
  exportLogFile.mockReset();
  exportLogFile.mockResolvedValue({ kind: 'downloaded' });
  useDiagnosticsStore.setState({ lastAuthenticatedAt: null });
});

afterEach(async () => {
  await act(async () => {
    await changeAppLanguage('en');
  });
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });
});

describe('Diagnostics connection health', () => {
  it('shows the live state, transport, host and a never-authenticated marker', () => {
    renderDiagnostics('reconnecting');
    expect(screen.getByTestId('diagnostics-status')).toHaveTextContent('Reconnecting');
    expect(screen.getByTestId('diagnostics-transport')).toHaveTextContent('ws');
    expect(screen.getByTestId('diagnostics-host')).toHaveTextContent('127.0.0.1:3101');
    expect(screen.getByTestId('diagnostics-last-auth')).toHaveTextContent('Never');
  });

  it('follows the connection status and shows the last successful authenticate time', async () => {
    renderDiagnostics('ready');
    await screen.findByText('0.232.0');
    act(() =>
      useDiagnosticsStore.setState({ lastAuthenticatedAt: Date.UTC(2026, 9, 6, 10, 0, 0) }),
    );
    expect(screen.getByTestId('diagnostics-last-auth')).not.toHaveTextContent('Never');
    act(() => useConnectionStore.setState({ status: 'offline' }));
    expect(screen.getByTestId('diagnostics-status')).toHaveAttribute('data-status', 'offline');
    expect(screen.getByTestId('diagnostics-status')).toHaveTextContent('Offline');
    act(() => useConnectionStore.setState({ status: 'ready' }));
    expect(screen.getByTestId('diagnostics-status')).toHaveTextContent('Connected');
  });

  it('localizes the labels', async () => {
    renderDiagnostics('ready');
    await act(async () => {
      await changeAppLanguage('ro');
    });
    expect(screen.getByTestId('diagnostics-export-logs')).toHaveTextContent('Exportă jurnalele');
    expect(screen.getByTestId('diagnostics-last-auth')).toHaveTextContent('Niciodată');
  });
});

describe('Export logs', () => {
  it('exports a report with the log events and no secret, then confirms', async () => {
    const user = userEvent.setup();
    appLog.registerSecret('sk-dummy-0000-NOTAREALKEY');
    appLog.add({
      level: 'error',
      source: 'custom-model',
      message: 'save failed sk-dummy-0000-NOTAREALKEY apiKey=hunter2value fk-probe-key-123',
      code: 'auth',
    });
    renderDiagnostics('ready');
    await user.click(screen.getByTestId('diagnostics-export-logs'));
    await waitFor(() => expect(exportLogFile).toHaveBeenCalledTimes(1));
    const [text, fileName] = exportLogFile.mock.calls[0] as [string, string];
    expect(fileName).toMatch(/^droid-mobile-logs-\d{8}-\d{6}\.txt$/);
    expect(text).toContain('127.0.0.1:3101');
    expect(text).toContain('[auth] save failed');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toMatch(/NOTAREALKEY|hunter2value|fk-probe-key-123|Bearer /i);
    expect(await screen.findByText('Log file downloaded.')).toBeInTheDocument();
  });

  it('says where the file went on Android and reports a failed export', async () => {
    const user = userEvent.setup();
    renderDiagnostics('ready');
    exportLogFile.mockResolvedValueOnce({ kind: 'shared', uri: 'file:///cache/x.txt' });
    await user.click(screen.getByTestId('diagnostics-export-logs'));
    expect(await screen.findByText('Log file saved and ready to share.')).toBeInTheDocument();
    exportLogFile.mockRejectedValueOnce(new Error('disk full'));
    await user.click(screen.getByTestId('diagnostics-export-logs'));
    expect(await screen.findByText('The log file could not be exported.')).toBeInTheDocument();
  });
});
