import { create } from 'zustand';
import { cancelledAskUser, permissionAnswer } from '@droidmobile/daemon-client';
import type {
  AskUserAnswer,
  AskUserRequest,
  PermissionAnswer,
  PermissionDecision,
  PermissionRequest,
} from '@droidmobile/daemon-client';

/**
 * Requests the daemon sends and blocks on (`daemon.request_permission`,
 * `daemon.ask_user`). Each request holds the promise the SDK is awaiting, so
 * the daemon's turn stays blocked until the UI settles it.
 */
export type PendingInteraction =
  | {
      kind: 'permission';
      id: string;
      sessionId: string;
      /** Facade generation that delivered the request (undefined when unknown). */
      generation?: number;
      request: PermissionRequest;
      settle: (answer: PermissionAnswer) => void;
      /** Duplicate deliveries of the same request; they get the same answer. */
      twins: ((answer: PermissionAnswer) => void)[];
    }
  | {
      kind: 'askuser';
      id: string;
      sessionId: string;
      generation?: number;
      request: AskUserRequest;
      settle: (answer: AskUserAnswer) => void;
      twins: ((answer: AskUserAnswer) => void)[];
    };

interface InteractionStore {
  pending: PendingInteraction[];
  /** Sessions whose request could no longer be answered (connection lost or turn over). */
  expired: Record<string, true>;
  requestPermission(
    sessionId: string,
    request: PermissionRequest,
    generation?: number,
  ): Promise<PermissionAnswer>;
  requestAskUser(
    sessionId: string,
    request: AskUserRequest,
    generation?: number,
  ): Promise<AskUserAnswer>;
  answerPermission(id: string, decision: PermissionDecision): void;
  answerAskUser(id: string, answer: AskUserAnswer): void;
  /**
   * Cancels every open request (of one session, of one facade generation, or all) because the daemon can
   * no longer receive the answer. Marks the sessions as expired when asked.
   */
  expire(options?: { sessionId?: string; generation?: number; notify?: boolean }): void;
  dismissExpired(sessionId: string): void;
  reset(): void;
}

let sequence = 0;

const toolUseKey = (request: PermissionRequest) =>
  request.toolUses.map((use) => use.toolUse.id).join(',');

export const useInteractionStore = create<InteractionStore>((set, get) => {
  const take = (id: string): PendingInteraction | undefined => {
    const found = get().pending.find((item) => item.id === id);
    if (found) set((state) => ({ pending: state.pending.filter((item) => item.id !== id) }));
    return found;
  };

  return {
    pending: [],
    expired: {},

    requestPermission(sessionId, request, generation) {
      const key = toolUseKey(request);
      const twin = get().pending.find(
        (item) =>
          item.kind === 'permission' &&
          item.sessionId === sessionId &&
          toolUseKey(item.request) === key,
      );
      return new Promise((resolve) => {
        if (twin?.kind === 'permission') {
          twin.twins.push(resolve);
          return;
        }
        sequence += 1;
        const twins: ((answer: PermissionAnswer) => void)[] = [];
        const entry: PendingInteraction = {
          kind: 'permission',
          id: `permission-${sequence}`,
          sessionId,
          generation,
          request,
          twins,
          settle: (answer) => {
            resolve(answer);
            for (const other of twins) other(answer);
          },
        };
        set((state) => ({ pending: [...state.pending, entry] }));
      });
    },

    requestAskUser(sessionId, request, generation) {
      const twin = get().pending.find(
        (item) =>
          item.kind === 'askuser' &&
          item.sessionId === sessionId &&
          item.request.toolCallId === request.toolCallId,
      );
      return new Promise((resolve) => {
        if (twin?.kind === 'askuser') {
          twin.twins.push(resolve);
          return;
        }
        sequence += 1;
        const twins: ((answer: AskUserAnswer) => void)[] = [];
        const entry: PendingInteraction = {
          kind: 'askuser',
          id: `askuser-${sequence}`,
          sessionId,
          generation,
          request,
          twins,
          settle: (answer) => {
            resolve(answer);
            for (const other of twins) other(answer);
          },
        };
        set((state) => ({ pending: [...state.pending, entry] }));
      });
    },
    answerPermission(id, decision) {
      const entry = take(id);
      if (entry?.kind === 'permission') entry.settle(permissionAnswer(entry.request, decision));
    },

    answerAskUser(id, answer) {
      const entry = take(id);
      if (entry?.kind === 'askuser') entry.settle(answer);
    },

    expire(options) {
      const affected = get().pending.filter(
        (item) =>
          (options?.sessionId === undefined || item.sessionId === options.sessionId) &&
          (options?.generation === undefined || item.generation === options.generation),
      );
      if (affected.length === 0) return;
      const ids = new Set(affected.map((item) => item.id));
      set((state) => ({
        pending: state.pending.filter((item) => !ids.has(item.id)),
        expired: options?.notify
          ? {
              ...state.expired,
              ...Object.fromEntries(affected.map((item) => [item.sessionId, true as const])),
            }
          : state.expired,
      }));
      for (const item of affected) {
        if (item.kind === 'permission') item.settle('cancel');
        else item.settle(cancelledAskUser());
      }
    },

    dismissExpired(sessionId) {
      set((state) => {
        const { [sessionId]: _removed, ...rest } = state.expired;
        return { expired: rest };
      });
    },

    reset() {
      get().expire();
      set({ expired: {} });
    },
  };
});
