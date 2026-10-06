import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Walk up from cwd to the mobile workspace (import.meta.url is not a file: URL under jsdom). */
function findMobileRoot(): string {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of [dir, path.join(dir, 'apps', 'mobile')]) {
      if (existsSync(path.join(candidate, 'capacitor.config.ts'))) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`capacitor.config.ts not found from ${process.cwd()}`);
    dir = parent;
  }
}

const manifest = readFileSync(
  path.join(findMobileRoot(), 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  'utf8',
);

describe('DaemonService manifest declaration (Android 14 foreground service)', () => {
  const service = /<service\b[^>]*DaemonService[^>]*>/s.exec(manifest)?.[0] ?? '';

  it('declares a private service of type dataSync', () => {
    expect(service).toContain('android:exported="false"');
    expect(service).toContain('android:foregroundServiceType="dataSync"');
  });

  it('requests the matching permissions', () => {
    for (const permission of [
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_DATA_SYNC',
      'POST_NOTIFICATIONS',
    ]) {
      expect(manifest).toContain(
        `<uses-permission android:name="android.permission.${permission}" />`,
      );
    }
  });
});
