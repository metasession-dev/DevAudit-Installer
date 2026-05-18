import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promises as fs } from 'node:fs';

/**
 * Resolve the DevAudit-Installer repo root from the CLI's runtime location.
 * The CLI ships as `cli/dist/index.js`; the installer root is two levels up.
 *
 * Override with DEVAUDIT_INSTALLER_ROOT for development against a checkout
 * that's not the bundled snapshot.
 */
export async function resolveInstallerRoot(): Promise<string> {
  const override = process.env['DEVAUDIT_INSTALLER_ROOT'];
  if (override) return resolve(override);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '..', '..');
  await fs.access(resolve(candidate, 'scripts', 'sdlc-onboard.sh'));
  return candidate;
}
