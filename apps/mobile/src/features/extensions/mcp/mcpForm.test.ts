import { describe, expect, it } from 'vitest';
import { parseArgs, parseEnv, validateMcpForm } from './mcpForm';
import type { McpFormValues } from './mcpForm';

const HTTP: McpFormValues = {
  type: 'http',
  name: 'val-http-dummy',
  url: 'http://127.0.0.1:3199/mcp',
  command: '',
  args: '',
  env: '',
};

const STDIO: McpFormValues = {
  type: 'stdio',
  name: 'val-stdio-dummy',
  url: '',
  command: 'node',
  args: '-e "setTimeout(()=>{},500)"',
  env: 'DUMMY_VAR=1',
};

describe('parseArgs', () => {
  it('splits on whitespace and keeps quoted groups together', () => {
    expect(parseArgs('-e "setTimeout(()=>{},500)"')).toEqual(['-e', 'setTimeout(()=>{},500)']);
    expect(parseArgs("a 'b c'  d")).toEqual(['a', 'b c', 'd']);
  });

  it('returns no args for blank input and null for an unclosed quote', () => {
    expect(parseArgs('   ')).toEqual([]);
    expect(parseArgs('-e "oops')).toBeNull();
  });
});

describe('parseEnv', () => {
  it('reads KEY=VALUE lines and keeps = inside the value', () => {
    expect(parseEnv('A=1\n\nB=x=y')).toEqual({ A: '1', B: 'x=y' });
  });

  it('returns null for a line without a valid key', () => {
    expect(parseEnv('novalue')).toBeNull();
    expect(parseEnv('1BAD=2')).toBeNull();
  });
});

describe('validateMcpForm', () => {
  it('accepts a valid http and a valid stdio server and builds the request', () => {
    expect(validateMcpForm(HTTP, [])).toEqual({
      ok: true,
      input: { type: 'http', name: 'val-http-dummy', url: 'http://127.0.0.1:3199/mcp' },
    });
    expect(validateMcpForm(STDIO, [])).toEqual({
      ok: true,
      input: {
        type: 'stdio',
        name: 'val-stdio-dummy',
        command: 'node',
        args: ['-e', 'setTimeout(()=>{},500)'],
        env: { DUMMY_VAR: '1' },
      },
    });
  });

  it('rejects an empty name', () => {
    expect(validateMcpForm({ ...HTTP, name: '   ' }, [])).toEqual({
      ok: false,
      errors: { name: 'required' },
    });
  });

  it('rejects an http server whose URL is not an http(s) URL', () => {
    expect(validateMcpForm({ ...HTTP, url: 'not a url' }, [])).toEqual({
      ok: false,
      errors: { url: 'invalid' },
    });
    expect(validateMcpForm({ ...HTTP, url: 'ftp://host/x' }, [])).toEqual({
      ok: false,
      errors: { url: 'invalid' },
    });
    expect(validateMcpForm({ ...HTTP, url: '' }, [])).toEqual({
      ok: false,
      errors: { url: 'required' },
    });
  });

  it('rejects a stdio server with an empty command', () => {
    expect(validateMcpForm({ ...STDIO, command: '  ' }, [])).toEqual({
      ok: false,
      errors: { command: 'required' },
    });
  });

  it('rejects a name that an existing server already uses', () => {
    expect(validateMcpForm(HTTP, ['other', 'val-http-dummy'])).toEqual({
      ok: false,
      errors: { name: 'duplicate' },
    });
  });

  it('reports malformed args and env on stdio servers', () => {
    expect(validateMcpForm({ ...STDIO, args: '"x', env: 'bad' }, [])).toEqual({
      ok: false,
      errors: { args: 'invalid', env: 'invalid' },
    });
  });

  it('ignores stdio-only fields for http servers', () => {
    expect(validateMcpForm({ ...HTTP, command: '', args: '"x', env: 'bad' }, []).ok).toBe(true);
  });
});
