import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, formFromModel, validateCustomModelForm } from './customModelForm';
import type { CustomModelFormValues } from './customModelForm';

const valid: CustomModelFormValues = {
  provider: 'generic-chat-completion-api',
  displayName: ' val-byok2 ',
  model: ' val-model-2 ',
  baseUrl: ' http://127.0.0.1:3198/v1 ',
  apiKey: 'sk-dummy-0000-NOTAREALKEY',
};

describe('validateCustomModelForm', () => {
  it('trims the text fields and returns the payload', () => {
    const result = validateCustomModelForm(valid, { existingModels: [], editing: false });
    expect(result).toEqual({
      ok: true,
      input: {
        provider: 'generic-chat-completion-api',
        displayName: 'val-byok2',
        model: 'val-model-2',
        baseUrl: 'http://127.0.0.1:3198/v1',
        apiKey: 'sk-dummy-0000-NOTAREALKEY',
      },
    });
  });

  it('flags an empty model id', () => {
    const result = validateCustomModelForm(
      { ...valid, model: '   ' },
      { existingModels: [], editing: false },
    );
    expect(result).toEqual({ ok: false, errors: { model: 'required' } });
  });

  it.each(['ftp://x', 'x.test/v1', 'javascript:alert(1)', 'http://', 'file:///etc/passwd'])(
    'rejects the base URL %s',
    (baseUrl) => {
      const result = validateCustomModelForm(
        { ...valid, baseUrl },
        { existingModels: [], editing: false },
      );
      expect(result).toEqual({ ok: false, errors: { baseUrl: 'invalid' } });
    },
  );

  it('requires a base URL', () => {
    const result = validateCustomModelForm(
      { ...valid, baseUrl: '' },
      { existingModels: [], editing: false },
    );
    expect(result).toEqual({ ok: false, errors: { baseUrl: 'required' } });
  });

  it('accepts https URLs', () => {
    const result = validateCustomModelForm(
      { ...valid, baseUrl: 'https://api.example.com/v1' },
      { existingModels: [], editing: false },
    );
    expect(result.ok).toBe(true);
  });

  it('requires an API key when adding but not when editing', () => {
    const empty = { ...valid, apiKey: '' };
    expect(validateCustomModelForm(empty, { existingModels: [], editing: false })).toEqual({
      ok: false,
      errors: { apiKey: 'required' },
    });
    const edited = validateCustomModelForm(empty, { existingModels: [], editing: true });
    expect(edited.ok).toBe(true);
    if (edited.ok) expect('apiKey' in edited.input).toBe(false);
  });

  it('does not trim the API key but treats whitespace only as empty', () => {
    const result = validateCustomModelForm(
      { ...valid, apiKey: '  ' },
      { existingModels: [], editing: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect('apiKey' in result.input).toBe(false);
  });

  it('rejects a model id that another entry already uses', () => {
    const existing = { existingModels: ['val-model-2', 'other'], editing: false };
    expect(validateCustomModelForm(valid, existing)).toEqual({
      ok: false,
      errors: { model: 'duplicate' },
    });
    expect(validateCustomModelForm(valid, { existingModels: ['other'], editing: false }).ok).toBe(
      true,
    );
  });

  it('omits an empty display name', () => {
    const result = validateCustomModelForm(
      { ...valid, displayName: '  ' },
      { existingModels: [], editing: false },
    );
    expect(result.ok && 'displayName' in result.input).toBe(false);
  });

  it('reports every failing field at once', () => {
    const result = validateCustomModelForm(
      { ...EMPTY_FORM },
      { existingModels: [], editing: false },
    );
    expect(result).toEqual({
      ok: false,
      errors: { model: 'required', baseUrl: 'required', apiKey: 'required' },
    });
  });
});

describe('formFromModel', () => {
  it('fills the form from a list entry and never carries a key', () => {
    expect(
      formFromModel({
        rawIndex: 1,
        model: 'val-model-1',
        displayName: 'val-byok',
        provider: 'openai',
        baseUrl: 'http://127.0.0.1:3198/v1',
        hasApiKey: true,
        apiKeyMask: '••••LKEY',
        isValid: true,
      }),
    ).toEqual({
      provider: 'openai',
      displayName: 'val-byok',
      model: 'val-model-1',
      baseUrl: 'http://127.0.0.1:3198/v1',
      apiKey: '',
    });
  });

  it('falls back to the first provider for one the app does not offer', () => {
    expect(
      formFromModel({
        rawIndex: 0,
        model: 'm',
        provider: 'bedrock',
        hasApiKey: false,
        isValid: false,
      }).provider,
    ).toBe('anthropic');
  });
});
