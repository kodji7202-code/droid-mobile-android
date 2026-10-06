import type { AvailablePlugin, InstalledPlugin } from '@droidmobile/daemon-client';

export interface PluginEntry {
  /** `<name>@<marketplace>`. */
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  /** Set when the daemon lists the plugin as installed; the available list never carries this. */
  installed?: InstalledPlugin;
}

/**
 * The available plugins in daemon order with the installed mark derived from the
 * installed list, followed by installed plugins their marketplace no longer
 * offers so they can still be switched or removed.
 */
export function mergePlugins(
  available: readonly AvailablePlugin[],
  installed: readonly InstalledPlugin[],
): PluginEntry[] {
  const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));
  const entries: PluginEntry[] = available.map((plugin) => {
    const match = byId.get(plugin.id);
    return {
      id: plugin.id,
      name: plugin.name,
      marketplace: plugin.marketplace,
      ...(plugin.description !== undefined ? { description: plugin.description } : {}),
      ...(match ? { installed: match } : {}),
    };
  });
  const offered = new Set(available.map((plugin) => plugin.id));
  for (const plugin of installed) {
    if (offered.has(plugin.id)) continue;
    const at = plugin.id.lastIndexOf('@');
    entries.push({
      id: plugin.id,
      name: at > 0 ? plugin.id.slice(0, at) : plugin.id,
      marketplace: at > 0 ? plugin.id.slice(at + 1) : plugin.source,
      installed: plugin,
    });
  }
  return entries;
}

/** A plugin the daemon does not flag as inactive counts as active. */
export const isPluginActive = (plugin: InstalledPlugin): boolean => plugin.active !== false;

export type MarketplaceRepoResult = { ok: true; repo: string } | { ok: false; error: string };

const GITHUB_URL = /^https?:\/\/github\.com\//i;
const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** The add form takes a GitHub repository as `owner/repo` (a github.com URL is reduced to it). */
export function validateMarketplaceRepo(input: string): MarketplaceRepoResult {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, error: 'required' };
  const repo = trimmed.replace(GITHUB_URL, '').replace(/\.git$/i, '');
  return OWNER_REPO.test(repo) ? { ok: true, repo } : { ok: false, error: 'invalid' };
}
