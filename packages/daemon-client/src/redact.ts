/**
 * Redacts secret material from free-form text (error messages, logs) and
 * structured values. Factory API keys start with `fk-`; any other credential is
 * recognised by its name (apiKey, token, secret, password, authorization,
 * bearer) because its format is unknowable (architecture.md section 3.1:
 * "Never logs credentials; redacts apiKey/token in any serialized error").
 */
const FACTORY_API_KEY_PATTERN = /fk-[A-Za-z0-9][A-Za-z0-9_-]*/g;

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

const NAMED_CREDENTIAL_PATTERN =
  /((?:api[-_ ]?key|token|secret|password|passwd|authorization)s?["']?\s*[:=]\s*)(?:(?:Basic|Bearer|Digest)\s+)?(?:"[^"]*"|'[^']*'|(?!\[REDACTED\])[^\s"',;&}\])]+)/gi;

/** Basic credentials are base64: require a non-letter character so prose ("Basic usage") survives. */
const BASIC_PATTERN = /\bBasic\s+(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]+={0,2}/g;

const SENSITIVE_KEY_PATTERN = /api[-_]?key|token|secret|password|passwd|authorization|credential/i;

export const REDACTED = '[REDACTED]';

export function redactSecrets(text: string): string {
  return text
    .replace(FACTORY_API_KEY_PATTERN, REDACTED)
    .replace(NAMED_CREDENTIAL_PATTERN, (match: string, prefix: string) => {
      const quote =
        /^(?:(?:Basic|Bearer|Digest)\s+)?(["'])/i.exec(match.slice(prefix.length))?.[1] ?? '';
      return `${prefix}${quote}${REDACTED}${quote}`;
    })
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(BASIC_PATTERN, `Basic ${REDACTED}`);
}

/**
 * Deep-copies a value for serialization: values under sensitive property names
 * are replaced whatever their format, and every remaining string is scrubbed.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(item, depth + 1);
  }
  return copy;
}
