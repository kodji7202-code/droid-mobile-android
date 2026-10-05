import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DaemonResolvePullRequestStatusesResultSchema } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { PullRequestChip } from './PullRequestChip';

describe('PullRequestChip (VAL-WS-039)', () => {
  // Result fixtures parsed against the SDK 0.9.1 schema
  const openResult = DaemonResolvePullRequestStatusesResultSchema.parse({
    statuses: [
      {
        subject: { kind: 'branch', sessionId: 's-open' },
        branch: 'feat/test',
        status: {
          state: 'open',
          url: 'https://github.com/org/repo/pull/42',
          title: 'Add great feature',
        },
        resolvedAt: 1700000000000,
        staleAfterMs: 30000,
      },
    ],
  });

  const noneResult = DaemonResolvePullRequestStatusesResultSchema.parse({
    statuses: [
      {
        subject: { kind: 'branch', sessionId: 's-none' },
        branch: 'main',
        status: {
          state: 'none',
        },
        resolvedAt: 1700000000000,
        staleAfterMs: 30000,
      },
    ],
  });

  const unavailableResult = DaemonResolvePullRequestStatusesResultSchema.parse({
    statuses: [
      {
        subject: { kind: 'branch', sessionId: 's-unavail' },
        branch: 'feature-local',
        status: {
          state: 'unavailable',
          reason: 'lookup_failed',
        },
        resolvedAt: 1700000000000,
        staleAfterMs: 30000,
      },
    ],
  });

  const nullResult = DaemonResolvePullRequestStatusesResultSchema.parse({
    statuses: [
      {
        subject: { kind: 'branch', sessionId: 's-null' },
        branch: 'detached',
        status: null,
        resolvedAt: 1700000000000,
        staleAfterMs: 30000,
      },
    ],
  });

  it('renders open PR chip with localized label and url', () => {
    const status = openResult.statuses[0].status;
    const { unmount } = render(
      <AppProviders>
        <PullRequestChip status={status} />
      </AppProviders>,
    );

    const chip = screen.getByTestId('pr-status-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute('href', 'https://github.com/org/repo/pull/42');
    const openText = chip.textContent || '';
    expect(openText).toMatch(/Open PR/i);
    unmount();
  });

  it('renders none PR chip with distinct localized label', () => {
    const status = noneResult.statuses[0].status;
    const { unmount } = render(
      <AppProviders>
        <PullRequestChip status={status} />
      </AppProviders>,
    );

    const chip = screen.getByTestId('pr-status-chip');
    expect(chip).toBeInTheDocument();
    const noneText = chip.textContent || '';
    expect(noneText).toMatch(/No pull request/i);
    unmount();
  });

  it('renders no chip when the remote is not a supported pull-request host', () => {
    const status = DaemonResolvePullRequestStatusesResultSchema.parse({
      statuses: [
        {
          subject: { kind: 'branch', sessionId: 's-unsupported' },
          branch: 'feature-local',
          status: { state: 'unavailable', reason: 'unsupported_remote' },
          resolvedAt: 1700000000000,
          staleAfterMs: 30000,
        },
      ],
    }).statuses[0].status;
    render(
      <AppProviders>
        <PullRequestChip status={status} />
      </AppProviders>,
    );

    expect(screen.queryByTestId('pr-status-chip')).toBeNull();
  });

  it.each(['lookup_failed', 'unknown'] as const)(
    'renders the unavailable chip for reason %s',
    (reason) => {
      const parsed = DaemonResolvePullRequestStatusesResultSchema.parse({
        statuses: [
          {
            subject: { kind: 'branch', sessionId: 's-failed' },
            branch: 'feature-local',
            status: { state: 'unavailable', reason },
            resolvedAt: 1700000000000,
            staleAfterMs: 30000,
          },
        ],
      });
      render(
        <AppProviders>
          <PullRequestChip status={parsed.statuses[0].status} />
        </AppProviders>,
      );
      expect(screen.getByTestId('pr-status-chip').textContent).toMatch(/PR unavailable/i);
    },
  );

  it('renders unavailable PR chip with distinct localized label', () => {
    const status = unavailableResult.statuses[0].status;
    const { unmount } = render(
      <AppProviders>
        <PullRequestChip status={status} />
      </AppProviders>,
    );

    const chip = screen.getByTestId('pr-status-chip');
    expect(chip).toBeInTheDocument();
    const unavailText = chip.textContent || '';
    expect(unavailText).toMatch(/PR unavailable/i);
    unmount();
  });

  it('renders no chip for status: null', () => {
    const status = nullResult.statuses[0].status;
    render(
      <AppProviders>
        <PullRequestChip status={status} />
      </AppProviders>,
    );

    expect(screen.queryByTestId('pr-status-chip')).toBeNull();
  });

  it('asserts distinct localized labels across all non-null states', () => {
    const labels = new Set<string>();

    for (const res of [openResult, noneResult, unavailableResult]) {
      const { unmount } = render(
        <AppProviders>
          <PullRequestChip status={res.statuses[0].status} />
        </AppProviders>,
      );
      const text = screen.getByTestId('pr-status-chip').textContent?.trim() || '';
      expect(text.length).toBeGreaterThan(0);
      expect(labels.has(text)).toBe(false); // must be distinct
      labels.add(text);
      unmount();
    }

    expect(labels.size).toBe(3);
  });
});
