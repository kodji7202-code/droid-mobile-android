/**
 * Scheduled automations over the SDK facade (`droid.automations`), limited to
 * list, run, pause/resume and history. `run` starts nothing: the daemon only
 * returns a descriptor and the caller creates the session in `cwd` and sends
 * the prompt, which is what consumes credits. Automations are addressed by the
 * directory slug (`id`), not the uuid.
 */
import type { ConnectedDroid } from '@factory/droid-sdk';
import { DaemonClientError } from './errors';
import type { ScratchSessionDeps } from './scratch-session';

type Automations = ConnectedDroid['automations'];
type RawAutomation = Awaited<ReturnType<Automations['list']>>[number];
type RawRun = Awaited<ReturnType<Automations['getHistory']>>['runs'][number];

export interface Automation {
  /** Directory slug the daemon addresses the automation by. */
  id: string;
  uuid?: string;
  name: string;
  prompt?: string;
  /** Reported state; `active`, `paused` and `invalid` are observed, others pass through. */
  status: string;
  /** `daily`, `weekly`, `monthly` or a cron expression. */
  schedule?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastRunStatus?: string;
  isValid: boolean;
}

/** What a manual run needs: the app creates a session in `cwd` and sends `prompt`. */
export interface AutomationRunDescriptor {
  automationName: string;
  cwd: string;
  prompt: string;
  /** Model the automation is configured with; absent means the daemon default. */
  model?: string;
}

export interface AutomationRun {
  runId: string;
  status: string;
  startedAt: string;
  durationMs?: number;
  errorMessage?: string;
  sessionId?: string;
}

export interface AutomationHistory {
  runs: AutomationRun[];
  totalCount: number;
}

export interface AutomationsClient {
  list(): Promise<Automation[]>;
  run(id: string): Promise<AutomationRunDescriptor>;
  /** Resolves to the status the daemon reports after the change. */
  pause(id: string): Promise<string>;
  resume(id: string): Promise<string>;
  history(id: string, limit?: number, offset?: number): Promise<AutomationHistory>;
}

export type AutomationsClientDeps = ScratchSessionDeps;

export function toAutomation(info: Readonly<RawAutomation>): Automation {
  return {
    id: info.id,
    ...(info.uuid !== undefined ? { uuid: info.uuid } : {}),
    name: info.name,
    ...(info.prompt !== undefined ? { prompt: info.prompt } : {}),
    status: info.status,
    ...(info.schedule !== undefined ? { schedule: info.schedule } : {}),
    ...(info.nextRunAt !== undefined ? { nextRunAt: info.nextRunAt } : {}),
    ...(info.lastRunAt !== undefined ? { lastRunAt: info.lastRunAt } : {}),
    ...(info.lastRunStatus !== undefined ? { lastRunStatus: info.lastRunStatus } : {}),
    isValid: info.isValid,
  };
}

export function toAutomationRun(run: Readonly<RawRun>): AutomationRun {
  return {
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
    ...(run.errorMessage !== undefined ? { errorMessage: run.errorMessage } : {}),
    ...(run.sessionId !== undefined ? { sessionId: run.sessionId } : {}),
  };
}

export function createAutomationsClient(deps: AutomationsClientDeps): AutomationsClient {
  const change = async (
    verb: 'pause' | 'resume',
    op: (automations: Automations) => ReturnType<Automations['pause']>,
  ): Promise<string> => {
    const result = await deps.run(() => op(deps.droid().automations));
    if (!result.success) {
      throw new DaemonClientError(
        'unknown',
        result.error?.trim() || `The daemon did not ${verb} the automation.`,
      );
    }
    return result.status;
  };

  return {
    list: async () => (await deps.run(() => deps.droid().automations.list())).map(toAutomation),
    run: async (id) => {
      const descriptor = await deps.run(() => deps.droid().automations.run(id));
      return {
        automationName: descriptor.automationName,
        cwd: descriptor.cwd,
        prompt: descriptor.prompt,
        ...(descriptor.model !== undefined ? { model: descriptor.model } : {}),
      };
    },
    pause: (id) => change('pause', (automations) => automations.pause(id)),
    resume: (id) => change('resume', (automations) => automations.resume(id)),
    history: async (id, limit, offset) => {
      const result = await deps.run(() => deps.droid().automations.getHistory(id, limit, offset));
      return { runs: result.runs.map(toAutomationRun), totalCount: result.totalCount };
    },
  };
}
