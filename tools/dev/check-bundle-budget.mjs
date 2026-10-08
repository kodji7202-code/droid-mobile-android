/* global console, process */
// Checks the production bundle against the initial-JS budget (VAL-REL-029).
//
// Usage (after `npm run build`): node tools/dev/check-bundle-budget.mjs
//
// The initial JS is the entry script plus every modulepreload link in dist/index.html, the
// bootstrap chunk that main.tsx imports dynamically once the durable prefs are restored, and
// whatever those chunks import statically. The SDK, xterm, the syntax highlighter and the
// diff viewer must be reachable only through dynamic imports.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 400_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'apps', 'mobile', 'dist');
const assets = join(dist, 'assets');

/** Markers that identify each heavy library inside a built chunk. */
const HEAVY = {
  sdk: /ConnectionClosedError/,
  xterm: /\bxterm\b|Terminal\.prototype|\.xterm-/,
  highlighter: /hljs|highlight\.js/,
  diffViewer: /git-diff-view/,
};

const gzipSize = (text) => gzipSync(text, { level: 9 }).length;

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const referenced = new Set(
  [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]),
);

const chunks = new Map(
  readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .map((name) => [name, readFileSync(join(assets, name), 'utf8')]),
);

const staticImports = (source) =>
  [
    ...source.matchAll(
      /(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+\.js)["']/g,
    ),
  ].map((match) => match[1]);

const dynamicImports = (source) =>
  [...source.matchAll(/\bimport\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g)].map((match) => match[1]);

// main.tsx imports bootstrap on every start, so it is initial JS despite being a dynamic import.
const bootstrap = [...referenced].flatMap((name) =>
  dynamicImports(chunks.get(name) ?? '').filter((target) => /^bootstrap-/.test(target)),
);
const initial = new Set();
const pending = [...referenced, ...bootstrap];
while (pending.length > 0) {
  const name = pending.pop();
  if (initial.has(name) || !chunks.has(name)) continue;
  initial.add(name);
  pending.push(...staticImports(chunks.get(name)));
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
let total = 0;
console.log('Initial JS (entry + bootstrap + modulepreload + static imports), gzip:');
for (const name of [...initial].sort()) {
  const size = gzipSize(chunks.get(name));
  total += size;
  console.log(`  ${name.padEnd(44)} ${kib(size).padStart(11)}`);
}
console.log(`  ${'TOTAL'.padEnd(44)} ${kib(total).padStart(11)} (budget ${kib(BUDGET_BYTES)})`);

console.log('\nLazy chunks, gzip:');
for (const name of [...chunks.keys()].filter((n) => !initial.has(n)).sort()) {
  console.log(`  ${name.padEnd(44)} ${kib(gzipSize(chunks.get(name))).padStart(11)}`);
}

const problems = [];
if (bootstrap.length === 0) problems.push('the entry does not import a bootstrap chunk');
if (total > BUDGET_BYTES) problems.push(`initial JS is ${total} bytes gzip, over ${BUDGET_BYTES}`);
for (const [library, marker] of Object.entries(HEAVY)) {
  const leaked = [...initial].filter((name) => marker.test(chunks.get(name)));
  const exists = [...chunks.entries()].some(
    ([name, text]) => !initial.has(name) && marker.test(text),
  );
  if (leaked.length > 0) problems.push(`${library} is in the initial JS: ${leaked.join(', ')}`);
  if (!exists)
    problems.push(`${library} has no lazy chunk (marker not found outside the initial JS)`);
}

if (problems.length > 0) {
  console.error(`\nBudget check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nBudget check passed: initial JS within budget, heavy libraries lazy.');
