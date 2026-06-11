import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });
const validatorCache = new Map<string, ValidateFunction>();

/**
 * Compile (and cache) the JSON Schema at `schemaPath`. Returns `null` when the
 * schema file is absent — validation is best-effort hardening
 * (DevAudit-Installer#158), so a bundled-templates snapshot that trimmed the
 * `_schema/` dir degrades to the previous parse-only behaviour rather than
 * failing the run.
 */
async function getValidator(schemaPath: string): Promise<ValidateFunction | null> {
  const cached = validatorCache.get(schemaPath);
  if (cached) return cached;
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(await fs.readFile(schemaPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  // Drop `$id` so compiling two schema files that share an id (e.g. the same
  // schema reached via two installer roots) doesn't trip Ajv's
  // "schema already exists" guard. Our adapter schemas have no internal $refs
  // that need the id.
  delete schema['$id'];
  const validate = ajv.compile(schema);
  validatorCache.set(schemaPath, validate);
  return validate;
}

function formatErrors(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((e) => `  - ${e.instancePath === '' ? '(root)' : e.instancePath} ${e.message ?? 'is invalid'}`)
    .join('\n');
}

/**
 * Read + parse an adapter.json and validate it against `schemaPath`. A
 * parseable-but-schema-invalid adapter now fails loudly at load time
 * (DevAudit-Installer#158) instead of rendering broken CI/hooks into a
 * consumer with no early error.
 */
async function loadAdapter<T>(adapterPath: string, schemaPath: string, kind: string): Promise<T> {
  const raw = await fs.readFile(adapterPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${kind} adapter ${adapterPath}: ${(err as Error).message}`);
  }
  const validate = await getValidator(schemaPath);
  if (validate && !validate(parsed)) {
    throw new Error(`${kind} adapter ${adapterPath} failed schema validation:\n${formatErrors(validate)}`);
  }
  return parsed as T;
}

export interface StackAdapter {
  readonly name: string;
  readonly hook_install_dir?: string;
  readonly hooks?: readonly string[];
  readonly hook_config_files?: readonly string[];
  readonly stack_scripts?: readonly string[];
  readonly required_dev_dependencies?: readonly string[];
  readonly manifest_file?: string;
}

export interface HostAdapter {
  readonly name: string;
}

export async function loadStackAdapter(installerRoot: string, stack: string): Promise<StackAdapter> {
  const adapterPath = join(installerRoot, 'sdlc', 'files', 'stacks', stack, 'adapter.json');
  const schemaPath = join(installerRoot, 'sdlc', 'files', 'stacks', '_schema', 'adapter.schema.json');
  return loadAdapter<StackAdapter>(adapterPath, schemaPath, 'Stack');
}

export async function loadHostAdapter(installerRoot: string, host: string): Promise<HostAdapter> {
  const adapterPath = join(installerRoot, 'sdlc', 'files', 'hosts', host, 'adapter.json');
  const schemaPath = join(installerRoot, 'sdlc', 'files', 'hosts', '_schema', 'adapter.schema.json');
  return loadAdapter<HostAdapter>(adapterPath, schemaPath, 'Host');
}

export async function listStacks(installerRoot: string): Promise<readonly string[]> {
  const dir = join(installerRoot, 'sdlc', 'files', 'stacks');
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name);
}

export async function listHosts(installerRoot: string): Promise<readonly string[]> {
  const dir = join(installerRoot, 'sdlc', 'files', 'hosts');
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name);
}
