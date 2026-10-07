import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { anchorsOf, checkDocs, extractLinks, extractNpmRuns, slugify } from '../check-docs.mjs';

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop() as string, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-'));
  scratch.push(root);
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const pkg = JSON.stringify({ name: 'root', workspaces: ['server/*'], scripts: { build: 'x' } });
const bridgePkg = JSON.stringify({ name: '@x/bridge', scripts: { dev: 'x' } });

describe('check-docs', () => {
  it('slugifies headings the way GitHub does', () => {
    expect(slugify('ws:// blocked in release')).toBe('ws-blocked-in-release');
    expect(slugify('Deploy `behind` TLS')).toBe('deploy-behind-tls');
  });

  it('numbers duplicate headings', () => {
    expect([...anchorsOf('# A\n## A\n')]).toEqual(['a', 'a-1']);
  });

  it('ignores links inside code fences and inline code', () => {
    const links = extractLinks(
      '[a](one.md)\n```\n[b](two.md)\n```\n`[c](three.md)` [d](four.md#x)',
    );
    expect(links.map((l: { target: string }) => l.target)).toEqual(['one.md', 'four.md#x']);
  });

  it('reads npm run scripts with and without a workspace', () => {
    const runs = extractNpmRuns('npm run build\nnpm run dev -w @x/bridge -- --port 1');
    expect(runs).toEqual([
      { script: 'build', workspace: null, line: 1 },
      { script: 'dev', workspace: '@x/bridge', line: 2 },
    ]);
  });

  it('reports broken files, broken anchors and unknown scripts', () => {
    const root = fixture({
      'package.json': pkg,
      'server/bridge/package.json': bridgePkg,
      'README.md':
        '# Top\n[ok](docs/a.md#intro) [bad](docs/missing.md) [badanchor](docs/a.md#nope)\n\n`npm run nothing`\nnpm run dev -w @x/bridge\nnpm run build\n',
      'docs/a.md': '# Intro\n',
    });
    const result = checkDocs(root);
    expect(result.brokenLinks).toHaveLength(2);
    expect(result.brokenLinks[0]).toContain('docs/missing.md');
    expect(result.brokenLinks[1]).toContain('#nope');
    expect(result.missingScripts).toHaveLength(1);
    expect(result.missingScripts[0]).toContain('npm run nothing');
    expect(result.missingHeadings.length).toBeGreaterThan(0);
  });

  it('passes for the repository documentation set', () => {
    const result = checkDocs();
    expect(result.missingHeadings).toEqual([]);
    expect(result.brokenLinks).toEqual([]);
    expect(result.missingScripts).toEqual([]);
  });
});
