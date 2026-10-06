import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.dirname(srcDir);

function sourceFiles() {
  return readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'testkit.ts')
    .map((f) => ({ name: f, text: readFileSync(path.join(srcDir, f), 'utf8') }));
}

const read = (name: string) => readFileSync(path.join(packageDir, name), 'utf8');

describe('firebase-admin imports', () => {
  it('only use the modular entry points', () => {
    const specifiers = new Set<string>();
    for (const { text } of sourceFiles()) {
      for (const match of text.matchAll(/from\s+'(firebase-admin[^']*)'/g)) {
        specifiers.add(match[1] as string);
      }
      expect(text).not.toMatch(/require\(\s*'firebase-admin/);
    }
    expect([...specifiers].sort()).toEqual(['firebase-admin/app', 'firebase-admin/messaging']);
  });
});

describe('README', () => {
  it('documents every environment variable read by the sources and the required sections', () => {
    const readme = read('README.md');
    const variables = new Set<string>();
    for (const { text } of sourceFiles()) {
      for (const match of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) {
        variables.add(match[1] as string);
      }
    }
    expect(variables.size).toBeGreaterThanOrEqual(8);
    const undocumented = [...variables].filter((v) => !readme.includes(`\`${v}\``));
    expect(undocumented).toEqual([]);
    for (const heading of [
      '## Environment',
      '## API',
      '## Deploy behind TLS',
      '## Docker',
      '## Pairing secret',
    ]) {
      expect(readme).toContain(heading);
    }
    expect(readme).toMatch(/plain HTTP/);
    expect(readme).toMatch(/untested/);
  });
});

describe('Dockerfile', () => {
  const dockerfile = read('Dockerfile');
  const instructions = dockerfile.split(/\r?\n/).filter((line) => /^\s*(COPY|ADD)\s/i.test(line));

  it('pins the base image, drops root and exposes the dev port', () => {
    const from = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1] as string);
    expect(from.length).toBeGreaterThan(0);
    for (const image of from.filter((i) => !i.startsWith('build'))) {
      expect(image).toMatch(/^node:\d+\.\d+\.\d+-/);
    }
    expect(dockerfile).toMatch(/^USER\s+node$/m);
    expect(dockerfile).toMatch(/^EXPOSE\s+3102$/m);
    expect(dockerfile).toMatch(/npm install --omit=dev/);
  });

  it('copies no credentials and the dockerignore excludes them', () => {
    for (const line of instructions) {
      expect(line).not.toMatch(/service-account|\.env|secrets|google-services/i);
    }
    expect(dockerfile).not.toMatch(/ADD\s/);
    const ignore = read('.dockerignore');
    for (const entry of ['node_modules', '.env', 'secrets', 'google-services.json']) {
      expect(ignore).toContain(entry);
    }
    expect(ignore).toMatch(/service-account/);
  });
});
