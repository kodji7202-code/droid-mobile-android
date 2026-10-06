import path from 'node:path';

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

export interface BridgeConfig {
  host: string;
  port: number;
  dataDir: string;
  dryRun: boolean;
  /** Present whenever `dryRun` is false; the file itself is read by the sender, never logged. */
  serviceAccountPath: string | undefined;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  bodyLimitBytes: number;
  trustProxy: boolean;
  logLevel: string;
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

function parseBoolean(
  name: string,
  raw: string | undefined,
  fallback: boolean,
  problems: string[],
) {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  problems.push(`${name} must be one of 1, true, yes, on, 0, false, no, off`);
  return fallback;
}

function parseInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  range: { min: number; max: number },
  problems: string[],
) {
  if (raw === undefined || raw.trim() === '') return fallback;
  const text = raw.trim();
  const value = Number(text);
  if (!/^\d+$/.test(text) || value < range.min || value > range.max) {
    problems.push(`${name} must be an integer between ${range.min} and ${range.max}`);
    return fallback;
  }
  return value;
}

/** `--port <n>`, `--port=<n>` and `--dry-run` override the environment. */
export function parseArgs(argv: readonly string[]): { port?: string; dryRun?: boolean } {
  const result: { port?: string; dryRun?: boolean } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--port') result.port = argv[(i += 1)] ?? '';
    else if (arg.startsWith('--port=')) result.port = arg.slice('--port='.length);
  }
  return result;
}

export function loadConfig(
  env: NodeJS.ProcessEnv,
  argv: readonly string[] = [],
  cwd: string = process.cwd(),
): BridgeConfig {
  const problems: string[] = [];
  const args = parseArgs(argv);

  const port = parseInteger('PORT', args.port ?? env.PORT, 3102, { min: 1, max: 65535 }, problems);
  const dryRun = args.dryRun ?? parseBoolean('BRIDGE_DRY_RUN', env.BRIDGE_DRY_RUN, false, problems);

  const rawServicePath = env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const serviceAccountPath = rawServicePath ? path.resolve(cwd, rawServicePath) : undefined;
  if (!dryRun && !serviceAccountPath) {
    problems.push(
      'FIREBASE_SERVICE_ACCOUNT_PATH is required unless dry-run mode is on (BRIDGE_DRY_RUN=1)',
    );
  }

  const logLevel = (env.BRIDGE_LOG_LEVEL ?? 'info').trim().toLowerCase();
  if (!LOG_LEVELS.includes(logLevel)) {
    problems.push(`BRIDGE_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  }

  const config: BridgeConfig = {
    host: env.BRIDGE_HOST?.trim() || '127.0.0.1',
    port,
    dataDir: path.resolve(cwd, env.BRIDGE_DATA_DIR?.trim() || 'data'),
    dryRun,
    serviceAccountPath,
    rateLimitMax: parseInteger(
      'BRIDGE_RATE_LIMIT_MAX',
      env.BRIDGE_RATE_LIMIT_MAX,
      100,
      { min: 1, max: 1_000_000 },
      problems,
    ),
    rateLimitWindowMs: parseInteger(
      'BRIDGE_RATE_LIMIT_WINDOW_MS',
      env.BRIDGE_RATE_LIMIT_WINDOW_MS,
      60_000,
      { min: 100, max: 86_400_000 },
      problems,
    ),
    bodyLimitBytes: parseInteger(
      'BRIDGE_BODY_LIMIT_BYTES',
      env.BRIDGE_BODY_LIMIT_BYTES,
      65_536,
      { min: 256, max: 1_048_576 },
      problems,
    ),
    trustProxy: parseBoolean('BRIDGE_TRUST_PROXY', env.BRIDGE_TRUST_PROXY, false, problems),
    logLevel,
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
