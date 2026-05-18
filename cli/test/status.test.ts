import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');

describe('devaudit status', () => {
  let fixtureDir = '';
  beforeAll(async () => {
    fixtureDir = await fs.mkdtemp(join(tmpdir(), 'devaudit-status-'));
    await fs.writeFile(
      join(fixtureDir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-app',
        stack: 'node',
        host: 'railway',
        node_version: 20,
        devaudit: { base_url: 'https://devaudit.metasession.co' },
      }),
    );
  });
  afterAll(async () => {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it('prints project state when sdlc-config.json is present', async () => {
    const result = await execa('node', [BIN, 'status', fixtureDir], { reject: false });
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('fixture-app');
    expect(result.stdout + result.stderr).toContain('node');
    expect(result.stdout + result.stderr).toContain('railway');
  }, 30_000);

  it('warns when no sdlc-config.json is present', async () => {
    const emptyDir = await fs.mkdtemp(join(tmpdir(), 'devaudit-empty-'));
    try {
      const result = await execa('node', [BIN, 'status', emptyDir], { reject: false });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain('not onboarded');
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  }, 30_000);
});
