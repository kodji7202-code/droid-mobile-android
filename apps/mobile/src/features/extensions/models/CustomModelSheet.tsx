import { useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { CUSTOM_MODEL_PROVIDERS } from '@droidmobile/daemon-client';
import type {
  CustomModel,
  CustomModelInput,
  CustomModelProvider,
  CustomModelTarget,
} from '@droidmobile/daemon-client';
import { Sheet } from '../../../components/Sheet';
import { ActionMessage } from '../plugins/ActionMessage';
import { EMPTY_FORM, formFromModel, validateCustomModelForm } from './customModelForm';
import type {
  CustomModelFormErrors,
  CustomModelFormField,
  CustomModelFormValues,
} from './customModelForm';

interface CustomModelSheetProps {
  open: boolean;
  onClose: () => void;
  /** The entry being edited; null adds a new one. */
  editing: CustomModel | null;
  /** Model ids of the entries other than the one being edited. */
  otherModels: readonly string[];
  /** Resolves true when the daemon saved the entry. */
  onSubmit: (input: CustomModelInput, target?: CustomModelTarget) => Promise<boolean>;
  saving: boolean;
  /** The daemon's refusal of the last submission, when there was one. */
  error: { message: string } | null;
  onDismissError: () => void;
}

interface FieldProps {
  field: 'displayName' | CustomModelFormField;
  label: string;
  /** Omit together with `inputRef` for an uncontrolled field. */
  value?: string;
  /** Uncontrolled input; React does not mirror its text into the `value` attribute. */
  inputRef?: RefObject<HTMLInputElement | null>;
  error?: string | undefined;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  hint?: string | undefined;
  placeholder?: string;
}

function Field({
  field,
  label,
  value,
  inputRef,
  error,
  onChange,
  type = 'text',
  hint,
  placeholder,
}: FieldProps) {
  const id = `custom-model-form-${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  const errorId = `${id}-error`;
  const secret = type === 'password';
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type={type}
        className="field__control"
        data-testid={id}
        {...(value !== undefined ? { value } : {})}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete={secret ? 'new-password' : 'off'}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <span className="field__error" id={errorId} role="alert" data-testid={errorId}>
          {error}
        </span>
      ) : hint ? (
        <span className="field__description">{hint}</span>
      ) : null}
    </div>
  );
}

function CustomModelForm({
  onClose,
  editing,
  otherModels,
  onSubmit,
  saving,
  error,
  onDismissError,
}: Omit<CustomModelSheetProps, 'open'>) {
  const { t } = useTranslation();
  const [values, setValues] = useState<CustomModelFormValues>(() =>
    editing ? formFromModel(editing) : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<CustomModelFormErrors>({});
  const keyInput = useRef<HTMLInputElement>(null);

  const clearError = (key: CustomModelFormField) =>
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });

  const set = (key: Exclude<keyof CustomModelFormValues, 'apiKey'>, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    if (key === 'model' || key === 'baseUrl') clearError(key);
  };

  const fieldError = (field: CustomModelFormField) =>
    errors[field] ? t(`customModels.form.errors.${field}.${errors[field]}`) : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validateCustomModelForm(
      { ...values, apiKey: keyInput.current?.value ?? '' },
      {
        existingModels: otherModels,
        editing: editing !== null,
      },
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const target = editing ? { rawIndex: editing.rawIndex, model: editing.model } : undefined;
    if (await onSubmit(result.input, target)) onClose();
  };

  return (
    <form className="mcp-form" noValidate onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label className="field__label" htmlFor="custom-model-form-provider">
          {t('customModels.form.provider')}
        </label>
        <select
          id="custom-model-form-provider"
          className="field__control"
          data-testid="custom-model-form-provider"
          value={values.provider}
          onChange={(event) => set('provider', event.target.value as CustomModelProvider)}
        >
          {CUSTOM_MODEL_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {t(`customModels.providers.${provider}`)}
            </option>
          ))}
        </select>
      </div>
      <Field
        field="displayName"
        label={t('customModels.form.displayName')}
        value={values.displayName}
        onChange={(value) => set('displayName', value)}
      />
      <Field
        field="model"
        label={t('customModels.form.model')}
        value={values.model}
        error={fieldError('model')}
        onChange={(value) => set('model', value)}
      />
      <Field
        field="baseUrl"
        label={t('customModels.form.baseUrl')}
        value={values.baseUrl}
        error={fieldError('baseUrl')}
        placeholder="https://api.example.com/v1"
        onChange={(value) => set('baseUrl', value)}
      />
      <Field
        field="apiKey"
        label={t('customModels.form.apiKey')}
        inputRef={keyInput}
        error={fieldError('apiKey')}
        type="password"
        placeholder={editing ? t('customModels.form.keyKeepPlaceholder') : undefined}
        hint={
          editing?.hasApiKey
            ? t('customModels.form.keyKeepHint', { mask: editing.apiKeyMask ?? '' })
            : t('customModels.form.keyHint')
        }
        onChange={() => clearError('apiKey')}
      />
      {error && !saving ? (
        <ActionMessage
          kind="error"
          testId="custom-model-form-error"
          detail={error.message}
          onDismiss={onDismissError}
        >
          {t('customModels.errors.save')}
        </ActionMessage>
      ) : null}
      <div className="mcp-form__actions">
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="custom-model-form-submit"
          disabled={saving}
        >
          {saving ? t('customModels.form.saving') : t('customModels.form.save')}
        </button>
      </div>
    </form>
  );
}

/** Add or edit form for a custom model. Leaving the key empty on an edit keeps the stored key. */
export function CustomModelSheet({ open, onClose, ...rest }: CustomModelSheetProps) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={rest.editing ? t('customModels.form.editTitle') : t('customModels.form.addTitle')}
      testId="custom-model-sheet"
    >
      <CustomModelForm onClose={onClose} {...rest} />
    </Sheet>
  );
}
