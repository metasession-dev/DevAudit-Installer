import { promises as fs } from 'node:fs';
import { join } from 'node:path';

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
  const path = join(installerRoot, 'sdlc', 'files', 'stacks', stack, 'adapter.json');
  const raw = await fs.readFile(path, 'utf-8');
  return JSON.parse(raw) as StackAdapter;
}

export async function loadHostAdapter(installerRoot: string, host: string): Promise<HostAdapter> {
  const path = join(installerRoot, 'sdlc', 'files', 'hosts', host, 'adapter.json');
  const raw = await fs.readFile(path, 'utf-8');
  return JSON.parse(raw) as HostAdapter;
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
