import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promises as fs } from 'node:fs';

/**
 * Resolve the directory that holds the SDLC framework templates (`sdlc/files/`).
 *
 * Three sources, in priority order:
 *   1. `DEVAUDIT_INSTALLER_ROOT` — explicit override (e.g. developing against a
 *      checkout that isn't the bundled snapshot).
 *   2. The package's own bundled snapshot — when installed from npm, the
 *      published tarball ships `sdlc/` (and `scripts/upload-evidence.sh`)
 *      alongside `dist/`. See `tools/bundle-templates.mjs`, run on `prepack`.
 *      `dist/index.js` → `..` is the package root.
 *   3. The DevAudit-Installer repo root — running from a source checkout
 *      (`cli/dist/index.js` → `../..`), where the canonical `sdlc/` lives.
 *
 * The sentinel is the presence of `sdlc/files` — not any bash script. The CLI
 * is the onboarding tool; it no longer depends on `scripts/sdlc-onboard.sh`.
 */
export async function resolveInstallerRoot(): Promise<string> {
  const override = process.env['DEVAUDIT_INSTALLER_ROOT'];
  if (override) return resolve(override);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '..'), resolve(here, '..', '..')];
  for (const candidate of candidates) {
    if (await hasTemplates(candidate)) return candidate;
  }
  throw new Error(
    'Could not locate the SDLC templates (sdlc/files). Reinstall @metasession.co/devaudit-cli, ' +
      'or set DEVAUDIT_INSTALLER_ROOT to a DevAudit-Installer checkout.',
  );
}

async function hasTemplates(root: string): Promise<boolean> {
  try {
    await fs.access(resolve(root, 'sdlc', 'files'));
    return true;
  } catch {
    return false;
  }
}
