import { describe, expect, it, vi } from 'vitest';
import type { ConnectedDroid } from '@factory/droid-sdk';
import { createCustomModelsClient, toCustomModel } from './custom-models';

type Raw = Parameters<typeof toCustomModel>[0];

const DUMMY = 'sk-dummy-0000-NOTAREALKEY';

function raw(overrides: Partial<Raw> = {}): Raw {
  return {
    rawIndex: 0,
    model: 'val-model-1',
    displayName: 'val-byok',
    provider: 'generic-chat-completion-api',
    baseUrl: 'http://127.0.0.1:3198/v1',
    hasApiKey: true,
    apiKeyMask: '••••LKEY',
    hasBedrockConfig: false,
    isValid: true,
    ...overrides,
  };
}

function harness(initial: Raw[] = [raw()], failure?: 'result' | Error) {
  const models = initial;
  const list = vi.fn(async () => models);
  const upsert = vi.fn(async (_params: Record<string, unknown>) => {
    if (failure instanceof Error) throw failure;
    return { success: failure !== 'result', models };
  });
  const remove = vi.fn(async (_params: { rawIndex: number; expectedModel: string }) => {
    if (failure instanceof Error) throw failure;
    return { success: failure !== 'result', models };
  });
  const droid = { customModels: { list, upsert, delete: remove } } as unknown as ConnectedDroid;
  const client = createCustomModelsClient({
    droid: () => droid,
    generation: () => 1,
    run: (op) => op(),
  });
  return { client, list, upsert, remove };
}

describe('toCustomModel', () => {
  it('keeps the listed fields and the daemon mask, never an apiKey', () => {
    const model = toCustomModel(raw());
    expect(model).toEqual({
      rawIndex: 0,
      model: 'val-model-1',
      displayName: 'val-byok',
      provider: 'generic-chat-completion-api',
      baseUrl: 'http://127.0.0.1:3198/v1',
      hasApiKey: true,
      apiKeyMask: '••••LKEY',
      isValid: true,
    });
    expect('apiKey' in model).toBe(false);
  });

  it('omits absent optional fields and the mask when there is no key', () => {
    const model = toCustomModel(
      raw({ displayName: undefined, baseUrl: undefined, hasApiKey: false, apiKeyMask: undefined }),
    );
    expect(model).toEqual({
      rawIndex: 0,
      model: 'val-model-1',
      provider: 'generic-chat-completion-api',
      hasApiKey: false,
      isValid: true,
    });
  });

  it('shows at most the last four characters behind bullets even if the daemon sent more', () => {
    const model = toCustomModel(raw({ apiKeyMask: DUMMY }));
    expect(model.apiKeyMask).toBe('••••LKEY');
    expect(model.apiKeyMask).not.toContain('NOTAREA');
  });

  it('keeps a mask that is already bullets plus a short tail', () => {
    expect(toCustomModel(raw({ apiKeyMask: '••••••••' })).apiKeyMask).toBe('••••••••');
    expect(toCustomModel(raw({ apiKeyMask: '••••ab' })).apiKeyMask).toBe('••••ab');
  });
});

describe('createCustomModelsClient', () => {
  it('lists the daemon entries', async () => {
    const { client } = harness([raw(), raw({ rawIndex: 1, model: 'val-model-3' })]);
    const models = await client.list();
    expect(models.map((m) => m.model)).toEqual(['val-model-1', 'val-model-3']);
  });

  it('adds without rawIndex and sends the typed key', async () => {
    const { client, upsert } = harness();
    await client.save({
      provider: 'openai',
      displayName: 'val-byok2',
      model: 'val-model-2',
      baseUrl: 'http://127.0.0.1:3198/v1',
      apiKey: DUMMY,
    });
    expect(upsert).toHaveBeenCalledWith({
      provider: 'openai',
      displayName: 'val-byok2',
      model: 'val-model-2',
      baseUrl: 'http://127.0.0.1:3198/v1',
      apiKey: DUMMY,
    });
  });

  it('edits through rawIndex and expectedModel and omits an empty key', async () => {
    const { client, upsert } = harness();
    await client.save(
      {
        provider: 'generic-chat-completion-api',
        displayName: 'val-byok2-renamed',
        model: 'val-model-1',
        baseUrl: 'http://127.0.0.1:3198/v1',
        apiKey: '',
      },
      { rawIndex: 2, model: 'val-model-1' },
    );
    const sent = upsert.mock.calls[0]![0];
    expect(sent).toMatchObject({ rawIndex: 2, expectedModel: 'val-model-1' });
    expect('apiKey' in sent).toBe(false);
  });

  it('omits an empty display name and base URL', async () => {
    const { client, upsert } = harness();
    await client.save({ provider: 'anthropic', model: 'm', displayName: '', baseUrl: '' });
    expect(upsert.mock.calls[0]![0]).toEqual({ provider: 'anthropic', model: 'm' });
  });

  it('keeps the typed key out of an error that echoes it', async () => {
    const { client } = harness([raw()], new Error(`bad request for ${DUMMY}`));
    let message = '';
    try {
      await client.save({ provider: 'openai', model: 'x', apiKey: DUMMY });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('bad request');
    expect(message).not.toContain('NOTAREALKEY');
  });

  it('turns success=false into an error', async () => {
    const { client } = harness([raw()], 'result');
    await expect(client.save({ provider: 'openai', model: 'x' })).rejects.toThrow(
      'The daemon did not save the custom model.',
    );
    await expect(client.remove({ rawIndex: 0, model: 'val-model-1' })).rejects.toThrow(
      'The daemon did not remove the custom model.',
    );
  });

  it('deletes with rawIndex and expectedModel', async () => {
    const { client, remove } = harness();
    await client.remove({ rawIndex: 3, model: 'val-model-1' });
    expect(remove).toHaveBeenCalledWith({ rawIndex: 3, expectedModel: 'val-model-1' });
  });
});
