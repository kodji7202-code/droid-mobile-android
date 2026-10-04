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

export function cancelledAskUser(): AskUserAnswer {
  return { cancelled: true, answers: [] };
}
