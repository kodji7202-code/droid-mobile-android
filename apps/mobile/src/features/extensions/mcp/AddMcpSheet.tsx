import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { AddMcpServerInput } from '@droidmobile/daemon-client';
import { Sheet } from '../../../components/Sheet';
import { MCP_TRANSPORTS, validateMcpForm } from './mcpForm';
import type {
  McpFieldError,
  McpFormErrors,
  McpFormField,
  McpFormValues,
  McpTransport,
} from './mcpForm';

interface AddMcpSheetProps {
  open: boolean;
  onClose: () => void;
  existingNames: readonly string[];
  /** Resolves true when the daemon accepted the server. */
  onSubmit: (input: AddMcpServerInput) => Promise<boolean>;
  adding: boolean;
  /** The daemon refused the last submission. */
  failed: boolean;
}

const EMPTY: McpFormValues = { type: 'stdio', name: '', url: '', command: '', args: '', env: '' };

interface FieldProps {
  field: McpFormField;
  label: string;
  value: string;
  error: McpFieldError | undefined;
  onChange: (value: string) => void;
  hint?: string;
  multiline?: boolean;
  placeholder?: string;
}

function Field({ field, label, value, error, onChange, hint, multiline, placeholder }: FieldProps) {
  const { t } = useTranslation();
  const id = `mcp-add-${field}`;
  const errorId = `${id}-error`;
  const common = {
    id,
    className: 'field__control',
    'data-testid': id,
    value,
    placeholder,
    autoCapitalize: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
  } as const;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...common} type="text" onChange={(event) => onChange(event.target.value)} />
      )}
      {hint && !error ? <span className="field__description">{hint}</span> : null}
      {error ? (
        <span className="field__error" id={errorId} role="alert" data-testid={errorId}>
          {t(`mcp.form.errors.${field}.${error}`)}
        </span>
      ) : null}
    </div>
  );
}

function AddMcpForm({
  onClose,
  existingNames,
  onSubmit,
  adding,
  failed,
}: Omit<AddMcpSheetProps, 'open'>) {
  const { t } = useTranslation();
  const [values, setValues] = useState<McpFormValues>(EMPTY);
  const [errors, setErrors] = useState<McpFormErrors>({});

  const set = <K extends keyof McpFormValues>(key: K, value: McpFormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key as McpFormField];
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validateMcpForm(values, existingNames);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    if (await onSubmit(result.input)) onClose();
  };

  return (
    <form className="mcp-form" noValidate onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label className="field__label" htmlFor="mcp-add-type">
          {t('mcp.form.transport')}
        </label>
        <select
          id="mcp-add-type"
          className="field__control"
          data-testid="mcp-add-type"
          value={values.type}
          onChange={(event) => set('type', event.target.value as McpTransport)}
        >
          {MCP_TRANSPORTS.map((transport) => (
            <option key={transport} value={transport}>
              {t(`mcp.form.transports.${transport}`)}
            </option>
          ))}
        </select>
      </div>
      <Field
        field="name"
        label={t('mcp.form.name')}
        value={values.name}
        error={errors.name}
        onChange={(value) => set('name', value)}
      />
      {values.type === 'stdio' ? (
        <>
          <Field
            field="command"
            label={t('mcp.form.command')}
            value={values.command}
            error={errors.command}
            placeholder="node"
            onChange={(value) => set('command', value)}
          />
          <Field
            field="args"
            label={t('mcp.form.args')}
            value={values.args}
            error={errors.args}
            hint={t('mcp.form.argsHint')}
            onChange={(value) => set('args', value)}
          />
          <Field
            field="env"
            label={t('mcp.form.env')}
            value={values.env}
            error={errors.env}
            hint={t('mcp.form.envHint')}
            multiline
            onChange={(value) => set('env', value)}
          />
        </>
      ) : (
        <Field
          field="url"
          label={t('mcp.form.url')}
          value={values.url}
          error={errors.url}
          placeholder="https://example.com/mcp"
          onChange={(value) => set('url', value)}
        />
      )}
      {failed && !adding ? (
        <p className="field__error" role="alert" data-testid="mcp-add-failed">
          {t('mcp.form.addFailed')}
        </p>
      ) : null}
      <div className="mcp-form__actions">
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="mcp-add-submit"
          disabled={adding}
        >
          {adding ? t('mcp.form.adding') : t('mcp.form.save')}
        </button>
      </div>
    </form>
  );
}

/** Add-server form. Every rule is checked here: the daemon accepts bad input silently. */
export function AddMcpSheet({ open, onClose, ...rest }: AddMcpSheetProps) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose} title={t('mcp.form.title')} testId="mcp-add-sheet">
      <AddMcpForm onClose={onClose} {...rest} />
    </Sheet>
  );
}
