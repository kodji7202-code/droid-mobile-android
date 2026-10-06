/**
 * Custom (bring-your-own-key) models over the SDK facade (`droid.customModels`).
 * The daemon owns the stored key: lists carry only `hasApiKey` and a mask, and an
 * upsert without `apiKey` leaves the stored key untouched (verified against
 * daemon 0.232.0). Edits and deletes address an entry by `rawIndex` plus
 * `expectedModel` so a concurrent change cannot hit another entry.
 */
import type { ConnectedDroid } from '@factory/droid-sdk';
import { DaemonClientError } from './errors';
import type { ScratchSessionDeps } from './scratch-session';

type RawCustomModel = Awaited<ReturnType<ConnectedDroid['customModels']['list']>>[number];

export const CUSTOM_MODEL_PROVIDERS = [
  'anthropic',
  'openai',
  'generic-chat-completion-api',
] as const;
export type CustomModelProvider = (typeof CUSTOM_MODEL_PROVIDERS)[number];

export interface CustomModel {
  /** Position in the daemon's own list; required to edit or delete the entry. */
  rawIndex: number;
  model: string;
  displayName?: string;
  provider: string;
  baseUrl?: string;
  hasApiKey: boolean;
  /** Bullets plus at most the last four characters of the key. */
  apiKeyMask?: string;
  isValid: boolean;
}

export interface CustomModelInput {
  provider: CustomModelProvider;
  model: string;
  displayName?: string;
  baseUrl?: string;
  /** Empty or absent on an edit keeps the stored key. */
  apiKey?: string;
}

export interface CustomModelTarget {
  rawIndex: number;
  model: string;
}

export interface CustomModelsClient {
  list(): Promise<CustomModel[]>;
  /** Adds an entry, or edits `target` when given. */
  save(input: CustomModelInput, target?: CustomModelTarget): Promise<void>;
  remove(target: CustomModelTarget): Promise<void>;
}

export type CustomModelsClientDeps = ScratchSessionDeps;

const BULLET = '•';
const MASK_TAIL = 4;

/** Whatever the daemon sends, only bullets and the last four characters leave this module. */
function safeMask(mask: string): string {
  const tail = mask.replace(/^•+/, '');
  if (tail.length <= MASK_TAIL) return mask;
  return BULLET.repeat(MASK_TAIL) + tail.slice(-MASK_TAIL);
}

export function toCustomModel(info: Readonly<RawCustomModel>): CustomModel {
  return {
    rawIndex: info.rawIndex,
    model: info.model,
    ...(info.displayName !== undefined ? { displayName: info.displayName } : {}),
    provider: info.provider,
    ...(info.baseUrl !== undefined ? { baseUrl: info.baseUrl } : {}),
    hasApiKey: info.hasApiKey,
    ...(info.hasApiKey && info.apiKeyMask !== undefined
      ? { apiKeyMask: safeMask(info.apiKeyMask) }
      : {}),
    isValid: info.isValid,
  };
}

/** Daemon text can echo the request; the typed key is removed and the original cause is dropped. */
function scrub(error: unknown, secret: string | undefined): never {
  const text = error instanceof Error ? error.message : String(error);
  const cleaned = secret ? text.split(secret).join('[REDACTED]') : text;
  throw new DaemonClientError(error instanceof DaemonClientError ? error.kind : 'unknown', cleaned);
}

function upsertParams(input: CustomModelInput, target: CustomModelTarget | undefined) {
  return {
    ...(target ? { rawIndex: target.rawIndex, expectedModel: target.model } : {}),
    provider: input.provider,
    model: input.model,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  };
}

export function createCustomModelsClient(deps: CustomModelsClientDeps): CustomModelsClient {
  return {
    list: async () => (await deps.run(() => deps.droid().customModels.list())).map(toCustomModel),
    save: async (input, target) => {
      const result = await deps
        .run(() => deps.droid().customModels.upsert(upsertParams(input, target)))
        .catch((error: unknown) => scrub(error, input.apiKey));
      if (!result.success) {
        throw new DaemonClientError('unknown', 'The daemon did not save the custom model.');
      }
    },
    remove: async (target) => {
      const result = await deps.run(() =>
        deps
          .droid()
          .customModels.delete({ rawIndex: target.rawIndex, expectedModel: target.model }),
      );
      if (!result.success) {
        throw new DaemonClientError('unknown', 'The daemon did not remove the custom model.');
      }
    },
  };
}
