import { z } from 'zod';
import type { ConnectedDroid } from '@factory/droid-sdk';

export type DaemonGetGitDiffRequestParams = Parameters<ConnectedDroid['git']['getDiff']>[0];
export type DaemonGetGitDiffResult = Awaited<ReturnType<ConnectedDroid['git']['getDiff']>>;
export type DaemonResolvePullRequestStatusesRequestParams = Parameters<
  ConnectedDroid['git']['resolvePullRequestStatuses']
>[0];
export type DaemonResolvePullRequestStatusesResult = Awaited<
  ReturnType<ConnectedDroid['git']['resolvePullRequestStatuses']>
>;

export const DaemonPullRequestUnavailableReason = {
  UnsupportedRemote: 'unsupported_remote',
  LookupFailed: 'lookup_failed',
  Unknown: 'unknown',
} as const;
export type DaemonPullRequestUnavailableReason =
  (typeof DaemonPullRequestUnavailableReason)[keyof typeof DaemonPullRequestUnavailableReason];

export const DaemonGetGitDiffUnavailableReason = {
  MissingSessionCwd: 'missing_session_cwd',
  NotGitRepository: 'not_git_repository',
  GitNotAvailable: 'git_not_available',
  Unknown: 'unknown',
} as const;
export type DaemonGetGitDiffUnavailableReason =
  (typeof DaemonGetGitDiffUnavailableReason)[keyof typeof DaemonGetGitDiffUnavailableReason];

export const DaemonPullRequestSubjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('branch'),
    sessionId: z.string(),
  }),
]);

export const DaemonPullRequestStatusSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('open'),
    url: z.string(),
    title: z.string().optional(),
    number: z.number().optional(),
  }),
  z.object({
    state: z.literal('none'),
  }),
  z.object({
    state: z.literal('unavailable'),
    reason: z.string(),
  }),
]);

export const DaemonResolvePullRequestStatusesResultSchema = z.object({
  statuses: z.array(
    z.object({
      subject: DaemonPullRequestSubjectSchema,
      branch: z.string().nullable(),
      status: DaemonPullRequestStatusSchema.nullable(),
      resolvedAt: z.number(),
      staleAfterMs: z.number(),
      provider: z.enum(['github', 'gitlab']).optional(),
      remoteUrl: z.string().nullable().optional(),
    }),
  ),
});

export type GitDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  status: string;
};
