import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SDK_PACKAGE_VERSION } from './version';

/** Walk up from cwd to packages/daemon-client (cwd differs per invocation). */
function findPackageJson(): string {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of [dir, join(dir, 'packages', 'daemon-client')]) {
      const file = join(candidate, 'package.json');
      if (existsSync(file)) return file;
    }
    const parent = join(dir, '..');
    if (parent === dir) throw new Error(`packages/daemon-client/package.json not found from ${process.cwd()}`);
    dir = parent;
  }
}

describe('SDK_PACKAGE_VERSION', () => {
  it('matches the exact @factory/droid-sdk pin in packages/daemon-client/package.json', () => {
    const raw = readFileSync(findPackageJson(), 'utf8');
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.['@factory/droid-sdk']).toBe(SDK_PACKAGE_VERSION);
    expect(SDK_PACKAGE_VERSION).toBe('0.9.1');
  });
});
