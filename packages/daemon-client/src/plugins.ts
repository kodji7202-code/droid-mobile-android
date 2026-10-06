/**
 * Plugin marketplaces and plugins over the SDK facade (`droid.marketplaces`,
 * `droid.plugins`). The daemon needs an open session id for the plugin calls,
 * so the client owns a home-folder scratch session. Refusals come back as
 * `{ success: false, error }` or as per-item results; both are turned into a
 * DaemonClientError carrying the daemon's own text so the UI can show it.
 */
import type { ConnectedDroid } from '@factory/droid-sdk';
import { DaemonClientError } from './errors';
import { createHomeScratchSession } from './scratch-session';
import type { ScratchSessionDeps } from './scratch-session';

type MarketplaceInfo = Awaited<ReturnType<ConnectedDroid['marketplaces']['list']>>[number];

export interface Marketplace {
  name: string;
  displayName?: string;
  /** Reported origin kind: github, url, git-subdir or local. */
  sourceKind: string;
  /** `owner/repo` for github, the git URL for url and git-subdir; absent for local. */
  sourceLocation?: string;
  pluginCount?: number;
  autoUpdate?: boolean;
  /** False for marketplaces provisioned by an organisation or project. */
  removable?: boolean;
}

export interface AvailablePlugin {
  /** `<name>@<marketplace>`, the id the daemon uses for installed plugins. */
  id: string;
  name: string;
  marketplace: string;
  description?: string;
}

export interface InstalledPlugin {
  id: string;
  /** Install scope as reported (user, project, local ...). */
  scope: string;
  version: string;
  /** Name of the marketplace the plugin came from. */
  source: string;
  active?: boolean;
  managed?: boolean;
  /** Daemon wording for the active state: `enabled` or `not enabled`. */
  reason?: string;
}

export interface InstallPluginInput {
  marketplace: string;
  name: string;
  scope?: string;
}

export interface PluginsClient {
  listMarketplaces(): Promise<Marketplace[]>;
  /** Adds a GitHub marketplace (`owner/repo`) and resolves with the name the daemon gave it. */
  addMarketplace(repo: string): Promise<string>;
  removeMarketplace(name: string): Promise<void>;
  updateMarketplace(name: string): Promise<void>;
  /** Plugins the added marketplaces offer, as reported (no installed mark). */
  listAvailable(): Promise<AvailablePlugin[]>;
  listInstalled(): Promise<InstalledPlugin[]>;
  /** Installs at user scope unless told otherwise; resolves with the plugin id. */
  install(input: InstallPluginInput): Promise<string>;
  uninstall(pluginId: string, scope: string): Promise<void>;
  setEnabled(pluginId: string, scope: string, enabled: boolean): Promise<void>;
  updatePlugin(pluginId: string, scope: string): Promise<void>;
  /** Closes the scratch session; the next call opens a new one. */
  release(): Promise<void>;
}

export type PluginsClientDeps = ScratchSessionDeps;

export const pluginId = (name: string, marketplace: string): string => `${name}@${marketplace}`;

export function toMarketplace(info: Readonly<MarketplaceInfo>): Marketplace {
  const source = info.source;
  const location =
    source.source === 'github'
      ? source.repo
      : source.source === 'url' || source.source === 'git-subdir'
        ? source.url
        : undefined;
  return {
    name: info.name,
    ...(info.displayName !== undefined ? { displayName: info.displayName } : {}),
    sourceKind: source.source,
    ...(location !== undefined ? { sourceLocation: location } : {}),
    ...(info.pluginCount !== undefined ? { pluginCount: info.pluginCount } : {}),
    ...(info.autoUpdate !== undefined ? { autoUpdate: info.autoUpdate } : {}),
    ...(info.removable !== undefined ? { removable: info.removable } : {}),
  };
}

function fail(text: string | undefined, fallback: string): never {
  throw new DaemonClientError('unknown', text?.trim() ? text : fallback);
}

function expectSuccess(result: { success: boolean; error?: string }, fallback: string): void {
  if (!result.success) fail(result.error, fallback);
}

// The SDK typings of per-item update results omit `error`, but the daemon sends it
// (verified against 0.232.0) and the parser keeps it.
function expectResults(
  results: readonly { success: boolean; error?: string }[],
  fallback: string,
): void {
  const failed = results.find((result) => !result.success);
  if (failed) fail(failed.error, fallback);
}

export function createPluginsClient(deps: PluginsClientDeps): PluginsClient {
  const scratch = createHomeScratchSession(deps);

  async function withSession<T>(op: (id: string, droid: ConnectedDroid) => Promise<T>) {
    const id = await scratch.id();
    return deps.run(() => op(id, deps.droid()));
  }

  return {
    listMarketplaces: () =>
      withSession(async (id, droid) => (await droid.marketplaces.list(id)).map(toMarketplace)),
    addMarketplace: (repo) =>
      withSession(async (id, droid) => {
        const result = await droid.marketplaces.add(id, { source: 'github', repo });
        expectSuccess(result, 'The daemon did not add the marketplace.');
        return result.name ?? repo;
      }),
    removeMarketplace: (name) =>
      withSession(async (id, droid) =>
        expectSuccess(
          await droid.marketplaces.remove(id, name),
          'The daemon did not remove the marketplace.',
        ),
      ),
    updateMarketplace: (name) =>
      withSession(async (id, droid) =>
        expectResults(
          (await droid.marketplaces.update(id, name)).results,
          'The daemon did not update the marketplace.',
        ),
      ),
    listAvailable: () =>
      withSession(async (id, droid) =>
        (await droid.plugins.listAvailable(id)).map((plugin) => ({
          id: pluginId(plugin.name, plugin.marketplace),
          name: plugin.name,
          marketplace: plugin.marketplace,
          ...(plugin.description !== undefined ? { description: plugin.description } : {}),
        })),
      ),
    listInstalled: () =>
      withSession(async (id, droid) =>
        (await droid.plugins.listInstalled(id)).map((plugin) => ({
          id: plugin.id,
          scope: plugin.scope,
          version: plugin.version,
          source: plugin.source,
          ...(plugin.active !== undefined ? { active: plugin.active } : {}),
          ...(plugin.managed !== undefined ? { managed: plugin.managed } : {}),
          ...(plugin.reason !== undefined ? { reason: plugin.reason } : {}),
        })),
      ),
    install: ({ marketplace, name, scope = 'user' }) =>
      withSession(async (id, droid) => {
        const result = await droid.plugins.install(id, marketplace, name, scope);
        expectSuccess(result, 'The daemon did not install the plugin.');
        return result.pluginId ?? pluginId(name, marketplace);
      }),
    uninstall: (installedId, scope) =>
      withSession(async (id, droid) =>
        expectSuccess(
          await droid.plugins.uninstall(id, installedId, scope),
          'The daemon did not uninstall the plugin.',
        ),
      ),
    setEnabled: (installedId, scope, enabled) =>
      withSession(async (id, droid) =>
        expectSuccess(
          await droid.plugins.setEnabled(id, installedId, scope, enabled),
          'The daemon did not change the plugin.',
        ),
      ),
    updatePlugin: (installedId, scope) =>
      withSession(async (id, droid) =>
        expectResults(
          (await droid.plugins.update(id, installedId, scope)).results,
          'The daemon did not update the plugin.',
        ),
      ),
    release: () => scratch.release(),
  };
}
