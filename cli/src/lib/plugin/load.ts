import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from '@metasession.co/devaudit-plugin-sdk';
import type { Plugin } from '@metasession.co/devaudit-plugin-sdk';
import type { LoadedPlugin } from './types.js';

function toFileUrl(absPath: string): string {
  // pathToFileURL is the canonical API but it percent-encodes `~` to `%7E`,
  // which breaks dynamic import resolution on Windows GitHub Actions runners
  // (`os.tmpdir()` returns 8.3 short names like `RUNNER~1`). `~` is a valid
  // URL character — decoding it back is safe and well-defined.
  return pathToFileURL(absPath).href.replace(/%7E/g, '~');
}

export async function loadPluginFromDir(dir: string): Promise<LoadedPlugin> {
  const pkgPath = join(dir, 'package.json');
  const raw = await fs.readFile(pkgPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const result = validateManifest(parsed);
  if (!result.valid) {
    throw new Error(`Invalid manifest in ${pkgPath}: ${result.errors.join('; ')}`);
  }
  const mainPath = resolve(dir, result.main);
  const mod = (await import(toFileUrl(mainPath))) as { default?: Plugin };
  if (!mod.default || typeof mod.default !== 'object') {
    throw new Error(`Plugin main module ${mainPath} did not default-export a Plugin object.`);
  }
  if (mod.default.apiVersion !== '1') {
    throw new Error(
      `Plugin ${result.packageName} declares apiVersion '${mod.default.apiVersion}' at runtime, expected '1'.`,
    );
  }
  if (typeof mod.default.name !== 'string' || mod.default.name.length === 0) {
    throw new Error(`Plugin main module ${mainPath} did not export a non-empty 'name'.`);
  }
  return {
    dir,
    packageName: result.packageName,
    packageVersion: result.packageVersion,
    manifest: result.manifest,
    plugin: mod.default,
  };
}
