import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Walk up from cwd to the repo root (import.meta.url is not a file: URL under jsdom). */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, 'tools', 'dev', 'build-android.ps1'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`repo root not found from ${process.cwd()}`);
    dir = parent;
  }
}

const repo = findRepoRoot();
const read = (...segments: string[]) => readFileSync(path.join(repo, ...segments), 'utf8');
const appGradle = read('apps', 'mobile', 'android', 'app', 'build.gradle');

describe('release signing configuration', () => {
  it('reads the signing config from the git-ignored secrets/ directory, not from the repo', () => {
    expect(appGradle).toContain('secrets/keystore.properties');
    expect(appGradle).toMatch(/signingConfig\s+signingConfigs\.release/);
    expect(appGradle).not.toMatch(/storePassword\s+['"]/);
    expect(appGradle).not.toMatch(/keyPassword\s+['"]/);
  });

  it('signs release with v2 and v3 and refuses to package it without a keystore', () => {
    expect(appGradle).toContain('enableV2Signing true');
    expect(appGradle).toContain('enableV3Signing true');
    expect(appGradle).toContain('Release signing config not found');
  });

  it('never falls back to the debug signing config for release', () => {
    expect(appGradle).not.toMatch(/signingConfigs\.debug/);
  });

  it('keeps signing material and Firebase config out of git', () => {
    const ignored = [
      'secrets/release.keystore',
      'secrets/keystore.properties',
      'apps/mobile/android/app/google-services.json',
      'upload.jks',
      'x.keystore',
      'x.p12',
      'upload.p12',
      'secrets/a.p12',
      'my-service-account.json',
      'custom-service-account.json',
      'app/service-account-prod.json',
    ];
    for (const file of ignored) {
      expect(() =>
        execFileSync('git', ['check-ignore', '-q', file], { cwd: repo, stdio: 'ignore' }),
      ).not.toThrow();
    }
    const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' })
      .split('\n')
      .filter((file) =>
        /(\.jks|\.keystore|\.p12|keystore\.properties|google-services\.json|service-account.*\.json)$|^secrets\//.test(
          file,
        ),
      );
    expect(tracked).toEqual([]);
  });
});

describe('release branding resources', () => {
  it('uses the launcher background colour as the system splash background', () => {
    const res = (...s: string[]) =>
      read('apps', 'mobile', 'android', 'app', 'src', 'main', 'res', ...s);
    const splash = /name="splash_background">(#[0-9A-Fa-f]{6})</.exec(res('values', 'colors.xml'));
    const launcher = /name="ic_launcher_background">(#[0-9A-Fa-f]{6})</.exec(
      res('values', 'ic_launcher_background.xml'),
    );
    expect(splash?.[1]).toBeDefined();
    expect(splash?.[1]?.toLowerCase()).toBe(launcher?.[1]?.toLowerCase());
    expect(res('values', 'styles.xml')).toContain(
      'windowSplashScreenBackground">@color/splash_background',
    );
  });

  it('declares adaptive icons with background, foreground and monochrome layers', () => {
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = read(
        'apps',
        'mobile',
        'android',
        'app',
        'src',
        'main',
        'res',
        'mipmap-anydpi-v26',
        name,
      );
      expect(xml).toContain('<adaptive-icon');
      expect(xml).toContain('<background');
      expect(xml).toContain('<foreground');
      expect(xml).toContain('<monochrome');
    }
  });
});
