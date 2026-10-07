import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextBreakdown, SessionHandle } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { ContextUsageSheet, contextPercent } from './ContextUsageSheet';

const BREAKDOWN = {
  modelId: 'gpt-5',
  modelDisplayName: 'GPT-5',
  contextBudget: 200_000,
  usedTokens: 25_000,
  freeTokens: 175_000,
  categories: [
    { name: 'System prompt', tokens: 5_000, colorKey: 'systemPrompt' },
    { name: 'Messages', tokens: 20_000, colorKey: 'messages' },
  ],
  skills: [{ name: 'review', location: 'personal', tokens: 120 }],
  mcpServers: [],
  droids: [],
} as unknown as ContextBreakdown;

function handleOf(getContextBreakdown: () => Promise<ContextBreakdown>) {
  return { getContextBreakdown: vi.fn(getContextBreakdown) } as unknown as SessionHandle;
}

function renderSheet(handle: SessionHandle, refreshKey = 'idle:0:0', open = true) {
  const ui = (key: string, isOpen: boolean) => (
    <AppProviders>
      <ContextUsageSheet open={isOpen} onClose={() => {}} handle={handle} refreshKey={key} />
    </AppProviders>
  );
  const view = render(ui(refreshKey, open));
  return (key: string, isOpen = true) => view.rerender(ui(key, isOpen));
}

afterEach(() => {
  useConnectionStore.setState({ connection: null, status: 'offline', readyEpoch: 0 });
});

describe('ContextUsageSheet', () => {
  it('shows the daemon values, categories and named sections with empty labels', async () => {
    renderSheet(handleOf(async () => BREAKDOWN));
    expect(await screen.findByTestId('context-usage-model')).toHaveTextContent('GPT-5');
    expect(screen.getByTestId('context-usage-used')).toHaveAttribute('data-value', '25000');
    expect(screen.getByTestId('context-usage-free')).toHaveAttribute('data-value', '175000');
    expect(screen.getByTestId('context-usage-budget')).toHaveAttribute('data-value', '200000');
    expect(screen.getByTestId('context-usage-percent')).toHaveTextContent('13%');
    expect(screen.getAllByTestId('context-usage-category')).toHaveLength(2);
    expect(screen.getAllByTestId('context-usage-segment')).toHaveLength(2);
    expect(screen.getAllByTestId('context-usage-skills-item')).toHaveLength(1);
    expect(screen.getByTestId('context-usage-mcp-empty')).toBeInTheDocument();
    expect(screen.getByTestId('context-usage-droids-empty')).toBeInTheDocument();
  });

  it('translates the daemon category names and keeps unknown ones as reported', async () => {
    await i18next.changeLanguage('ro');
    try {
      renderSheet(
        handleOf(
          async () =>
            ({
              ...BREAKDOWN,
              categories: [
                ...BREAKDOWN.categories,
                { name: 'Skills', tokens: 10, colorKey: 'skills' },
                { name: 'Future bucket', tokens: 1, colorKey: 'futureBucket' },
              ],
            }) as unknown as ContextBreakdown,
        ),
      );
      const rows = await screen.findAllByTestId('context-usage-category');
      expect(rows.map((row) => row.textContent)).toEqual([
        'Prompt de sistem5,000',
        'Mesaje20,000',
        'Abilități10',
        'Future bucket1',
      ]);
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('renders an empty session without error', async () => {
    renderSheet(
      handleOf(async () => ({
        ...BREAKDOWN,
        usedTokens: 0,
        freeTokens: 200_000,
        categories: [],
        skills: [],
      })),
    );
    expect(await screen.findByTestId('context-usage-used')).toHaveAttribute('data-value', '0');
    expect(screen.getByTestId('context-usage-categories-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
  });

  it('shows an error without stale numbers and recovers on retry', async () => {
    const getContextBreakdown = vi
      .fn<() => Promise<ContextBreakdown>>()
      .mockResolvedValueOnce(BREAKDOWN)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ ...BREAKDOWN, usedTokens: 30_000 });
    const handle = { getContextBreakdown } as unknown as SessionHandle;
    const rerender = renderSheet(handle);
    await screen.findByTestId('context-usage-ready');

    rerender('idle:5:5');
    const alert = await screen.findByTestId('error-state');
    expect(within(alert).getByText('Could not load context usage')).toBeInTheDocument();
    expect(screen.queryByTestId('context-usage-used')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId('error-state-retry'));
    expect(await screen.findByTestId('context-usage-used')).toHaveAttribute('data-value', '30000');
  });

  it('reloads when a turn finishes and when the connection becomes ready again', async () => {
    const handle = handleOf(async () => BREAKDOWN);
    const rerender = renderSheet(handle);
    await screen.findByTestId('context-usage-ready');
    expect(handle.getContextBreakdown).toHaveBeenCalledTimes(1);

    rerender('idle:10:4');
    await waitFor(() => expect(handle.getContextBreakdown).toHaveBeenCalledTimes(2));

    useConnectionStore.setState({ readyEpoch: 7 });
    await waitFor(() => expect(handle.getContextBreakdown).toHaveBeenCalledTimes(3));
  });

  it('does not call the daemon while closed', () => {
    const handle = handleOf(async () => BREAKDOWN);
    renderSheet(handle, 'idle:0:0', false);
    expect(handle.getContextBreakdown).not.toHaveBeenCalled();
  });

  it('computes the percentage from used and budget', () => {
    expect(contextPercent(25_000, 200_000)).toBe(13);
    expect(contextPercent(0, 0)).toBe(0);
  });
});
