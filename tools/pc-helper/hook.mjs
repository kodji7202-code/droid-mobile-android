/* global process, Buffer, fetch, AbortSignal, setTimeout, URL */
// Droid hook (Notification, Stop): tells the FCM bridge that a turn finished or a tool needs
// permission. Reads the hook JSON from stdin and forwards only session_id, hook_event_name and
// notification_type. It never writes to stdout and always exits 0, so it cannot block Droid.
//
// Bridge URL and pairing secret come from DROIDMOBILE_BRIDGE_URL / DROIDMOBILE_BRIDGE_SECRET
// or from <state dir>/bridge.json ({"url": "...", "secret": "..."}). The secret never appears
// in the hook command line.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TOTAL_BUDGET_MS = 4000;
const MAX_STDIN_BYTES = 4 * 1024 * 1024;
const MAX_LOG_BYTES = 128 * 1024;
const SEND_EVENTS = new Set(['Notification', 'Stop']);

function stateDir(argv) {
  const index = argv.indexOf('--state-dir');
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  if (process.env.DROIDMOBILE_HELPER_HOME) return process.env.DROIDMOBILE_HELPER_HOME;
  const base = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local');
  return join(base, 'DroidMobileHelper');
}

function log(dir, message) {
  try {
    const file = join(dir, 'logs', 'hook.log');
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) return;
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'ascii');
  } catch {
    // Logging must never change the outcome.
  }
}

function loadBridge(dir) {
  const envUrl = process.env.DROIDMOBILE_BRIDGE_URL;
  const envSecret = process.env.DROIDMOBILE_BRIDGE_SECRET;
  if (envUrl && envSecret) return { url: envUrl, secret: envSecret };
  const file = join(dir, 'bridge.json');
  if (!existsSync(file)) return null;
  const config = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (
    typeof config.url !== 'string' ||
    typeof config.secret !== 'string' ||
    !config.url ||
    !config.secret
  )
    return null;
  return { url: config.url, secret: config.secret };
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_STDIN_BYTES) throw new Error('hook input too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/^\uFEFF/, '');
}

async function run() {
  const dir = stateDir(process.argv.slice(2));
  const input = JSON.parse(await readStdin());
  const eventName = input?.hook_event_name;
  if (
    !SEND_EVENTS.has(eventName) ||
    typeof input.session_id !== 'string' ||
    input.session_id === ''
  )
    return;

  const bridge = loadBridge(dir);
  if (!bridge) {
    log(dir, 'skipped: no bridge configured (see tools/pc-helper/README.md)');
    return;
  }
  const body = { session_id: input.session_id, hook_event_name: eventName };
  if (eventName === 'Notification' && typeof input.notification_type === 'string') {
    body.notification_type = input.notification_type;
  }
  const endpoint = new URL('/v1/events', bridge.url);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bridge.secret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TOTAL_BUDGET_MS - 500),
  });
  if (!response.ok) log(dir, `bridge answered HTTP ${response.status} for ${eventName}`);
  await response.body?.cancel();
}

setTimeout(() => process.exit(0), TOTAL_BUDGET_MS);
try {
  await run();
} catch (error) {
  log(stateDir(process.argv.slice(2)), `failed: ${error?.name ?? 'Error'}`);
}
process.exit(0);
