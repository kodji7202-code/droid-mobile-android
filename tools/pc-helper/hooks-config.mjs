/* global process, console */
// Adds and removes the Droid Mobile hook entries in a Factory settings file or hooks.json.
// JSON is edited in Node, not PowerShell 5.1: ConvertFrom-Json/ConvertTo-Json flatten
// single-element arrays and empty objects, which would silently rewrite the user's hooks.
//
//   node hooks-config.mjs install   --settings <path> --command <hook command> [--dry-run]
//   node hooks-config.mjs uninstall --settings <path> [--dry-run]
//   node hooks-config.mjs status    --settings <path>
//
// Prints one JSON object on stdout. On failure prints a message on stderr and exits 1.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A hook command carrying this argument belongs to the helper. */
export const OWNER_MARKER = '--droidmobile-hook';
export const HOOK_EVENTS = ['Notification', 'Stop'];
const CREATED_EVENT_MARKER = '--droidmobile-created-event';
const CREATED_HOOKS_MARKER = '--droidmobile-created-hooks';

const KNOWN_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionStart',
  'SessionEnd',
];

export class HooksConfigError extends Error {}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOwnedHook(hook) {
  return (
    isPlainObject(hook) && typeof hook.command === 'string' && hook.command.includes(OWNER_MARKER)
  );
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readDocument(file) {
  const raw = readFileSync(file, 'utf8');
  const bom = raw.startsWith('\uFEFF');
  const text = bom ? raw.slice(1) : raw;
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new HooksConfigError(
      `${file} is not valid JSON (${error.message}). It was not modified; fix or remove it first.`,
    );
  }
  if (!isPlainObject(doc)) {
    throw new HooksConfigError(
      `${file} must contain a JSON object at the top level. It was not modified.`,
    );
  }
  const indentMatch = /^([ \t]+)"/m.exec(text);
  return {
    doc,
    bom,
    indent: indentMatch ? (indentMatch[1].startsWith('\t') ? '\t' : indentMatch[1].length) : 2,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    trailingNewline: /\n$/.test(text),
  };
}

function serialize(parsed) {
  let text = JSON.stringify(parsed.doc, null, parsed.indent);
  if (parsed.eol === '\r\n') text = text.replace(/\n/g, '\r\n');
  if (parsed.trailingNewline) text += parsed.eol;
  return (parsed.bom ? '\uFEFF' : '') + text;
}

function writeAtomically(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

function createBackup(file) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  for (let attempt = 0; attempt < 100; attempt++) {
    const backup = `${file}.droidmobile-backup-${stamp}${attempt === 0 ? '' : `-${attempt}`}`;
    try {
      copyFileSync(file, backup, constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    if (sha256(backup) !== sha256(file)) {
      throw new HooksConfigError(`Backup ${backup} does not match ${file}; nothing was changed.`);
    }
    return backup;
  }
  throw new HooksConfigError(`Could not find a free backup name next to ${file}.`);
}

/** hooks.json beside the settings file wins over the settings file's `hooks` key. */
export function resolveTargets(settingsPath) {
  const dir = dirname(settingsPath);
  const hooksJson = join(dir, 'hooks.json');
  const settingsIsHooksJson = basename(settingsPath).toLowerCase() === 'hooks.json';
  return {
    install:
      settingsIsHooksJson || existsSync(hooksJson)
        ? { kind: 'hooks.json', file: settingsIsHooksJson ? settingsPath : hooksJson }
        : { kind: 'settings', file: settingsPath },
    candidates: [
      ...(existsSync(hooksJson) || settingsIsHooksJson
        ? [{ kind: 'hooks.json', file: settingsIsHooksJson ? settingsPath : hooksJson }]
        : []),
      ...(settingsIsHooksJson ? [] : [{ kind: 'settings', file: settingsPath }]),
    ],
  };
}

/** The object keyed by event name: root of hooks.json (or its `hooks` wrapper), `hooks` in settings. */
function eventMap(doc, kind, create) {
  if (kind === 'hooks.json') {
    const wrapped = isPlainObject(doc.hooks) && !KNOWN_EVENTS.some((name) => name in doc);
    if (!wrapped) return doc;
  }
  if (doc.hooks === undefined) {
    if (!create) return undefined;
    doc.hooks = {};
  }
  if (!isPlainObject(doc.hooks))
    throw new HooksConfigError('The "hooks" key is not an object; refusing to change it.');
  return doc.hooks;
}

function stripMarkers(command) {
  return command.replace(` ${CREATED_EVENT_MARKER}`, '').replace(` ${CREATED_HOOKS_MARKER}`, '');
}

function removeOwned(groups) {
  let removed = 0;
  const created = { event: false, hooks: false };
  const kept = [];
  for (const group of groups) {
    if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
      kept.push(group);
      continue;
    }
    const remaining = group.hooks.filter((hook) => !isOwnedHook(hook));
    for (const hook of group.hooks) {
      if (!isOwnedHook(hook)) continue;
      if (hook.command.includes(CREATED_EVENT_MARKER)) created.event = true;
      if (hook.command.includes(CREATED_HOOKS_MARKER)) created.hooks = true;
    }
    removed += group.hooks.length - remaining.length;
    if (remaining.length === group.hooks.length) kept.push(group);
    else if (remaining.length > 0) kept.push({ ...group, hooks: remaining });
  }
  return { kept, removed, created };
}

function ownedCount(map, event) {
  const groups = map?.[event];
  if (!Array.isArray(groups)) return { count: 0, commands: [] };
  const commands = groups.flatMap((group) =>
    isPlainObject(group) && Array.isArray(group.hooks)
      ? group.hooks.filter(isOwnedHook).map((hook) => hook.command)
      : [],
  );
  return { count: commands.length, commands };
}

/**
 * Uninstall must give back what install found, including an empty `hooks` object or an empty
 * event array that already existed. Install and uninstall are separate processes, so what
 * install created is recorded on the command it writes: CREATED_EVENT_MARKER when it created
 * that event's array, CREATED_HOOKS_MARKER when it created the `hooks` key. Uninstall deletes
 * only containers that carry the matching marker.
 */
export function applyInstall(doc, kind, command) {
  const hadHooksKey = 'hooks' in doc;
  const map = eventMap(doc, kind, true);
  const createdHooksKey = !hadHooksKey && map === doc.hooks;
  const previous = HOOK_EVENTS.flatMap((event) => ownedCount(map, event).commands);
  const createdHooks = createdHooksKey || previous.some((c) => c.includes(CREATED_HOOKS_MARKER));
  let changed = false;
  for (const event of HOOK_EVENTS) {
    if (map[event] !== undefined && !Array.isArray(map[event])) {
      throw new HooksConfigError(`hooks.${event} is not an array; refusing to change it.`);
    }
    const { count, commands } = ownedCount(map, event);
    if (count === 1 && stripMarkers(commands[0]) === command) continue;
    const createdEvent =
      map[event] === undefined || commands.some((c) => c.includes(CREATED_EVENT_MARKER));
    const { kept } = removeOwned(map[event] ?? []);
    const marked =
      command +
      (createdEvent ? ` ${CREATED_EVENT_MARKER}` : '') +
      (createdHooks ? ` ${CREATED_HOOKS_MARKER}` : '');
    kept.push({ hooks: [{ type: 'command', command: marked, timeout: 10 }] });
    map[event] = kept;
    changed = true;
  }
  return changed;
}

export function applyUninstall(doc, kind) {
  const map = eventMap(doc, kind, false);
  if (!map) return 0;
  let removed = 0;
  let createdHooks = false;
  for (const event of Object.keys(map)) {
    if (!Array.isArray(map[event])) continue;
    const result = removeOwned(map[event]);
    if (result.removed === 0) continue;
    removed += result.removed;
    if (result.created.hooks) createdHooks = true;
    if (result.kept.length === 0 && result.created.event) delete map[event];
    else map[event] = result.kept;
  }
  if (removed > 0 && map === doc.hooks && Object.keys(map).length === 0 && createdHooks) {
    delete doc.hooks;
  }
  return removed;
}

export function install({ settingsPath, command, dryRun = false }) {
  const target = resolveTargets(settingsPath).install;
  const existed = existsSync(target.file);
  const parsed = existed
    ? readDocument(target.file)
    : { doc: {}, bom: false, indent: 2, eol: '\n', trailingNewline: true };
  const changed = applyInstall(parsed.doc, target.kind, command);
  const result = {
    action: 'install',
    kind: target.kind,
    file: target.file,
    changed,
    created: changed && !existed,
    backup: null,
    dryRun,
  };
  if (!changed || dryRun) return result;
  if (existed) result.backup = createBackup(target.file);
  else mkdirSync(dirname(target.file), { recursive: true });
  writeAtomically(target.file, serialize(parsed));
  return result;
}

export function uninstall({ settingsPath, dryRun = false }) {
  const results = [];
  for (const target of resolveTargets(settingsPath).candidates) {
    if (!existsSync(target.file)) continue;
    const parsed = readDocument(target.file);
    const removed = applyUninstall(parsed.doc, target.kind);
    const entry = { kind: target.kind, file: target.file, removed, backup: null };
    if (removed > 0 && !dryRun) {
      entry.backup = createBackup(target.file);
      writeAtomically(target.file, serialize(parsed));
    }
    results.push(entry);
  }
  return {
    action: 'uninstall',
    dryRun,
    removed: results.reduce((sum, entry) => sum + entry.removed, 0),
    results,
  };
}

export function status({ settingsPath }) {
  const target = resolveTargets(settingsPath).install;
  const events = Object.fromEntries(HOOK_EVENTS.map((event) => [event, 0]));
  if (existsSync(target.file)) {
    const { doc } = readDocument(target.file);
    const map = eventMap(doc, target.kind, false);
    for (const event of HOOK_EVENTS) events[event] = ownedCount(map, event).count;
  }
  return { action: 'status', kind: target.kind, file: target.file, events };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--settings' || arg === '--command') args[arg.slice(2)] = argv[++i];
    else args._.push(arg);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [verb] = args._;
  if (!args.settings) throw new HooksConfigError('--settings <path> is required.');
  let result;
  if (verb === 'install') {
    if (!args.command || !args.command.includes(OWNER_MARKER)) {
      throw new HooksConfigError(`--command is required and must contain ${OWNER_MARKER}.`);
    }
    result = install({ settingsPath: args.settings, command: args.command, dryRun: args.dryRun });
  } else if (verb === 'uninstall') {
    result = uninstall({ settingsPath: args.settings, dryRun: args.dryRun });
  } else if (verb === 'status') {
    result = status({ settingsPath: args.settings });
  } else {
    throw new HooksConfigError(
      'Usage: hooks-config.mjs install|uninstall|status --settings <path>',
    );
  }
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof HooksConfigError ? error.message : `Unexpected error: ${error.message}`,
    );
    process.exit(1);
  }
}
