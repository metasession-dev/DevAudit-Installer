import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from '@metasession-dev/devaudit-plugin-sdk';
import type { Plugin } from '@metasession-dev/devaudit-plugin-sdk';
import type { LoadedPlugin } from './types.js';

export async function loadPluginFromDir(dir: string): Promise<LoadedPlugin> {
  const pkgPath = join(dir, 'package.json');
  const raw = await fs.readFile(pkgPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const result = validateManifest(parsed);
  if (!result.valid) {
    throw new Error(`Invalid manifest in ${pkgPath}: ${result.errors.join('; ')}`);
  }
  const mainPath = resolve(dir, result.main);
  const mod = (await import(pathToFileURL(mainPath).href)) as { default?: Plugin };
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
