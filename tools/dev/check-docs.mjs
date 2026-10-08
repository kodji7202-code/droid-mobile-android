/* global console, process */
// Documentation gate: required sections exist, relative links and anchors resolve, and every
// `npm run <script>` mentioned in the docs exists in the package.json it targets.
// Usage: node tools/dev/check-docs.mjs [--json]   (exit 1 when anything is missing)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DOC_FILES = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  'server/fcm-bridge/README.md',
  'tools/pc-helper/README.md',
];
export const DOCS_DIR = 'docs';

/** Topic -> pattern that at least one heading in the documentation set must match. */
export const REQUIRED_HEADINGS = [
  ['PC setup', /\bPC setup\b/i],
  ['Tailscale Serve', /Tailscale Serve/i],
  ['HTTPS certificates', /HTTPS certificates/i],
  ['Connecting the phone', /Connecting the phone/i],
  ['Pairing code', /Pairing code/i],
  ['Security notes', /Security notes/i],
  ['Key rotation', /rotat/i],
  ['Unofficial client and ToS note', /Unofficial client/i],
  ['Release and signing', /Release and signing/i],
  ['Keystore creation', /keystore/i],
  ['apksigner verify', /apksigner verify/i],
  ['FCM bridge deployment', /FCM bridge deployment/i],
  ['Troubleshooting', /^Troubleshooting$/i],
  ['Troubleshooting: connection refused', /connection refused/i],
  ['Troubleshooting: TLS or certificate error', /TLS.*(cert|error)|cert.*error/i],
  ['Troubleshooting: ws:// blocked in release', /ws:\/\/ blocked in release/i],
  ['Troubleshooting: push not arriving', /push not arriving/i],
  ['Troubleshooting: battery restrictions', /battery restrictions/i],
  ['Play Store listing notes', /Play Store/i],
  ['Known limitations', /Known limitations/i],
];

/** Remove fenced code blocks, keeping line count so reported positions stay meaningful. */
function stripFences(text) {
  const out = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (fence === null) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      out.push('');
      continue;
    }
    out.push(fence === null ? line : '');
  }
  return out;
}

export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

export function extractHeadings(text) {
  const headings = [];
  for (const line of stripFences(text)) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) headings.push(m[2].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
  }
  return headings;
}

export function anchorsOf(text) {
  const seen = new Map();
  const anchors = new Set();
  for (const heading of extractHeadings(text)) {
    const base = slugify(heading);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

export function extractLinks(text) {
  const links = [];
  stripFences(text).forEach((line, index) => {
    const noInline = line.replace(/`[^`]*`/g, '');
    for (const m of noInline.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      links.push({ target: m[1], line: index + 1 });
    }
  });
  return links;
}

export function extractNpmRuns(text) {
  const runs = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const m of line.matchAll(
      /\bnpm run ([A-Za-z0-9:_-]+)((?:\s+(?:-w|--workspace)(?:=|\s+)[@\w/.-]+)?)/g,
    )) {
      const ws = /(?:-w|--workspace)(?:=|\s+)([@\w/.-]+)/.exec(m[2]);
      runs.push({ script: m[1], workspace: ws ? ws[1] : null, line: index + 1 });
    }
  });
  return runs;
}

// Windows tools sometimes write a UTF-8 BOM, which JSON.parse rejects.
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function workspaceManifests(root) {
  const byName = new Map();
  const rootPkg = readJson(join(root, 'package.json'));
  for (const pattern of rootPkg.workspaces ?? []) {
    const parent = join(root, pattern.replace(/\/\*$/, ''));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const file = join(parent, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(file)) {
        const pkg = readJson(file);
        byName.set(pkg.name, pkg);
      }
    }
  }
  return { rootPkg, byName };
}

export function listDocFiles(root = repoRoot) {
  const files = DOC_FILES.filter((f) => existsSync(join(root, f)));
  const dir = join(root, DOCS_DIR);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (name.endsWith('.md')) files.push(`${DOCS_DIR}/${name}`);
    }
  }
  return files;
}

export function checkDocs(root = repoRoot) {
  const files = listDocFiles(root);
  const texts = new Map(files.map((f) => [f, readFileSync(join(root, f), 'utf8')]));
  const { rootPkg, byName } = workspaceManifests(root);

  const brokenLinks = [];
  const missingScripts = [];
  const headings = [];

  for (const [file, text] of texts) {
    headings.push(...extractHeadings(text));

    for (const { target, line } of extractLinks(text)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const [pathPart, anchor] = target.split('#');
      const targetFile =
        pathPart === '' ? file : relative(root, resolve(root, dirname(file), decodeURI(pathPart)));
      const abs = join(root, targetFile);
      if (!existsSync(abs)) {
        brokenLinks.push(`${file}:${line} -> ${target} (no such file)`);
        continue;
      }
      if (anchor && targetFile.endsWith('.md')) {
        const known = texts.get(targetFile.split(sep).join('/')) ?? readFileSync(abs, 'utf8');
        if (!anchorsOf(known).has(anchor.toLowerCase())) {
          brokenLinks.push(`${file}:${line} -> ${target} (no such heading)`);
        }
      }
    }

    for (const { script, workspace, line } of extractNpmRuns(text)) {
      const pkg = workspace ? byName.get(workspace) : rootPkg;
      if (!pkg)
        missingScripts.push(`${file}:${line} npm run ${script} (unknown workspace ${workspace})`);
      else if (!pkg.scripts?.[script]) {
        missingScripts.push(
          `${file}:${line} npm run ${script}${workspace ? ` -w ${workspace}` : ''} (not in package.json)`,
        );
      }
    }
  }

  const headingChecklist = REQUIRED_HEADINGS.map(([topic, pattern]) => ({
    topic,
    found: headings.find((h) => pattern.test(h)) ?? null,
  }));
  const missingHeadings = headingChecklist.filter((h) => h.found === null).map((h) => h.topic);

  return { files, headingChecklist, missingHeadings, brokenLinks, missingScripts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkDocs();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`documents checked: ${result.files.length}`);
    for (const f of result.files) console.log(`  ${f}`);
    console.log('heading checklist:');
    for (const h of result.headingChecklist) {
      console.log(`  [${h.found ? 'ok' : 'MISSING'}] ${h.topic}${h.found ? ` -> ${h.found}` : ''}`);
    }
    console.log(`broken links: ${result.brokenLinks.length}`);
    for (const b of result.brokenLinks) console.log(`  ${b}`);
    console.log(`missing npm scripts: ${result.missingScripts.length}`);
    for (const m of result.missingScripts) console.log(`  ${m}`);
  }
  const bad =
    result.missingHeadings.length + result.brokenLinks.length + result.missingScripts.length;
  process.exit(bad === 0 ? 0 : 1);
}
