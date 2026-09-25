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

describe('devaudit doctor — onboarding-checklist invariants (#826)', () => {
  it('reports docs/SRS.md and compliance/RTM.md missing on a fresh consumer project', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-srs-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('docs/SRS.md missing');
    expect(output).toContain('compliance/RTM.md missing');
  }, 30_000);

  it('reports docs/SRS.md present and RTM initialized once both exist', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-srs-ok-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'SRS.md'), '# SRS\n');
    await mkdir(join(dir, 'compliance'), { recursive: true });
    await writeFile(
      join(dir, 'compliance', 'RTM.md'),
      '# RTM\n| REQ-ID | Title |\n| --- | --- |\n| REQ-001 | Example |\n',
    );
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('docs/SRS.md present');
    expect(output).toContain('at least one requirement row');
  }, 30_000);

  it('warns when a skeleton RTM.md has no REQ rows yet', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-rtm-skeleton-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await mkdir(join(dir, 'compliance'), { recursive: true });
    await writeFile(join(dir, 'compliance', 'RTM.md'), '# RTM\n| REQ-ID | Title |\n| --- | --- |\n');
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('still the generated skeleton');
  }, 30_000);

  it('warns when e2e_regression_enabled is true but playwright.config.ts lacks the critical/regression projects', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-e2e-mismatch-'));
    await writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture', e2e_regression_enabled: true }),
    );
    await writeFile(
      join(dir, 'playwright.config.ts'),
      "export default { projects: [{ name: 'smoke' }] };\n",
    );
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('missing the critical, regression project(s)');
  }, 30_000);

  it('warns when playwright.config.ts defines critical/regression but e2e_regression_enabled is unset', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-e2e-unset-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await writeFile(
      join(dir, 'playwright.config.ts'),
      "export default { projects: [{ name: 'critical' }, { name: 'regression' }] };\n",
    );
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('e2e_regression_enabled is not set');
  }, 30_000);

  it('reports clean when e2e_regression_enabled matches the playwright projects present', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-e2e-ok-'));
    await writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture', e2e_regression_enabled: true }),
    );
    await writeFile(
      join(dir, 'playwright.config.ts'),
      "export default { projects: [{ name: 'critical' }, { name: 'regression' }] };\n",
    );
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('projects present, workflow enabled');
  }, 30_000);
});

describe('devaudit doctor — onboarding-checklist invariants (#867)', () => {
  it('reports the pre-push hook missing on a fresh consumer project with no hooks bootstrapped', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-prepush-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('no pre-push hook found');
  }, 30_000);

  it('reports the pre-push hook present once .husky/pre-push exists', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-prepush-ok-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await mkdir(join(dir, '.husky'), { recursive: true });
    await writeFile(join(dir, '.husky', 'pre-push'), '#!/usr/bin/env sh\n');
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/pre-push-hook\s+present/);
  }, 30_000);

  it('skips the required-secrets check gracefully outside a GitHub repo', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-secrets-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    expect([0, 6]).toContain(result.exitCode);
    // Non-fatal either way -- either it skips (no gh repo context) or reports
    // missing secrets; both are 'ok: true'-shaped for the onboarding summary
    // and must not crash the process.
  }, 30_000);

  it('--json emits a structured report including the new checks, tagged with a suspectedOrigin', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-json-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'SRS.md'), '# SRS\n');
    const result = await execa('node', [BIN, '--json', 'doctor'], { cwd: dir, reject: false });
    expect([0, 6]).toContain(result.exitCode);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      tools: Array<{ name: string; ok: boolean }>;
      onboarding: Array<{ name: string; ok: boolean; suspectedOrigin?: string }>;
    };
    expect(Array.isArray(report.tools)).toBe(true);
    expect(report.tools.some((t) => t.name === 'node')).toBe(true);
    const srsCheck = report.onboarding.find((c) => c.name === 'srs');
    expect(srsCheck?.ok).toBe(true);
    expect(srsCheck?.suspectedOrigin).toBe('consumer-drift');
    const prePushCheck = report.onboarding.find((c) => c.name === 'pre-push-hook');
    expect(prePushCheck?.suspectedOrigin).toBe('consumer-drift');
  }, 30_000);
});

describe('stubbed commands (workstream B / D prereqs)', () => {
  it('org list exits non-zero with a "not implemented yet" message', async () => {
    const result = await execa('node', [BIN, 'org', 'list'], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('not implemented yet');
  }, 30_000);

});
