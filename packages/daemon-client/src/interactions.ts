/**
 * Daemon-initiated interactions (`daemon.request_permission`, `daemon.ask_user`).
 * The SDK answers with whatever the handlers resolve to, so a handler that
 * never settles keeps the daemon's turn blocked until the UI answers.
 */
import type {
  AskUserRequestParams,
  AskUserResult,
  RequestPermissionHandlerResult,
  RequestPermissionRequestParams,
} from '@factory/droid-sdk';

export type PermissionRequest = RequestPermissionRequestParams;
export type AskUserRequest = AskUserRequestParams;
export type AskUserAnswer = AskUserResult;
export type PermissionAnswer = RequestPermissionHandlerResult;

export type PermissionDecision = 'once' | 'always' | 'deny';

/** generation identifies the facade that delivered the request (see onFacadeLost). */
export type PermissionHandler = (
  sessionId: string,
  request: PermissionRequest,
  generation: number,
) => Promise<PermissionAnswer>;

export type AskUserHandler = (
  sessionId: string,
  request: AskUserRequest,
  generation: number,
) => Promise<AskUserAnswer>;

const ALWAYS_PREFIX = 'proceed_always';

function optionValues(request: PermissionRequest): string[] {
  return request.options.map((option) => String(option.value));
}

/** The "always" option the daemon offers, preferring the plain `proceed_always`. */
function alwaysOption(request: PermissionRequest): string | undefined {
  const values = optionValues(request);
  return (
    values.find((value) => value === ALWAYS_PREFIX) ??
    values.find((value) => value.startsWith(ALWAYS_PREFIX))
  );
}

export function canApproveAlways(request: PermissionRequest): boolean {
  return alwaysOption(request) !== undefined;
}

/** Maps the user's decision to the outcome value the daemon expects. */
export function permissionAnswer(
  request: PermissionRequest,
  decision: PermissionDecision,
): PermissionAnswer {
  if (decision === 'deny') return 'cancel';
  if (decision === 'always') {
    const always = alwaysOption(request);
    if (always !== undefined) return always as PermissionAnswer;
  }
  return 'proceed_once';
}

export interface ExitSpecPlan {
  plan: string;
  title?: string;
}

/** The plan of an `exit_spec_mode` request, or undefined for every other permission request. */
export function exitSpecPlan(request: PermissionRequest): ExitSpecPlan | undefined {
  for (const { details } of request.toolUses) {
    // The SDK enum is a runtime export we do not import: compare on the wire value.
    if ((details.type as string) === 'exit_spec_mode') {
      const spec = details as { plan?: string; title?: string };
      return { plan: spec.plan ?? '', ...(spec.title ? { title: spec.title } : {}) };
    }
  }
  return undefined;
}

export type MissionPermission =
  | { kind: 'propose_mission'; proposal: string; title?: string }
  | {
      kind: 'start_mission_run';
      runningMissionCount: number;
      runningMissionSessionIds: string[];
    };

/** The mission request behind a permission request (`propose_mission` / `start_mission_run`), if it is one. */
export function missionPermission(request: PermissionRequest): MissionPermission | undefined {
  for (const { details } of request.toolUses) {
    const type = details.type as string;
    if (type === 'propose_mission') {
      const proposal = details as { proposal?: string; title?: string };
      return {
        kind: 'propose_mission',
        proposal: proposal.proposal ?? '',
        ...(proposal.title ? { title: proposal.title } : {}),
      };
    }
    if (type === 'start_mission_run') {
      const run = details as { runningMissionCount?: number; runningMissionSessionIds?: string[] };
      return {
        kind: 'start_mission_run',
        runningMissionCount: run.runningMissionCount ?? 0,
        runningMissionSessionIds: run.runningMissionSessionIds ?? [],
      };
    }
  }
  return undefined;
}

/** Option values the daemon offered, in its order. */
export function permissionOptionValues(request: PermissionRequest): string[] {
  return optionValues(request);
}

/** Answers with one of the daemon's own options; anything it did not offer cancels. */
export function permissionOptionAnswer(
  request: PermissionRequest,
  value: string,
): PermissionAnswer {
  return optionValues(request).includes(value) ? (value as PermissionAnswer) : 'cancel';
}

export function cancelledAskUser(): AskUserAnswer {
  return { cancelled: true, answers: [] };
}
