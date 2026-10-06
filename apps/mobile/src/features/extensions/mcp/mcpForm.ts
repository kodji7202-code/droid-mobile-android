import type { AddMcpServerInput } from '@droidmobile/daemon-client';

export const MCP_TRANSPORTS = ['stdio', 'http', 'sse'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export interface McpFormValues {
  type: McpTransport;
  name: string;
  url: string;
  command: string;
  /** Shell-style: whitespace separated, single or double quotes group. */
  args: string;
  /** One KEY=VALUE per line. */
  env: string;
}

export type McpFieldError = 'required' | 'invalid' | 'duplicate';
export type McpFormField = 'name' | 'url' | 'command' | 'args' | 'env';
export type McpFormErrors = Partial<Record<McpFormField, McpFieldError>>;

export type McpFormResult =
  { ok: true; input: AddMcpServerInput } | { ok: false; errors: McpFormErrors };

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Splits an argument string; null when a quote is left open. */
export function parseArgs(text: string): string[] | null {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quote: string | null = null;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started) args.push(current);
  return args;
}

/** Reads KEY=VALUE lines; null when a non-empty line has no valid key. */
export function parseEnv(text: string): Record<string, string> | null {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const at = line.indexOf('=');
    const key = at < 0 ? '' : line.slice(0, at).trim();
    if (!ENV_KEY.test(key)) return null;
    env[key] = line.slice(at + 1);
  }
  return env;
}

function isHttpUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The daemon accepts anything (an empty name, a malformed URL, an existing
 * name that it silently overwrites), so every rule is enforced here.
 */
export function validateMcpForm(
  values: McpFormValues,
  existingNames: readonly string[],
): McpFormResult {
  const errors: McpFormErrors = {};
  const name = values.name.trim();
  if (name === '') errors.name = 'required';
  else if (existingNames.includes(name)) errors.name = 'duplicate';

  if (values.type === 'stdio') {
    const command = values.command.trim();
    const args = parseArgs(values.args);
    const env = parseEnv(values.env);
    if (command === '') errors.command = 'required';
    if (args === null) errors.args = 'invalid';
    if (env === null) errors.env = 'invalid';
    if (Object.keys(errors).length > 0 || args === null || env === null) {
      return { ok: false, errors };
    }
    return {
      ok: true,
      input: {
        type: 'stdio',
        name,
        command,
        ...(args.length > 0 ? { args } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      },
    };
  }

  const url = values.url.trim();
  if (url === '') errors.url = 'required';
  else if (!isHttpUrl(url)) errors.url = 'invalid';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { type: values.type, name, url } };
}
