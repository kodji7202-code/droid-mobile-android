import { describe, expect, it, vi } from 'vitest';
import type { ConnectedDroidSession } from '@factory/droid-sdk';
import { SessionHandle } from './session-handle';
import type { SessionHost } from './session-handle';
import {
  DaemonResolvePullRequestStatusesResultSchema,
  type DaemonGetGitDiffResult,
  type DaemonResolvePullRequestStatusesResult,
} from './git';

describe('SessionHandle git methods', () => {
  it('delegates getGitDiff to host', async () => {
    const mockDiffResult: DaemonGetGitDiffResult = {
      success: true,
      data: {
        diff: 'diff --git a/a.txt b/a.txt',
        branch: 'feat/test',
        baseBranch: 'main',
        files: [{ path: 'a.txt', additions: 1, deletions: 0, status: 'added' }],
        totalAdditions: 1,
        totalDeletions: 0,
        commits: [],
        remoteUrl: null,
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
    };

    const getGitDiff = vi.fn(async () => mockDiffResult);

    const host = {
      currentDroidToken: () => 1,
      getGitDiff,
    } as unknown as SessionHost;

    const handle = new SessionHandle('s-git', host);
    handle.attach(
      { id: 's-git', settings: {}, cwd: '/some/repo' } as unknown as ConnectedDroidSession,
      1,
    );

    const result = await handle.getGitDiff({ baseBranch: 'main', statsOnly: false });
    expect(result).toEqual(mockDiffResult);
    expect(getGitDiff).toHaveBeenCalledWith('s-git', { baseBranch: 'main', statsOnly: false });
  });

  it('delegates resolvePullRequestStatuses with at most 20 lookups to host', async () => {
    const mockPrResult: DaemonResolvePullRequestStatusesResult = {
      statuses: [
        {
          subject: {
            kind: 'branch' as Parameters<
              SessionHost['resolvePullRequestStatuses']
            >[0]['lookups'][number]['subject']['kind'],
            sessionId: 's-git',
          },
          branch: 'feat/test',
          status: {
            state: 'open',
            url: 'https://github.com/org/repo/pull/1',
            title: 'Initial PR',
          },
          resolvedAt: Date.now(),
          staleAfterMs: 15000,
        },
      ],
    };

    const resolvePullRequestStatuses = vi.fn(async () => mockPrResult);

    const host = {
      currentDroidToken: () => 1,
      resolvePullRequestStatuses,
    } as unknown as SessionHost;

    const handle = new SessionHandle('s-git', host);
    handle.attach(
      { id: 's-git', settings: {}, cwd: '/some/repo' } as unknown as ConnectedDroidSession,
      1,
    );

    const result = await handle.resolvePullRequestStatuses(true);
    expect(result).toEqual(mockPrResult);
    expect(resolvePullRequestStatuses).toHaveBeenCalledWith({
      lookups: [
        {
          subject: { kind: 'branch', sessionId: 's-git' },
          invalidate: true,
        },
      ],
    });
  });

  it('validates PR statuses fixtures against DaemonResolvePullRequestStatusesResultSchema', () => {
    const openFixture = {
      statuses: [
        {
          subject: { kind: 'branch', sessionId: 's1' },
          branch: 'feat',
          status: { state: 'open', url: 'https://example.com/pr/1', title: 'Feature' },
          resolvedAt: 12345,
          staleAfterMs: 10000,
        },
      ],
    };
    const noneFixture = {
      statuses: [
        {
          subject: { kind: 'branch', sessionId: 's1' },
          branch: 'main',
          status: { state: 'none' },
          resolvedAt: 12345,
          staleAfterMs: 10000,
        },
      ],
    };
    const unavailableFixture = {
      statuses: [
        {
          subject: { kind: 'branch', sessionId: 's1' },
          branch: 'main',
          status: { state: 'unavailable', reason: 'unsupported_remote' },
          resolvedAt: 12345,
          staleAfterMs: 10000,
        },
      ],
    };
    const nullFixture = {
      statuses: [
        {
          subject: { kind: 'branch', sessionId: 's1' },
          branch: 'main',
          status: null,
          resolvedAt: 12345,
          staleAfterMs: 10000,
        },
      ],
    };

    expect(DaemonResolvePullRequestStatusesResultSchema.parse(openFixture)).toBeDefined();
    expect(DaemonResolvePullRequestStatusesResultSchema.parse(noneFixture)).toBeDefined();
    expect(DaemonResolvePullRequestStatusesResultSchema.parse(unavailableFixture)).toBeDefined();
    expect(DaemonResolvePullRequestStatusesResultSchema.parse(nullFixture)).toBeDefined();
  });
});
