import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { exists } from '../lib/fs-utils.js';
import { listStacks, listHosts } from '../lib/adapter.js';

export interface AdapterResolution {
  readonly stack: string;
  readonly host: string;
  readonly deprecatedDefaults: boolean;
}

interface PartialConfig {
  readonly stack?: string;
  readonly host?: string;
}

export async function resolveAdapters(projectPath: string, installerRoot: string): Promise<AdapterResolution> {
  const configPath = join(projectPath, 'sdlc-config.json');
  let stack = 'node';
  let host = 'railway';
  let deprecatedDefaults = false;
  if (await exists(configPath)) {
    const raw = await fs.readFile(configPath, 'utf-8');
    const cfg = JSON.parse(raw) as PartialConfig;
    if (cfg.stack) {
      stack = cfg.stack;
    } else {
      deprecatedDefaults = true;
    }
    if (cfg.host) {
      host = cfg.host;
    } else {
      deprecatedDefaults = true;
    }
  } else {
    deprecatedDefaults = true;
  }
  const stackPath = join(installerRoot, 'sdlc', 'files', 'stacks', stack, 'adapter.json');
  if (!(await exists(stackPath))) {
    const available = await listStacks(installerRoot);
    throw new Error(`stack adapter not found: stacks/${stack}/adapter.json. Available: ${available.join(', ')}`);
  }
  const hostPath = join(installerRoot, 'sdlc', 'files', 'hosts', host, 'adapter.json');
  if (!(await exists(hostPath))) {
    const available = await listHosts(installerRoot);
    throw new Error(`host adapter not found: hosts/${host}/adapter.json. Available: ${available.join(', ')}`);
  }
  return { stack, host, deprecatedDefaults };
}
