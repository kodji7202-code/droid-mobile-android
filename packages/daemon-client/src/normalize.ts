/**
 * Normalizes SDK stream events into the stable event union consumed by the
 * UI (design note: "stream(prompt, opts) as an async iterable of
 * normalized events"). Pure function, unit-tested; unknown event types are
 * passed through as `unknown` so future daemons do not crash the app.
 */
import type {
  DroidStreamEvent,
  FactoryDroidMessage,
  MissionFeature,
  MissionState,
  McpServerStatusInfo,
  McpStatusSummary,
  ProgressLogEntry,
  SettingsUpdatedPayload,
  TokenUsage,
  ToolConfirmationOutcome,
  ToolProgressUpdate,
} from '@factory/droid-sdk';
import { redactSecrets } from './redact';

export type NormalizedEvent =
  | { type: 'user'; message: FactoryDroidMessage }
  | { type: 'assistant'; messageId?: string; text: string; message: FactoryDroidMessage }
  | { type: 'assistant_text_delta'; messageId: string; blockIndex: number; text: string }
  | { type: 'assistant_text_complete'; messageId: string; blockIndex: number }
  | { type: 'assistant_message_retracted'; messageId: string }
  | { type: 'thinking_text_delta'; messageId: string; blockIndex: number; text: string }
  | { type: 'thinking_text_complete'; messageId: string; blockIndex: number; durationMs?: number }
  | { type: 'tool_call'; toolName: string; toolUseId: string; input: Record<string, unknown> }
  | { type: 'tool_call_delta'; toolName: string; toolUseId: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; toolUseId: string; content: unknown; isError: boolean }
  | { type: 'tool_progress'; toolName: string; toolUseId: string; content: string; update: ToolProgressUpdate }
  | { type: 'hook'; hookId: string; eventName?: string; matcher?: string; toolCallId?: string; status: 'started' | 'completed' | 'error'; exitCode?: number; stdout?: string; stderr?: string }
  | { type: 'error'; message: string; errorType?: string; timestamp?: string }
  | { type: 'result'; sessionId: string; subtype: string; success: boolean; interrupted: boolean; durationMs: number; text: string; turnCount: number; tokenUsage: TokenUsage | null }
  | { type: 'working_state'; state: string }
  | { type: 'token_usage'; usage: TokenUsage }
  | { type: 'settings_updated'; settings: SettingsUpdatedPayload }
  | { type: 'session_title_updated'; title: string }
  | { type: 'session_working_directory_changed'; cwd: string }
  | { type: 'permission_resolved'; requestId: string; selectedOption: ToolConfirmationOutcome }
  | { type: 'mcp_status_changed'; servers: McpServerStatusInfo[]; summary: McpStatusSummary }
  | { type: 'mcp_auth_required'; serverName: string; authUrl: string; message: string; state: string }
  | { type: 'mcp_auth_completed'; serverName: string; message: string }
  | { type: 'mission_state_changed'; state: MissionState }
  | { type: 'mission_features_changed'; features: MissionFeature[] }
  | { type: 'mission_progress_entry'; progressLog: ProgressLogEntry[] }
  | { type: 'mission_heartbeat'; timestamp: string }
  | { type: 'mission_worker_started'; workerSessionId: string }
  | { type: 'mission_worker_completed'; workerSessionId: string; exitCode: number }
  | { type: 'unknown'; raw: DroidStreamEvent };

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Normalizes one raw SDK stream event. Never throws: anything unrecognized
 * (or from a newer daemon) becomes `{ type: 'unknown', raw }`.
 */
export function normalizeStreamEvent(raw: DroidStreamEvent): NormalizedEvent {
  const rawRecord = asRecord(raw);
  switch (rawRecord.type) {
    case 'user':
      return { type: 'user', message: rawRecord.message as FactoryDroidMessage };
    case 'assistant': {
      const message = rawRecord.message as FactoryDroidMessage;
      return {
        type: 'assistant',
        messageId: asString(message?.id),
        text: asString(rawRecord.text) ?? '',
        message,
      };
    }
    case 'assistant_text_delta':
      return {
        type: 'assistant_text_delta',
        messageId: asString(rawRecord.messageId) ?? '',
        blockIndex: Number(rawRecord.blockIndex ?? 0),
        text: asString(rawRecord.text) ?? '',
      };
    case 'assistant_text_complete':
      return {
        type: 'assistant_text_complete',
        messageId: asString(rawRecord.messageId) ?? '',
        blockIndex: Number(rawRecord.blockIndex ?? 0),
      };
    case 'assistant_message_retracted':
      return { type: 'assistant_message_retracted', messageId: asString(rawRecord.messageId) ?? '' };
    case 'thinking_text_delta':
      return {
        type: 'thinking_text_delta',
        messageId: asString(rawRecord.messageId) ?? '',
        blockIndex: Number(rawRecord.blockIndex ?? 0),
        text: asString(rawRecord.text) ?? '',
      };
    case 'thinking_text_complete':
      return {
        type: 'thinking_text_complete',
        messageId: asString(rawRecord.messageId) ?? '',
        blockIndex: Number(rawRecord.blockIndex ?? 0),
        durationMs: typeof rawRecord.durationMs === 'number' ? rawRecord.durationMs : undefined,
      };
    case 'tool_call':
      return {
        type: 'tool_call',
        toolName: asString(rawRecord.name) ?? 'unknown',
        toolUseId: asString(rawRecord.toolUseId) ?? '',
        input: asRecord(rawRecord.input),
      };
    case 'tool_call_delta': {
      const toolUse = asRecord(rawRecord.toolUse);
      return {
        type: 'tool_call_delta',
        toolName: asString(toolUse.toolName) ?? 'unknown',
        toolUseId: asString(toolUse.toolUseId) ?? '',
        input: asRecord(toolUse.input),
      };
    }
    case 'tool_result':
      return {
        type: 'tool_result',
        toolName: asString(rawRecord.toolName) ?? 'unknown',
        toolUseId: asString(rawRecord.toolUseId) ?? '',
        content: rawRecord.content,
        isError: rawRecord.isError === true,
      };
    case 'tool_progress':
      return {
        type: 'tool_progress',
        toolName: asString(rawRecord.toolName) ?? 'unknown',
        toolUseId: asString(rawRecord.toolUseId) ?? '',
        content: asString(rawRecord.content) ?? '',
        update: rawRecord.update as ToolProgressUpdate,
      };
    case 'hook':
      return {
        type: 'hook',
        hookId: asString(rawRecord.hookId) ?? '',
        eventName: asString(rawRecord.eventName),
        matcher: asString(rawRecord.matcher),
        toolCallId: asString(rawRecord.toolCallId),
        status: (asString(rawRecord.status) ?? 'started') as 'started' | 'completed' | 'error',
        exitCode: typeof rawRecord.exitCode === 'number' ? rawRecord.exitCode : undefined,
        stdout: asString(rawRecord.stdout),
        stderr: asString(rawRecord.stderr),
      };
    case 'error':
      return {
        type: 'error',
        message: redactSecrets(asString(rawRecord.message) ?? 'The daemon reported an error.'),
        errorType: asString(rawRecord.errorType),
        timestamp: asString(rawRecord.timestamp),
      };
    case 'result':
      return {
        type: 'result',
        sessionId: asString(rawRecord.sessionId) ?? '',
        subtype: asString(rawRecord.subtype) ?? 'unknown',
        success: rawRecord.success === true,
        interrupted: rawRecord.interrupted === true,
        durationMs: Number(rawRecord.durationMs ?? 0),
        text: asString(rawRecord.text) ?? '',
        turnCount: Number(rawRecord.turnCount ?? 0),
        tokenUsage: (rawRecord.tokenUsage as TokenUsage | null) ?? null,
      };
    case 'working_state_changed':
      return { type: 'working_state', state: asString(rawRecord.state) ?? 'idle' };
    case 'token_usage_update': {
      const { type: _type, ...usage } = rawRecord;
      return { type: 'token_usage', usage: usage as TokenUsage };
    }
    case 'settings_updated':
      return { type: 'settings_updated', settings: rawRecord.settings as SettingsUpdatedPayload };
    case 'session_title_updated':
      return { type: 'session_title_updated', title: asString(rawRecord.title) ?? '' };
    case 'session_working_directory_changed':
      return { type: 'session_working_directory_changed', cwd: asString(rawRecord.cwd) ?? '' };
    case 'permission_resolved':
      return {
        type: 'permission_resolved',
        requestId: asString(rawRecord.requestId) ?? '',
        selectedOption: rawRecord.selectedOption as ToolConfirmationOutcome,
      };
    case 'mcp_status_changed':
      return {
        type: 'mcp_status_changed',
        servers: (rawRecord.servers as McpServerStatusInfo[]) ?? [],
        summary: rawRecord.summary as McpStatusSummary,
      };
    case 'mcp_auth_required':
      return {
        type: 'mcp_auth_required',
        serverName: asString(rawRecord.serverName) ?? '',
        authUrl: asString(rawRecord.authUrl) ?? '',
        message: asString(rawRecord.message) ?? '',
        state: asString(rawRecord.state) ?? '',
      };
    case 'mcp_auth_completed':
      return {
        type: 'mcp_auth_completed',
        serverName: asString(rawRecord.serverName) ?? '',
        message: asString(rawRecord.message) ?? '',
      };
    case 'mission_state_changed':
      return { type: 'mission_state_changed', state: rawRecord.state as MissionState };
    case 'mission_features_changed':
      return { type: 'mission_features_changed', features: (rawRecord.features as MissionFeature[]) ?? [] };
    case 'mission_progress_entry':
      return { type: 'mission_progress_entry', progressLog: (rawRecord.progressLog as ProgressLogEntry[]) ?? [] };
    case 'mission_heartbeat':
      return { type: 'mission_heartbeat', timestamp: asString(rawRecord.timestamp) ?? '' };
    case 'mission_worker_started':
      return { type: 'mission_worker_started', workerSessionId: asString(rawRecord.workerSessionId) ?? '' };
    case 'mission_worker_completed':
      return {
        type: 'mission_worker_completed',
        workerSessionId: asString(rawRecord.workerSessionId) ?? '',
        exitCode: Number(rawRecord.exitCode ?? 0),
      };
    default:
      return { type: 'unknown', raw };
  }
}
