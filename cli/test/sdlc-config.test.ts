import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSdlcConfig, resolveTargets } from '../src/lib/sdlc-config.js';

const dirs: string[] = [];

async function writeConfig(content: unknown): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'sdlc-config-test-'));
  dirs.push(dir);
  await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(content), 'utf-8');
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('resolveTargets', () => {
  it('synthesizes a single implicit target from a legacy flat config', async () => {
    const dir = await writeConfig({
      project_slug: 'acme-app',
      stack: 'node',
      working_directory: '.',
      source_dirs: 'src',
      production_url_secret: 'PROD_URL',
      devaudit: { project_slug: 'acme-app', api_key_secret: 'DEVAUDIT_API_KEY' },
    });

    const config = await readSdlcConfig(dir);
    expect(config).not.toBeNull();

    const targets = resolveTargets(config!);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual({
      name: 'default',
      stack: 'node',
      working_directory: '.',
      source_dirs: 'src',
      production_url_secret: 'PROD_URL',
      devaudit: { project_slug: 'acme-app', api_key_secret: 'DEVAUDIT_API_KEY' },
    });
  });

  it('round-trips an explicit targets array unchanged', async () => {
    const targetsInput = [
      {
        name: 'api',
        stack: 'python',
        working_directory: 'mission-control-api',
        devaudit: { project_slug: 'thorstack-api', api_key_secret: 'DEVAUDIT_API_KEY_API' },
      },
      {
        name: 'web',
        stack: 'node',
        working_directory: 'mission-control',
        devaudit: { project_slug: 'thorstack-web', api_key_secret: 'DEVAUDIT_API_KEY_WEB' },
      },
    ];
    const dir = await writeConfig({ project_slug: 'thorstack', targets: targetsInput });

    const config = await readSdlcConfig(dir);
    expect(config).not.toBeNull();

    const targets = resolveTargets(config!);
    expect(targets).toEqual(targetsInput);
  });

  it('returns null for a missing config file', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'sdlc-config-test-'));
    dirs.push(dir);
    const config = await readSdlcConfig(dir);
    expect(config).toBeNull();
  });
});
