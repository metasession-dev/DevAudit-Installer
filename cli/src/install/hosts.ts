import { listHosts } from '../lib/adapter.js';

/** Hosts the installer has always defaulted to when nothing says otherwise. */
export const DEFAULT_HOST = 'railway';

/** One-line descriptions for the interactive host prompt; unknown hosts show their name only. */
export const HOST_HINTS: Readonly<Record<string, string>> = {
  railway: 'Railway (GitHub deployment status posted by the Railway app)',
  vercel: 'Vercel (GitHub deployment status posted by the Vercel app)',
  custom: 'Your own deploy: AWS, self-hosted, anything. A synced workflow runs your deploy command and records the GitHub deployment',
};

/**
 * devaudit-installer#1022 — `install` used to hardcode `host: 'railway'` into
 * `sdlc-config.json`, so a Vercel consumer had to hand-edit it, and a second
 * `install` run silently reset `host: vercel` back to Railway. The host is now
 * resolved in this order: the explicit `--host`, then the host already in
 * `sdlc-config.json`, then the historical default.
 *
 * Throws a message that lists the valid hosts when `requested` (or the existing
 * value) is not an adapter the installer ships.
 */
export async function resolveHost(opts: {
  readonly installerRoot: string;
  readonly requested?: string | undefined;
  readonly existing?: string | undefined;
}): Promise<string> {
  const available = await listHosts(opts.installerRoot);
  const candidate = opts.requested ?? opts.existing ?? DEFAULT_HOST;
  if (!available.includes(candidate)) {
    const source = opts.requested !== undefined ? '--host' : 'sdlc-config.json "host"';
    throw new Error(
      `Unknown host "${candidate}" (${source}). Available hosts: ${[...available].sort().join(', ')}. ` +
        'See docs/adding-a-host.md to add one.',
    );
  }
  return candidate;
}
