import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');

describe('devaudit --help', () => {
  it('prints usage + version', async () => {
    const result = await execa('node', [BIN, '--help'], { reject: false });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('devaudit');
    expect(result.stdout).toContain('install');
    expect(result.stdout).toContain('doctor');
  }, 30_000);
});

describe('devaudit --version', () => {
  it('prints a semver-shaped version', async () => {
    const result = await execa('node', [BIN, '--version'], { reject: false });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+$/);
  }, 30_000);
});

describe('devaudit doctor', () => {
  it('runs without crashing (exit code 0 or 6 depending on environment)', async () => {
    const result = await execa('node', [BIN, 'doctor'], { reject: false });
    // Pass if all tools are present (0); also acceptable in CI if something's
    // missing — we exit 6 with a clear diagnostic.
    expect([0, 6]).toContain(result.exitCode);
    expect(result.stdout + result.stderr).toContain('node');
  }, 30_000);

  it('reports release close-out drift check (skips gracefully without portal creds)', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-'));
    await writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture', devaudit: { base_url: 'https://example.test' } }),
    );
    await mkdir(join(dir, 'compliance', 'pending-releases'), { recursive: true });
    await writeFile(
      join(dir, 'compliance', 'pending-releases', 'RELEASE-TICKET-REQ-099.md'),
      '# t\n',
    );
    // No DEVAUDIT_API_KEY in env → the portal drift check skips but still
    // reports the pending-ticket count; doctor's tool-gate exit is unaffected.
    const env = { ...process.env };
    delete env['DEVAUDIT_API_KEY'];
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, env, reject: false });
    expect([0, 6]).toContain(result.exitCode);
    expect(result.stdout + result.stderr).toContain('pending ticket(s)');
  }, 30_000);
});

describe('stubbed commands (workstream B / D prereqs)', () => {
  it('org list exits non-zero with a "not implemented yet" message', async () => {
    const result = await execa('node', [BIN, 'org', 'list'], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('not implemented yet');
  }, 30_000);

});
