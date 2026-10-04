/**
 * Redacts secret material from free-form text (error messages, logs). Factory API
 * keys start with `fk-`; keys are never logged raw (architecture.md section 3.1:
 * "Never logs credentials; redacts apiKey/token in any serialized error").
 */
const FACTORY_API_KEY_PATTERN = /fk-[A-Za-z0-9][A-Za-z0-9_-]*/g;

export const REDACTED = '[REDACTED]';

export function redactSecrets(text: string): string {
  return text.replace(FACTORY_API_KEY_PATTERN, REDACTED);
}
