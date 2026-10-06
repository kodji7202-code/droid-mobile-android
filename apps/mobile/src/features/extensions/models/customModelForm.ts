import { CUSTOM_MODEL_PROVIDERS } from '@droidmobile/daemon-client';
import type {
  CustomModel,
  CustomModelInput,
  CustomModelProvider,
} from '@droidmobile/daemon-client';

export interface CustomModelFormValues {
  provider: CustomModelProvider;
  displayName: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export type CustomModelFieldError = 'required' | 'invalid' | 'duplicate';
export type CustomModelFormField = 'model' | 'baseUrl' | 'apiKey';
export type CustomModelFormErrors = Partial<Record<CustomModelFormField, CustomModelFieldError>>;

export type CustomModelFormResult =
  { ok: true; input: CustomModelInput } | { ok: false; errors: CustomModelFormErrors };

export const EMPTY_FORM: CustomModelFormValues = {
  provider: CUSTOM_MODEL_PROVIDERS[0],
  displayName: '',
  model: '',
  baseUrl: '',
  apiKey: '',
};

interface ValidationContext {
  /** Model ids of the other entries; the entry being edited is not in this list. */
  existingModels: readonly string[];
  /** An edit may leave the key empty to keep the stored one. */
  editing: boolean;
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** The daemon stores whatever it gets, so every rule is enforced before a request is sent. */
export function validateCustomModelForm(
  values: CustomModelFormValues,
  { existingModels, editing }: ValidationContext,
): CustomModelFormResult {
  const errors: CustomModelFormErrors = {};
  const model = values.model.trim();
  const baseUrl = values.baseUrl.trim();
  const displayName = values.displayName.trim();
  const apiKey = values.apiKey.trim() === '' ? '' : values.apiKey;

  if (model === '') errors.model = 'required';
  else if (existingModels.includes(model)) errors.model = 'duplicate';

  if (baseUrl === '') errors.baseUrl = 'required';
  else if (!isHttpUrl(baseUrl)) errors.baseUrl = 'invalid';

  if (apiKey === '' && !editing) errors.apiKey = 'required';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      provider: values.provider,
      model,
      baseUrl,
      ...(displayName !== '' ? { displayName } : {}),
      ...(apiKey !== '' ? { apiKey } : {}),
    },
  };
}

const isOffered = (provider: string): provider is CustomModelProvider =>
  (CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(provider);

/** Edit form values for an entry; the stored key is never part of them. */
export function formFromModel(model: CustomModel): CustomModelFormValues {
  return {
    provider: isOffered(model.provider) ? model.provider : CUSTOM_MODEL_PROVIDERS[0],
    displayName: model.displayName ?? '',
    model: model.model,
    baseUrl: model.baseUrl ?? '',
    apiKey: '',
  };
}
