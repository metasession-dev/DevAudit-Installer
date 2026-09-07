import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeSdlcConfigTarget } from '../src/install/write-config.js';
import { readSdlcConfig, resolveTargets } from '../src/lib/sdlc-config.js';

const dirs: string[] = [];

async function writeConfig(content: unknown): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'write-config-test-'));
  dirs.push(dir);
  await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(content), 'utf-8');
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('removeSdlcConfigTarget', () => {
  it('deletes the file entirely when it was the only (legacy flat) target', async () => {
    const dir = await writeConfig({
      project_slug: 'acme-app',
      stack: 'node',
      working_directory: '.',
      devaudit: { project_slug: 'acme-app', api_key_secret: 'DEVAUDIT_API_KEY' },
    });

    const result = await removeSdlcConfigTarget(dir, 'default');

    expect(result).toEqual({ removed: true, deletedFile: true, remainingTargetNames: [] });
    const config = await readSdlcConfig(dir);
    expect(config).toBeNull();
  });

  it('matches by project slug as well as target name', async () => {
    const dir = await writeConfig({
      project_slug: 'acme-app',
      stack: 'node',
      working_directory: '.',
      devaudit: { project_slug: 'acme-app', api_key_secret: 'DEVAUDIT_API_KEY' },
    });

    const result = await removeSdlcConfigTarget(dir, 'acme-app');
    expect(result.removed).toBe(true);
    expect(result.deletedFile).toBe(true);
  });

  it('collapses back to the flat single-target shape when one target remains', async () => {
    const dir = await writeConfig({
      project_slug: 'thorstack',
      targets: [
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
      ],
    });

    const result = await removeSdlcConfigTarget(dir, 'api');
    expect(result).toEqual({ removed: true, deletedFile: false, remainingTargetNames: ['web'] });

    const config = await readSdlcConfig(dir);
    expect(config).not.toBeNull();
    expect((config as unknown as { targets?: unknown }).targets).toBeUndefined();
    expect((config as unknown as { project_slug: string }).project_slug).toBe('thorstack-web');

    const targets = resolveTargets(config!);
    expect(targets).toHaveLength(1);
    // A collapsed flat config is always synthesized as 'default' by
    // resolveTargets, regardless of what the target was named while it
    // lived in the `targets` array — the project_slug assertion above is
    // what actually confirms the right target's fields survived.
    expect(targets[0]?.name).toBe('default');
  });

  it('keeps the targets array when more than one target remains after removal', async () => {
    const dir = await writeConfig({
      project_slug: 'thorstack',
      targets: [
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
        {
          name: 'worker',
          stack: 'python',
          working_directory: 'mission-control-worker',
          devaudit: { project_slug: 'thorstack-worker', api_key_secret: 'DEVAUDIT_API_KEY_WORKER' },
        },
      ],
    });

    const result = await removeSdlcConfigTarget(dir, 'api');
    expect(result).toEqual({
      removed: true,
      deletedFile: false,
      remainingTargetNames: ['web', 'worker'],
    });

    const config = await readSdlcConfig(dir);
    const targets = resolveTargets(config!);
    expect(targets.map((t) => t.name)).toEqual(['web', 'worker']);
  });

  it('is a no-op (removed: false) when the config has no matching target', async () => {
    const dir = await writeConfig({
      project_slug: 'acme-app',
      stack: 'node',
      working_directory: '.',
      devaudit: { project_slug: 'acme-app', api_key_secret: 'DEVAUDIT_API_KEY' },
    });

    const result = await removeSdlcConfigTarget(dir, 'not-a-real-target');
    expect(result.removed).toBe(false);
    expect(result.deletedFile).toBe(false);

    const config = await readSdlcConfig(dir);
    expect(config).not.toBeNull();
  });

  it('is a no-op when sdlc-config.json does not exist', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'write-config-test-'));
    dirs.push(dir);
    const result = await removeSdlcConfigTarget(dir, 'default');
    expect(result).toEqual({ removed: false, deletedFile: false, remainingTargetNames: [] });
  });
});
