import type { CommandContribution } from './commands.js';
import { isValidCommandName } from './commands.js';
import type { LifecycleHookName } from './lifecycle.js';
import { isLifecycleHookName } from './lifecycle.js';

export const SUPPORTED_API_VERSIONS: readonly string[] = ['1'];

export interface PluginManifest {
  readonly apiVersion: '1';
  readonly displayName?: string;
  readonly description?: string;
  readonly commands?: readonly CommandContribution[];
  readonly hooks?: readonly LifecycleHookName[];
}

export interface ManifestSource {
  readonly name?: string;
  readonly version?: string;
  readonly main?: string;
  readonly devaudit?: unknown;
  readonly [key: string]: unknown;
}

export interface ManifestValidationOk {
  readonly valid: true;
  readonly manifest: PluginManifest;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly main: string;
}

export interface ManifestValidationFail {
  readonly valid: false;
  readonly errors: readonly string[];
}

export type ManifestValidationResult = ManifestValidationOk | ManifestValidationFail;

export function validateManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) {
    return { valid: false, errors: ['manifest source must be an object (got null or non-object)'] };
  }
  const src = input as ManifestSource;
  const name = requireString(src, 'name', errors);
  const version = requireString(src, 'version', errors);
  const main = requireString(src, 'main', errors);
  const devaudit = src.devaudit;
  if (typeof devaudit !== 'object' || devaudit === null) {
    errors.push('package.json must include a top-level `devaudit` object');
    return { valid: false, errors };
  }
  const d = devaudit as Record<string, unknown>;
  const apiVersion = d['apiVersion'];
  if (typeof apiVersion !== 'string') {
    errors.push('devaudit.apiVersion must be a string');
  } else if (!SUPPORTED_API_VERSIONS.includes(apiVersion)) {
    errors.push(`devaudit.apiVersion '${apiVersion}' is not supported (supported: ${SUPPORTED_API_VERSIONS.join(', ')})`);
  }
  const commands = validateCommands(d['commands'], errors);
  const hooks = validateHooks(d['hooks'], errors);
  if (errors.length > 0) return { valid: false, errors };
  const manifest: PluginManifest = {
    apiVersion: '1',
    ...(typeof d['displayName'] === 'string' ? { displayName: d['displayName'] } : {}),
    ...(typeof d['description'] === 'string' ? { description: d['description'] } : {}),
    ...(commands ? { commands } : {}),
    ...(hooks ? { hooks } : {}),
  };
  return { valid: true, manifest, packageName: name!, packageVersion: version!, main: main! };
}

function requireString(src: Record<string, unknown>, key: string, errors: string[]): string | null {
  const value = src[key];
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`package.json must include a non-empty '${key}' string`);
    return null;
  }
  return value;
}

function validateCommands(input: unknown, errors: string[]): readonly CommandContribution[] | null {
  if (input === undefined) return null;
  if (!Array.isArray(input)) {
    errors.push('devaudit.commands must be an array');
    return null;
  }
  const out: CommandContribution[] = [];
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) {
      errors.push('devaudit.commands[] entries must be objects');
      continue;
    }
    const e = entry as Record<string, unknown>;
    const name = e['name'];
    const description = e['description'];
    if (!isValidCommandName(name)) {
      errors.push(`devaudit.commands[].name must match /^[a-z][a-z0-9-]*$/, got: ${JSON.stringify(name)}`);
      continue;
    }
    if (typeof description !== 'string') {
      errors.push(`devaudit.commands[].description must be a string (for command '${name}')`);
      continue;
    }
    out.push({ name, description });
  }
  return out;
}

function validateHooks(input: unknown, errors: string[]): readonly LifecycleHookName[] | null {
  if (input === undefined) return null;
  if (!Array.isArray(input)) {
    errors.push('devaudit.hooks must be an array');
    return null;
  }
  const out: LifecycleHookName[] = [];
  for (const entry of input) {
    if (!isLifecycleHookName(entry)) {
      errors.push(`devaudit.hooks[] entry '${String(entry)}' is not a recognised lifecycle hook`);
      continue;
    }
    out.push(entry);
  }
  return out;
}
