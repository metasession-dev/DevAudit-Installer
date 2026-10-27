import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import * as clack from '@clack/prompts';
import { logger } from '../../lib/logger.js';
import { resolveRepoRoot } from '../../lib/git-root.js';
import { saveViewerKey, viewerKeyName } from '../../lib/viewer-keys.js';
import { VIEWER_KEYS_FILE } from '../../lib/paths.js';

/**
 * devaudit-installer#1099 WP3 — `devaudit auth viewer-key set [--project <slug>]`.
 *
 * Stores a viewer key you received another way (for example one issued from the
 * portal key list) in the CLI config folder. The key is read from a masked
 * prompt, so it never appears in shell history, argv or the output.
 */

const DEFAULT_BASE_URL = 'https://devaudit.ai';

export interface ViewerKeySetDeps {
  /** Returns the key typed at a masked prompt, or null when cancelled / not interactive. */
  readonly readSecret: () => Promise<string | null>;
  readonly interactive: boolean;
}

const defaultDeps: ViewerKeySetDeps = {
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  readSecret: async () => {
    const r = await clack.password({ message: 'Paste your DevAudit viewer key:', validate: (v) => (v ? undefined : 'A key is required.') });
    return clack.isCancel(r) ? null : r;
  },
};

export async function runViewerKeySet(opts: { project?: string; cwd?: string; file?: string }, deps: ViewerKeySetDeps = defaultDeps): Promise<number> {
  const log = logger();
  const repoRoot = await resolveRepoRoot(opts.cwd ?? process.cwd());
  let slug = opts.project;
  let baseUrl = process.env['DEVAUDIT_BASE_URL'] ?? '';
  try {
    const cfg = JSON.parse(await fs.readFile(join(repoRoot, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
    const d = (cfg['devaudit'] ?? {}) as { project_slug?: string; base_url?: string };
    slug = slug ?? d.project_slug ?? (cfg['project_slug'] as string | undefined);
    baseUrl = d.base_url ?? baseUrl;
  } catch {
    // outside a consumer project: --project is then required
  }
  if (!slug) {
    log.error('No project: run this inside a consumer project, or pass --project <slug>.');
    return 2;
  }
  if (!deps.interactive) {
    log.error('This command asks for the key at a masked prompt, so it needs an interactive terminal.');
    return 2;
  }
  const key = (await deps.readSecret())?.trim();
  if (!key) {
    log.warn('Cancelled; nothing saved.');
    return 1;
  }
  await saveViewerKey(baseUrl || DEFAULT_BASE_URL, slug, { key, name: await viewerKeyName(repoRoot), createdAt: new Date().toISOString() }, opts.file ?? VIEWER_KEYS_FILE);
  log.success(`Saved the viewer key for ${slug} in ${opts.file ?? VIEWER_KEYS_FILE} (mode 0600). Run \`devaudit doctor\` to check it authenticates.`);
  return 0;
}
