import { describe, expect, it, vi } from 'vitest';
import type { ConnectedDroid } from '@factory/droid-sdk';
import { createAutomationsClient, toAutomation, toAutomationRun } from './automations';

type RawAutomation = Parameters<typeof toAutomation>[0];
type RawRun = Parameters<typeof toAutomationRun>[0];

function rawAutomation(overrides: Partial<RawAutomation> = {}): RawAutomation {
  return {
    id: 'val-auto-a',
    uuid: 'uuid-a',
    name: 'val-auto-a',
    prompt: 'Reply with the single word OK',
    status: 'paused',
    schedule: 'weekly',
    isValid: true,
    path: 'C:\\Users\\x\\.factory\\automations\\val-auto-a',
    ...overrides,
  };
}

function harness(overrides: Partial<Record<string, unknown>> = {}) {
  const automations = {
    list: vi.fn(async () => [rawAutomation()]),
    run: vi.fn(async (_id: string) => ({
      automationName: 'val-auto-a',
      automationId: 'uuid-a',
      cwd: 'C:\\Users\\x\\.factory\\automations\\val-auto-a',
      prompt: '<system-reminder>…</system-reminder>\nReply with the single word OK',
    })),
    pause: vi.fn(async (id: string) => ({ success: true, automationId: id, status: 'paused' })),
    resume: vi.fn(async (id: string) => ({ success: true, automationId: id, status: 'active' })),
    getHistory: vi.fn(async (id: string) => ({ automationId: id, runs: [], totalCount: 0 })),
    ...overrides,
  };
  const droid = { automations } as unknown as ConnectedDroid;
  const client = createAutomationsClient({
    droid: () => droid,
    generation: () => 1,
    run: (op) => op(),
  });
  return { client, automations };
}

describe('toAutomation', () => {
  it('keeps the displayed fields and drops machine-local paths', () => {
    const entry = toAutomation(
      rawAutomation({
        status: 'active',
        nextRunAt: '2026-10-12T09:00:00.000Z',
        lastRunAt: '2026-10-05T09:00:00.000Z',
        lastRunStatus: 'success',
      }),
    );
    expect(entry).toEqual({
      id: 'val-auto-a',
      uuid: 'uuid-a',
      name: 'val-auto-a',
      prompt: 'Reply with the single word OK',
      status: 'active',
      schedule: 'weekly',
      nextRunAt: '2026-10-12T09:00:00.000Z',
      lastRunAt: '2026-10-05T09:00:00.000Z',
      lastRunStatus: 'success',
      isValid: true,
    });
  });

  it('omits absent optional fields instead of setting undefined', () => {
    const entry = toAutomation(rawAutomation({ uuid: undefined, prompt: undefined }));
    expect(Object.keys(entry).sort()).toEqual(['id', 'isValid', 'name', 'schedule', 'status']);
  });
});

describe('toAutomationRun', () => {
  it('keeps the SDK run fields that the history shows', () => {
    const run: RawRun = {
      runId: 'r1',
      automationId: 'uuid-a',
      status: 'failed',
      startedAt: '2026-10-05T09:00:00.000Z',
      durationMs: 1200,
      errorMessage: 'boom',
      sessionId: 's1',
    };
    expect(toAutomationRun(run)).toEqual({
      runId: 'r1',
      status: 'failed',
      startedAt: '2026-10-05T09:00:00.000Z',
      durationMs: 1200,
      errorMessage: 'boom',
      sessionId: 's1',
    });
  });

  it('omits missing optional fields', () => {
    const run = toAutomationRun({
      runId: 'r2',
      automationId: 'uuid-a',
      status: 'succeeded',
      startedAt: '2026-10-05T09:00:00.000Z',
    });
    expect(run).toEqual({
      runId: 'r2',
      status: 'succeeded',
      startedAt: '2026-10-05T09:00:00.000Z',
    });
  });
});

describe('createAutomationsClient', () => {
  it('lists automations from the daemon', async () => {
    const { client } = harness();
    expect((await client.list()).map((item) => item.name)).toEqual(['val-auto-a']);
  });

  it('returns the run descriptor without starting anything itself', async () => {
    const { client, automations } = harness();
    const descriptor = await client.run('val-auto-a');
    expect(automations.run).toHaveBeenCalledWith('val-auto-a');
    expect(descriptor).toEqual({
      automationName: 'val-auto-a',
      cwd: 'C:\\Users\\x\\.factory\\automations\\val-auto-a',
      prompt: '<system-reminder>…</system-reminder>\nReply with the single word OK',
    });
  });

  it('passes the configured model of the descriptor through', async () => {
    const { client } = harness({
      run: vi.fn(async () => ({
        automationName: 'val-auto-a',
        automationId: 'uuid-a',
        cwd: 'C:\\auto',
        prompt: 'p',
        model: 'custom:model-1',
      })),
    });
    expect((await client.run('val-auto-a')).model).toBe('custom:model-1');
  });

  it('resumes and pauses and reports the status the daemon returned', async () => {
    const { client, automations } = harness();
    expect(await client.resume('val-auto-a')).toBe('active');
    expect(await client.pause('val-auto-a')).toBe('paused');
    expect(automations.resume).toHaveBeenCalledWith('val-auto-a');
    expect(automations.pause).toHaveBeenCalledWith('val-auto-a');
  });

  it('throws the daemon text when pause is refused', async () => {
    const { client } = harness({
      pause: vi.fn(async (id: string) => ({
        success: false,
        automationId: id,
        status: 'active',
        error: 'not allowed',
      })),
    });
    await expect(client.pause('val-auto-a')).rejects.toThrow('not allowed');
  });

  it('throws a generic message when resume fails without text', async () => {
    const { client } = harness({
      resume: vi.fn(async (id: string) => ({ success: false, automationId: id, status: 'paused' })),
    });
    await expect(client.resume('val-auto-a')).rejects.toThrow(/did not resume/i);
  });

  it('reads history with the total count', async () => {
    const { client, automations } = harness({
      getHistory: vi.fn(async (id: string) => ({
        automationId: id,
        runs: [
          {
            runId: 'r1',
            automationId: 'u',
            status: 'succeeded',
            startedAt: '2026-10-05T09:00:00Z',
          },
        ],
        totalCount: 7,
      })),
    });
    const history = await client.history('val-auto-a');
    expect(automations.getHistory).toHaveBeenCalledWith('val-auto-a', undefined, undefined);
    expect(history.totalCount).toBe(7);
    expect(history.runs.map((run) => run.runId)).toEqual(['r1']);
  });
});
