import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildConfig } from '../../capacitor.config';

/**
 * Transport policy (architecture.md section 2) as an executable check:
 * - debug variant: http scheme, cleartext allowed (debug source set only), WebView debugging on
 * - release variant: default https origin, no cleartext, no debuggable WebView, allowBackup=false
 * - app id com.droidmobile.client and display name "Droid Mobile" in both variants
 *
 * Variant selection happens through the CAPACITOR_VARIANT env at `cap sync` time; this test
 * pins the config logic, the manifest source sets and the Gradle toolchain versions, and
 * parses the merged manifests + synced capacitor config whenever the artifacts exist
 * (run tools/dev/check-android-variants.ps1 to produce them).
 */

/** Walk up from cwd to the mobile workspace (import.meta.url is not a file: URL under jsdom). */
function findMobileRoot(): string {
  let dir = process.cwd();
  for (;;) {
    // Either cwd is the workspace itself, or we are elsewhere in the monorepo.
    for (const candidate of [dir, path.join(dir, 'apps', 'mobile')]) {
      if (existsSync(path.join(candidate, 'capacitor.config.ts'))) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`capacitor.config.ts not found from ${process.cwd()}`);
    dir = parent;
  }
}

const mobileRoot = findMobileRoot();
const android = (...segments: string[]) => path.join(mobileRoot, 'android', ...segments);
const read = (file: string) => readFileSync(file, 'utf8');

const MAIN_MANIFEST = android('app', 'src', 'main', 'AndroidManifest.xml');
const DEBUG_MANIFEST = android('app', 'src', 'debug', 'AndroidManifest.xml');
const RELEASE_MANIFEST = android('app', 'src', 'release', 'AndroidManifest.xml');
const SYNCED_CONFIG = android('app', 'src', 'main', 'assets', 'capacitor.config.json');

/** Merged manifests live under build/intermediates/merged_manifest/<variant>/ (task subdirs vary by AGP). */
function findMergedManifests(variant: 'debug' | 'release'): string[] {
  const base = android('app', 'build', 'intermediates', 'merged_manifest', variant);
  if (!existsSync(base)) return [];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'AndroidManifest.xml') found.push(full);
    }
  };
  walk(base);
  return found.sort();
}

describe('capacitor config variant selection', () => {
  it('debug variant uses the http scheme with WebView debugging on', () => {
    const config = buildConfig('debug');
    expect(config.appId).toBe('com.droidmobile.client');
    expect(config.appName).toBe('Droid Mobile');
    expect(config.server?.androidScheme).toBe('http');
    expect(config.android?.webContentsDebuggingEnabled).toBe(true);
    expect(config.server?.url).toBeUndefined();
    expect(config.server?.cleartext).toBeUndefined();
  });

  it('release variant keeps the default https origin and no debugging', () => {
    const config = buildConfig('release');
    expect(config.appId).toBe('com.droidmobile.client');
    expect(config.appName).toBe('Droid Mobile');
    expect(config.server?.androidScheme).toBe('https');
    expect(config.android?.webContentsDebuggingEnabled ?? false).toBe(false);
    expect(config.server?.url).toBeUndefined();
    expect(config.server?.cleartext).toBeUndefined();
  });

  it('never logs plugin payloads (secure-storage writes carry the API key)', () => {
    expect(buildConfig('debug').loggingBehavior).toBe('none');
    expect(buildConfig('release').loggingBehavior).toBe('none');
  });

  it('follows CAPACITOR_VARIANT, failing secure to release', async () => {
    vi.resetModules();
    process.env.CAPACITOR_VARIANT = 'debug';
    const debugConfig = (await import('../../capacitor.config')).default;
    expect(debugConfig.server?.androidScheme).toBe('http');

    vi.resetModules();
    process.env.CAPACITOR_VARIANT = 'release';
    const releaseConfig = (await import('../../capacitor.config')).default;
    expect(releaseConfig.server?.androidScheme).toBe('https');

    vi.resetModules();
    delete process.env.CAPACITOR_VARIANT;
    const unsetConfig = (await import('../../capacitor.config')).default;
    expect(unsetConfig.server?.androidScheme).toBe('https');
  });

  afterEach(() => {
    delete process.env.CAPACITOR_VARIANT;
  });
});

describe('android project source sets', () => {
  it('main manifest disables backup and never allows cleartext', () => {
    const manifest = read(MAIN_MANIFEST);
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).not.toContain('usesCleartextTraffic="true"');
  });

  it('debug overlay enables cleartext only for the debug variant', () => {
    const manifest = read(DEBUG_MANIFEST);
    expect(manifest).toContain('android:usesCleartextTraffic="true"');
  });

  it('has no release overlay adding cleartext', () => {
    if (!existsSync(RELEASE_MANIFEST)) return;
    expect(read(RELEASE_MANIFEST)).not.toContain('usesCleartextTraffic="true"');
  });

  it('pins the Gradle toolchain (minSdk 24, SDK 36, AGP 8.13, Gradle 8.14.3)', () => {
    const variables = read(android('variables.gradle'));
    expect(variables).toMatch(/minSdkVersion\s*=\s*24/);
    expect(variables).toMatch(/compileSdkVersion\s*=\s*36/);
    expect(variables).toMatch(/targetSdkVersion\s*=\s*36/);
    expect(read(android('build.gradle'))).toContain('com.android.tools.build:gradle:8.13.0');
    const wrapper = read(android('gradle', 'wrapper', 'gradle-wrapper.properties'));
    expect(wrapper).toMatch(/gradle-8\.14\.3/);
  });

  it('uses the app id com.droidmobile.client for both variants', () => {
    const appBuild = read(android('app', 'build.gradle'));
    expect(appBuild).toMatch(/applicationId\s+"com\.droidmobile\.client"/);
  });

  it('ships an adaptive launcher icon with background, foreground and monochrome layers', () => {
    for (const file of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const icon = read(android('app', 'src', 'main', 'res', 'mipmap-anydpi-v26', file));
      expect(icon).toContain('<adaptive-icon');
      expect(icon).toContain('<background');
      expect(icon).toContain('<foreground');
      expect(icon).toContain('<monochrome');
    }
  });
});

describe.skipIf(findMergedManifests('debug').length === 0)('merged debug manifest', () => {
  it('allows cleartext, stays debuggable and disables backup', () => {
    const manifests = findMergedManifests('debug');
    expect(manifests).toHaveLength(1);
    const manifest = read(manifests[0]);
    expect(manifest).toContain('android:usesCleartextTraffic="true"');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:debuggable="true"');
    expect(manifest).toContain('package="com.droidmobile.client"');
  });
});

describe.skipIf(findMergedManifests('release').length === 0)('merged release manifest', () => {
  it('has no cleartext, no debuggable flag and disables backup', () => {
    const manifests = findMergedManifests('release');
    expect(manifests).toHaveLength(1);
    const manifest = read(manifests[0]);
    expect(manifest).not.toContain('android:usesCleartextTraffic="true"');
    expect(manifest).not.toContain('android:debuggable="true"');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('package="com.droidmobile.client"');
  });
});

describe.skipIf(!existsSync(SYNCED_CONFIG))('synced capacitor config', () => {
  it('matches exactly one variant and keeps the app identity', () => {
    const config = JSON.parse(read(SYNCED_CONFIG));
    expect(config.appId).toBe('com.droidmobile.client');
    expect(config.appName).toBe('Droid Mobile');
    expect(config.server?.url).toBeUndefined();
    expect(config.server?.cleartext).toBeUndefined();
    const scheme = config.server?.androidScheme;
    if (scheme === 'http') {
      // Debug signature: cleartext-capable origin must come with debugging on.
      expect(config.android?.webContentsDebuggingEnabled).toBe(true);
    } else {
      expect(scheme).toBe('https');
      expect(config.android?.webContentsDebuggingEnabled ?? false).toBe(false);
    }
  });
});
