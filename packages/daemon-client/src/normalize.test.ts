import { describe, expect, it } from 'vitest';
import { normalizeStreamEvent } from './normalize';
import type { DroidStreamEvent } from '@factory/droid-sdk';

describe('normalizeStreamEvent', () => {
  it('normalizes an assistant message to its text and content', () => {
    const raw = {
      type: 'assistant',
      text: 'hello',
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    } as unknown as DroidStreamEvent;
    const event = normalizeStreamEvent(raw);
    expect(event.type).toBe('assistant');
    if (event.type !== 'assistant') throw new Error('unreachable');
    expect(event.text).toBe('hello');
    expect(event.messageId).toBe('m1');
  });

  it('normalizes partial deltas', () => {
    const event = normalizeStreamEvent({
      type: 'assistant_text_delta',
      messageId: 'm1',
      blockIndex: 0,
      text: 'he',
    } as unknown as DroidStreamEvent);
    expect(event.type).toBe('assistant_text_delta');
    if (event.type !== 'assistant_text_delta') throw new Error('unreachable');
    expect(event.text).toBe('he');
    expect(event.messageId).toBe('m1');
  });

  it('normalizes thinking deltas', () => {
    const event = normalizeStreamEvent({
      type: 'thinking_text_delta',
      messageId: 'm1',
      blockIndex: 2,
      text: 'hmm',
    } as unknown as DroidStreamEvent);
    expect(event.type).toBe('thinking_text_delta');
    if (event.type !== 'thinking_text_delta') throw new Error('unreachable');
    expect(event.blockIndex).toBe(2);
  });

  it('normalizes tool calls and results', () => {
    const call = normalizeStreamEvent({
      type: 'tool_call',
      name: 'apply_patch',
      toolUseId: 't1',
      input: { path: 'a.txt' },
    } as unknown as DroidStreamEvent);
    expect(call.type).toBe('tool_call');
    if (call.type !== 'tool_call') throw new Error('unreachable');
    expect(call.toolName).toBe('apply_patch');
    expect(call.toolUseId).toBe('t1');

    const delta = normalizeStreamEvent({
      type: 'tool_call_delta',
      toolUse: { type: 'tool_use', toolName: 'apply_patch', toolUseId: 't1', input: {} },
    } as unknown as DroidStreamEvent);
    expect(delta.type).toBe('tool_call_delta');
    if (delta.type !== 'tool_call_delta') throw new Error('unreachable');
    expect(delta.toolName).toBe('apply_patch');

    const result = normalizeStreamEvent({
      type: 'tool_result',
      toolUseId: 't1',
      toolName: 'apply_patch',
      content: 'done',
      isError: false,
    } as unknown as DroidStreamEvent);
    expect(result.type).toBe('tool_result');
    if (result.type !== 'tool_result') throw new Error('unreachable');
    expect(result.isError).toBe(false);
  });

  it('normalizes the terminal result of a turn', () => {
    const raw = {
      type: 'result',
      subtype: 'success',
      sessionId: 's1',
      durationMs: 1200,
      tokenUsage: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0, thinkingTokens: 0 },
      messages: [],
      text: 'OK',
      turnCount: 1,
      success: true,
      interrupted: false,
      error: null,
    } as unknown as DroidStreamEvent;
    const event = normalizeStreamEvent(raw);
    expect(event.type).toBe('result');
    if (event.type !== 'result') throw new Error('unreachable');
    expect(event.success).toBe(true);
    expect(event.interrupted).toBe(false);
    expect(event.text).toBe('OK');
    expect(event.tokenUsage?.outputTokens).toBe(2);
  });

  it('normalizes working state and token usage', () => {
    const working = normalizeStreamEvent({
      type: 'working_state_changed',
      state: 'executing_tool',
    } as unknown as DroidStreamEvent);
    expect(working.type).toBe('working_state');
    if (working.type !== 'working_state') throw new Error('unreachable');
    expect(working.state).toBe('executing_tool');

    const usage = normalizeStreamEvent({
      type: 'token_usage_update',
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      thinkingTokens: 0,
    } as unknown as DroidStreamEvent);
    expect(usage.type).toBe('token_usage');
    if (usage.type !== 'token_usage') throw new Error('unreachable');
    expect(usage.usage.inputTokens).toBe(10);
  });

  it('normalizes hook executions', () => {
    const hook = normalizeStreamEvent({
      type: 'hook',
      hookId: 'h1',
      eventName: 'Stop',
      status: 'completed',
      exitCode: 0,
    } as unknown as DroidStreamEvent);
    expect(hook.type).toBe('hook');
    if (hook.type !== 'hook') throw new Error('unreachable');
    expect(hook.eventName).toBe('Stop');
    expect(hook.status).toBe('completed');
  });

  it('normalizes mission events', () => {
    const state = normalizeStreamEvent({
      type: 'mission_state_changed',
      state: 'running',
    } as unknown as DroidStreamEvent);
    expect(state.type).toBe('mission_state_changed');
    if (state.type !== 'mission_state_changed') throw new Error('unreachable');
    expect(state.state).toBe('running');

    const worker = normalizeStreamEvent({
      type: 'mission_worker_completed',
      workerSessionId: 'w1',
      exitCode: 0,
    } as unknown as DroidStreamEvent);
    expect(worker.type).toBe('mission_worker_completed');
  });

  it('redacts keys inside error events', () => {
    const event = normalizeStreamEvent({
      type: 'error',
      message: 'request failed for fk-abc-123456',
      errorType: 'api',
      timestamp: '2026-10-04T00:00:00Z',
    } as unknown as DroidStreamEvent);
    expect(event.type).toBe('error');
    if (event.type !== 'error') throw new Error('unreachable');
    expect(event.message).not.toContain('fk-abc-123456');
    expect(event.message).toContain('[REDACTED]');
  });

  it('normalizes user messages, title and settings updates', () => {
    const user = normalizeStreamEvent({
      type: 'user',
      message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }] },
    } as unknown as DroidStreamEvent);
    expect(user.type).toBe('user');

    const title = normalizeStreamEvent({ type: 'session_title_updated', title: 't' } as unknown as DroidStreamEvent);
    expect(title.type).toBe('session_title_updated');

    const settings = normalizeStreamEvent({
      type: 'settings_updated',
      settings: { modelId: 'm' },
    } as unknown as DroidStreamEvent);
    expect(settings.type).toBe('settings_updated');
  });

  it('maps unrecognized event types to unknown while preserving the raw event', () => {
    const raw = { type: 'brand_new_event', payload: { x: 1 } } as unknown as DroidStreamEvent;
    const event = normalizeStreamEvent(raw);
    expect(event.type).toBe('unknown');
    if (event.type !== 'unknown') throw new Error('unreachable');
    expect(event.raw).toBe(raw);
  });
});
