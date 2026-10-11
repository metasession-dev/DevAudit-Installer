import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import { delimiter as pathDelimiter, dirname, join, resolve } from 'node:path';
import { promises as fsp } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

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

describe('devaudit doctor — commitlint config shadowing (#942)', () => {
  it('skips when commitlint.config.mjs was never synced', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-commitlint-unsynced-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/commitlint-config-shadowing\s+skipped \(commitlint\.config\.mjs not synced here\)/);
  }, 30_000);

  it('reports clean when only the managed commitlint.config.mjs is present', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-commitlint-ok-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await writeFile(join(dir, 'commitlint.config.mjs'), 'export default {};\n');
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/commitlint-config-shadowing\s+only the managed commitlint\.config\.mjs is in effect/);
  }, 30_000);

  it('warns when a legacy commitlint.config.cjs shadows the managed .mjs', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-commitlint-shadow-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await writeFile(join(dir, 'commitlint.config.mjs'), 'export default {};\n');
    await writeFile(join(dir, 'commitlint.config.cjs'), 'module.exports = {};\n');
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('commitlint.config.cjs shadows the managed commitlint.config.mjs');
    expect(output).toContain('remove commitlint.config.cjs');
  }, 30_000);

  it('warns when a package.json#commitlint field shadows the managed .mjs', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-commitlint-pkg-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await writeFile(join(dir, 'commitlint.config.mjs'), 'export default {};\n');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ commitlint: { extends: ['@commitlint/config-conventional'] } }));
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('package.json#commitlint shadows the managed commitlint.config.mjs');
  }, 30_000);

  it('--json reports commitlint-config-shadowing with a consumer-drift suspectedOrigin', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-commitlint-json-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await writeFile(join(dir, 'commitlint.config.mjs'), 'export default {};\n');
    await writeFile(join(dir, 'commitlint.config.cjs'), 'module.exports = {};\n');
    const result = await execa('node', [BIN, '--json', 'doctor'], { cwd: dir, reject: false });
    const report = JSON.parse(result.stdout) as {
      onboarding: Array<{ name: string; ok: boolean; suspectedOrigin?: string; detail: string }>;
    };
    const check = report.onboarding.find((c) => c.name === 'commitlint-config-shadowing');
    expect(check?.ok).toBe(false);
    expect(check?.suspectedOrigin).toBe('consumer-drift');
  }, 30_000);
});

describe('devaudit doctor — host-adapter prerequisites (#843)', () => {
  // Node-scripted mock (not bash) + a .cmd shim, mirroring writeMockGh in
  // devaudit-sdlc-engine.test.ts — a bash-shebang-only fake `gh` never runs
  // on Windows CI (no shebang interpretation), which silently fell through
  // to the real, unauthenticated `gh` and made these tests environment-
  // dependent instead of deterministic.
  async function fakeGhOnPath(dir: string, secretNames: readonly string[]): Promise<Record<string, string>> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const binDir = join(dir, 'fake-bin');
    await mkdir(binDir, { recursive: true });
    const ghPath = join(binDir, 'gh');
    const ghCmdPath = join(binDir, 'gh.cmd');
    const secretsJson = JSON.stringify(secretNames.map((name) => ({ name })));
    await writeFile(
      ghPath,
      `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === 'secret' && args[1] === 'list') {\n  process.stdout.write(${JSON.stringify(secretsJson)});\n  process.exit(0);\n}\nprocess.stdout.write('gh version 2.55.0\\n');\nprocess.exit(0);\n`,
      { mode: 0o755 },
    );
    await writeFile(ghCmdPath, `@echo off\r\nnode "%~dp0gh" %*\r\n`, { mode: 0o755 });
    return { ...process.env, PATH: `${binDir}${pathDelimiter}${process.env['PATH'] ?? ''}` };
  }

  // Isolates PATH down to just node's own directory, so a `railway` binary
  // that genuinely exists on the host (e.g. this repo's self-hosted CI
  // runner, which has the real CLI installed for ops use) can't leak into
  // the "not found" assertion below and make it environment-dependent.
  function nodeOnlyEnv(): Record<string, string | undefined> {
    return { ...process.env, PATH: dirname(process.execPath) };
  }

  it('folds the railway host adapter\'s RAILWAY_TOKEN into the missing-secrets report (default host)', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-railway-secrets-'));
    // No `host` key — resolveAdapters defaults to 'railway'.
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    // devaudit-installer#912: no DEVAUDIT_USER_TOKEN here — if it were still
    // required, the missing list would read "DEVAUDIT_USER_TOKEN, RAILWAY_TOKEN"
    // and this exact-prefix assertion would fail.
    const env = await fakeGhOnPath(dir, ['DEVAUDIT_API_KEY']);
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, env, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('missing repo secret(s): RAILWAY_TOKEN');
    expect(output).not.toContain('DEVAUDIT_USER_TOKEN');
  }, 30_000);

  it('does not require RAILWAY_TOKEN for a vercel host consumer', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-vercel-secrets-'));
    await writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture', host: 'vercel' }),
    );
    // devaudit-installer#912: DEVAUDIT_API_KEY alone is now the complete
    // required set for a vercel consumer — DEVAUDIT_USER_TOKEN isn't a repo secret.
    const env = await fakeGhOnPath(dir, ['DEVAUDIT_API_KEY']);
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, env, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('all required secrets present');
    expect(output).not.toContain('RAILWAY_TOKEN');
    expect(output).not.toContain('DEVAUDIT_USER_TOKEN');
  }, 30_000);

  it('skips the railway-cli check when reconcile-deployment.yml is not present', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-railway-cli-skip-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/railway-cli\s+skipped \(reconcile-deployment\.yml not present\)/);
  }, 30_000);

  it('reports the railway CLI missing when reconcile-deployment.yml is present but railway is not on PATH', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'devaudit-doctor-railway-cli-missing-'));
    await writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'fixture' }));
    await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
    await writeFile(join(dir, '.github', 'workflows', 'reconcile-deployment.yml'), 'name: reconcile\n');
    const result = await execa('node', [BIN, 'doctor'], { cwd: dir, env: nodeOnlyEnv(), reject: false });
    const output = result.stdout + result.stderr;
    expect(output).toContain('railway CLI not found on PATH');
  }, 30_000);
});

describe('stubbed commands (workstream B / D prereqs)', () => {
  it('org list exits non-zero with a "not implemented yet" message', async () => {
    const result = await execa('node', [BIN, 'org', 'list'], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('not implemented yet');
  }, 30_000);

});

// ---------------------------------------------------------------------------
// devaudit-installer#956 phase 3a-2 — release-deferral diagnosis (D3, D4, D6, D7, D8)
// ---------------------------------------------------------------------------

const GENERATE_BUNDLED_CHANGES = resolve(
  HERE, '..', '..', 'sdlc', 'files', '_common', 'scripts', 'generate-bundled-changes.sh',
);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await execa('git', args, { cwd });
  return r.stdout.trim();
}

/** A consumer repo on `main` with one commit; `develop` is checked out. */
async function fixtureRepo(config: Record<string, unknown> = { project_slug: 'fixture' }): Promise<string> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'devaudit-doctor-defer-'));
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 't@example.test');
  await git(dir, 'config', 'user.name', 'T');
  await git(dir, 'config', 'commit.gpgsign', 'false');
  await fsp.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(config));
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '-m', 'chore: init');
  await git(dir, 'checkout', '-q', '-b', 'develop');
  return dir;
}

interface TicketOpts {
  readonly intent?: string;
  readonly preds?: string; // raw text after the field label; omitted = field absent
  readonly pr?: string;
  readonly eol?: '\n' | '\r\n';
}

async function writeTicket(dir: string, version: string, o: TicketOpts = {}, sub = 'pending-releases'): Promise<void> {
  const eol = o.eol ?? '\n';
  const lines = [`# Release Ticket: ${version} — t`, '', '**Status:** TESTED - PENDING SIGN-OFF'];
  if (o.pr) lines.push(`**PR:** ${o.pr}`);
  lines.push('', '## Bundled Changes', '');
  if (o.preds !== undefined) lines.push(`- **Absorbed predecessor releases:** ${o.preds}`);
  if (o.intent) lines.push(`- **Release intent:** ${o.intent}`);
  const d = join(dir, 'compliance', sub);
  await fsp.mkdir(d, { recursive: true });
  await fsp.writeFile(join(d, `RELEASE-TICKET-${version}.md`), lines.join(eol) + eol);
}

async function commit(dir: string, subject: string, body = ''): Promise<void> {
  await git(dir, 'commit', '-q', '--allow-empty', '-m', body ? `${subject}\n\n${body}` : subject);
}

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const k of ['DEVAUDIT_API_KEY', 'DEVAUDIT_VIEWER_API_KEY']) if (!(k in extra)) delete env[k];
  return env;
}

interface DoctorJson {
  ok: boolean;
  tools: unknown[];
  releaseCloseoutDrift: { name: string; ok: boolean; detail: string };
  onboarding: unknown[];
  deferral: Array<{ name: string; ok: boolean; detail: string; findings?: Array<{ subject: string; remediation?: Record<string, unknown> }> }>;
  proposals: Array<{ check: string; subject: string; remediation: { id: string; tier: string; summary: string; plan: string[]; needsPortal: boolean } }>;
}

async function doctorJson(cwd: string, env: NodeJS.ProcessEnv = cleanEnv()): Promise<{ exitCode: number | undefined; json: DoctorJson; raw: string }> {
  const r = await execa('node', [BIN, 'doctor', '--json'], { cwd, env, reject: false });
  return { exitCode: r.exitCode, json: JSON.parse(r.stdout) as DoctorJson, raw: r.stdout + r.stderr };
}

const byName = (j: DoctorJson, name: string) => j.deferral.find((c) => c.name === name);

describe('devaudit doctor — D4 deferred REQ will ship unapproved (#956)', () => {
  it('warns when a deferred REQ has commits on develop and is not listed as a predecessor', async () => {
    const dir = await fixtureRepo();
    await writeTicket(dir, 'REQ-010', { intent: 'deferred-to-next — PR #5 closed unmerged', preds: 'None' });
    await writeTicket(dir, 'REQ-011', { preds: 'None' });
    await commit(dir, 'feat: deferred work [REQ-010]');
    const { json, raw } = await doctorJson(dir);
    const c = byName(json, 'deferred-will-ship');
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain('REQ-010');
    expect(c?.detail).toContain('will ship unapproved');
    expect(json.proposals.find((p) => p.check === 'deferred-will-ship')?.remediation).toMatchObject({
      id: 'list-deferred-predecessor', tier: 'A', needsPortal: false,
    });
    expect(raw).not.toContain('[object');
  }, 30_000);

  it('is clean when the next release ticket lists the deferred REQ (CRLF checkout)', async () => {
    const dir = await fixtureRepo();
    await writeTicket(dir, 'REQ-010', { intent: 'deferred-to-next — x', preds: 'None', eol: '\r\n' });
    await writeTicket(dir, 'REQ-011', { preds: 'REQ-010', eol: '\r\n' });
    await commit(dir, 'feat: work', 'Ref: REQ-010');
    const { json } = await doctorJson(dir);
    expect(byName(json, 'deferred-will-ship')?.ok).toBe(true);
    expect(json.proposals.filter((p) => p.check === 'deferred-will-ship')).toEqual([]);
  }, 30_000);

  it('ignores Release-Closeout commits and other REQs\' commits', async () => {
    const dir = await fixtureRepo();
    await writeTicket(dir, 'REQ-010', { intent: 'deferred-to-next — x', preds: 'None' });
    await commit(dir, 'chore: closeout', 'Ref: REQ-010\nRelease-Closeout: REQ-010');
    await commit(dir, 'feat: other [REQ-100]');
    const { json } = await doctorJson(dir);
    expect(byName(json, 'deferred-will-ship')?.ok).toBe(true);
  }, 30_000);

  it('skips with a note when develop/main are not both present', async () => {
    const dir = await fixtureRepo();
    await git(dir, 'checkout', '-q', 'main');
    await git(dir, 'branch', '-q', '-D', 'develop');
    await writeTicket(dir, 'REQ-010', { intent: 'deferred-to-next — x', preds: 'None' });
    const { json } = await doctorJson(dir);
    expect(byName(json, 'deferred-will-ship')).toMatchObject({ ok: true });
    expect(byName(json, 'deferred-will-ship')?.detail).toMatch(/^skipped/);
  }, 30_000);
});

describe('devaudit doctor — D6 "Absorbed predecessor releases: None" (#956)', () => {
  it('flags a None ticket while a pending candidate has commits in range', async () => {
    const dir = await fixtureRepo();
    await writeTicket(dir, 'REQ-020', { preds: 'None' });
    await writeTicket(dir, 'REQ-021', {});
    await commit(dir, 'feat: candidate work [REQ-021]');
    const { json } = await doctorJson(dir);
    const c = byName(json, 'predecessors-none');
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain('REQ-020');
    expect(c?.detail).toContain('REQ-021');
    expect(json.proposals.some((p) => p.check === 'predecessors-none' && p.remediation.id === 'fix-absorbed-predecessors')).toBe(true);
  }, 30_000);

  it('is clean when the candidate has no commits in range (REQ-21 vs Ref: REQ-210)', async () => {
    const dir = await fixtureRepo();
    await writeTicket(dir, 'REQ-020', { preds: 'None' });
    await writeTicket(dir, 'REQ-21', {});
    await commit(dir, 'feat: unrelated', 'Ref: REQ-210');
    const { json } = await doctorJson(dir);
    expect(byName(json, 'predecessors-none')?.ok).toBe(true);
  }, 30_000);

  it('does not flag a ticket that lists its predecessors', async () => {
    const dir = await fixtureRepo();
    await writeTicket(dir, 'REQ-020', { preds: 'REQ-021' });
    await writeTicket(dir, 'REQ-021', {});
    await commit(dir, 'feat: candidate work [REQ-021]');
    const { json } = await doctorJson(dir);
    expect(byName(json, 'predecessors-none')?.ok).toBe(true);
  }, 30_000);

  // Pins the TypeScript port to generate-bundled-changes.sh (#979 guard): both
  // must reach the same verdict on every fixture.
  describe('agrees with generate-bundled-changes.sh on the same fixtures', () => {
    const cases: Array<{ label: string; commits: Array<[string, string]>; flagged: boolean }> = [
      { label: 'subject tag [REQ-021]', commits: [['feat: a [REQ-021]', '']], flagged: true },
      { label: 'Ref: trailer', commits: [['feat: a', 'Ref: REQ-021']], flagged: true },
      { label: 'Ref: REQ-210 does not match REQ-021', commits: [['feat: a', 'Ref: REQ-0210']], flagged: false },
      { label: 'unbracketed prose mention', commits: [['feat: a REQ-021 thing', '']], flagged: false },
      { label: 'no commits', commits: [], flagged: false },
    ];
    for (const c of cases) {
      it(c.label, async (ctx) => {
        const hasTools =
          process.platform !== 'win32' &&
          // the script needs bash >=4 (mapfile, declare -A); macOS ships 3.2
          (await execa('bash', ['-c', 'type mapfile'], { reject: false })).exitCode === 0 &&
          (await execa('jq', ['--version'], { reject: false })).exitCode === 0;
        if (!hasTools) return ctx.skip();
        const dir = await fixtureRepo();
        await writeTicket(dir, 'REQ-020', { preds: 'None' });
        await writeTicket(dir, 'REQ-021', {});
        const since = await git(dir, 'rev-parse', 'HEAD');
        for (const [subject, body] of c.commits) await commit(dir, subject, body);

        const bash = await execa('bash', [GENERATE_BUNDLED_CHANGES, since, 'REQ-020'], { cwd: dir, reject: false });
        const bashFlagged = bash.stderr.includes("says 'Absorbed predecessor releases: None'");

        const { checkPredecessorsNone, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
        const tsResult = await checkPredecessorsNone(await buildDeferralContext(dir, {}));
        const tsFlagged = !tsResult.ok && (tsResult.findings ?? []).some((f) => f.subject === 'REQ-020');

        expect(bashFlagged).toBe(c.flagged);
        expect(tsFlagged).toBe(c.flagged);
      }, 30_000);
    }
  });
});

describe('devaudit doctor — graceful skips (#956)', () => {
  it('emits an empty deferral array outside a consumer project', async () => {
    const dir = await fsp.mkdtemp(join(tmpdir(), 'devaudit-doctor-nonconsumer-'));
    const { json } = await doctorJson(dir);
    expect(json.deferral).toEqual([]);
    expect(json.proposals).toEqual([]);
  }, 30_000);

  it('skips every deferral check when compliance/pending-releases is absent', async () => {
    const dir = await fixtureRepo();
    const { json, exitCode } = await doctorJson(dir);
    expect(json.deferral.map((c) => c.name)).toEqual([
      'release-pr-closed', 'deferred-will-ship', 'predecessors-none', 'bundle-members',
    ]);
    for (const c of json.deferral) {
      expect(c.ok).toBe(true);
      expect(c.detail).toMatch(/^skipped/);
    }
    expect([0, 6]).toContain(exitCode);
  }, 30_000);

  it('works with no git history at all (config only, no repo)', async () => {
    const dir = await fsp.mkdtemp(join(tmpdir(), 'devaudit-doctor-nogit-'));
    await fsp.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ project_slug: 'x' }));
    await writeTicket(dir, 'REQ-020', { preds: 'None' });
    await writeTicket(dir, 'REQ-010', { intent: 'deferred-to-next — x' });
    const { json } = await doctorJson(dir);
    for (const c of json.deferral) expect(c.ok).toBe(true);
  }, 30_000);

  it('findings never change the exit code (non-gating)', async () => {
    const dir = await fixtureRepo();
    await writeTicket(dir, 'REQ-020', { preds: 'None' });
    await writeTicket(dir, 'REQ-021', {});
    await commit(dir, 'feat: a [REQ-021]');
    const clean = await fixtureRepo();
    const a = await doctorJson(dir);
    const b = await doctorJson(clean);
    expect(a.json.ok).toBe(b.json.ok);
    expect(a.exitCode).toBe(b.exitCode);
  }, 60_000);
});

describe('devaudit doctor — portal-backed checks (#956, msw)', () => {
  const BASE = 'https://devaudit.test';
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());
  afterEach(() => {
    server.resetHandlers();
    delete process.env['DEVAUDIT_VIEWER_API_KEY'];
    delete process.env['DEVAUDIT_API_KEY'];
  });

  const releases = (map: Record<string, string | null>, seen: string[] = []) =>
    http.get(`${BASE}/api/ci/releases/resolve`, ({ request }) => {
      const u = new URL(request.url);
      seen.push(request.headers.get('authorization') ?? '');
      const status = map[u.searchParams.get('versionPrefix') ?? ''];
      return status ? HttpResponse.json({ latest: { status } }) : new HttpResponse(null, { status: 404 });
    });
  const cfg = { project_slug: 'fixture', devaudit: { project_slug: 'fixture', base_url: BASE } };
  const ghPr = (state: string, mergedAt: string | null = null) => async () => ({
    exitCode: 0, stdout: JSON.stringify({ state, mergedAt }),
  });

  it('D3 positive: PR closed unmerged, portal release still draft, nothing declared', async () => {
    process.env['DEVAUDIT_VIEWER_API_KEY'] = 'viewer-secret';
    const seen: string[] = [];
    server.use(releases({ 'REQ-030': 'draft' }, seen));
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-030', { pr: '#42' });
    const { checkClosedReleasePr, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
    const r = await checkClosedReleasePr(await buildDeferralContext(dir, cfg, ghPr('CLOSED')));
    expect(r.ok).toBe(false);
    expect(r.findings?.[0]).toMatchObject({ subject: 'REQ-030', remediation: { id: 'resolve-closed-release-pr', tier: 'B', needsPortal: true } });
    expect(seen).toEqual(['Bearer viewer-secret']); // viewer key preferred
    expect(JSON.stringify(r)).not.toContain('viewer-secret');
  }, 30_000);

  it('D3 falls back to DEVAUDIT_API_KEY when no viewer key is set', async () => {
    process.env['DEVAUDIT_API_KEY'] = 'api-secret';
    const seen: string[] = [];
    server.use(releases({ 'REQ-030': 'uat_approved' }, seen));
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-030', { pr: 'https://github.com/o/r/pull/42' });
    const { checkClosedReleasePr, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
    const r = await checkClosedReleasePr(await buildDeferralContext(dir, cfg, ghPr('CLOSED')));
    expect(r.ok).toBe(false);
    expect(seen).toEqual(['Bearer api-secret']);
  }, 30_000);

  it('D3 negatives: merged PR, declared intent, portal released, PR still open', async () => {
    process.env['DEVAUDIT_VIEWER_API_KEY'] = 'k';
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-030', { pr: '#42' });
    const { checkClosedReleasePr, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
    server.use(releases({ 'REQ-030': 'draft' }));
    expect((await checkClosedReleasePr(await buildDeferralContext(dir, cfg, ghPr('MERGED', '2026-01-01')))).ok).toBe(true);
    expect((await checkClosedReleasePr(await buildDeferralContext(dir, cfg, ghPr('OPEN')))).ok).toBe(true);
    server.use(releases({ 'REQ-030': 'released' }));
    expect((await checkClosedReleasePr(await buildDeferralContext(dir, cfg, ghPr('CLOSED')))).ok).toBe(true);
    await writeTicket(dir, 'REQ-030', { pr: '#42', intent: 'deferred-to-next — x' });
    server.use(releases({ 'REQ-030': 'draft' }));
    expect((await checkClosedReleasePr(await buildDeferralContext(dir, cfg, ghPr('CLOSED')))).ok).toBe(true);
  }, 30_000);

  it('D3 skips (never throws) without gh, without a key, and when the portal is down', async () => {
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-030', { pr: '#42' });
    const { checkClosedReleasePr, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
    const noGh = await checkClosedReleasePr(await buildDeferralContext(dir, cfg, async () => null));
    expect(noGh).toMatchObject({ ok: true });
    expect(noGh.detail).toMatch(/^skipped/);
    const ghFails = await checkClosedReleasePr(await buildDeferralContext(dir, cfg, async () => ({ exitCode: 1, stdout: '' })));
    expect(ghFails.detail).toMatch(/^skipped/);
    // gh works, closed PR, but no key: informational, not a finding
    const noKey = await checkClosedReleasePr(await buildDeferralContext(dir, cfg, ghPr('CLOSED')));
    expect(noKey.ok).toBe(true);
    expect(noKey.detail).toContain('portal state not checked');
    // key present but the portal errors
    process.env['DEVAUDIT_VIEWER_API_KEY'] = 'k';
    server.use(http.get(`${BASE}/api/ci/releases/resolve`, () => HttpResponse.error()));
    const down = await checkClosedReleasePr(await buildDeferralContext(dir, cfg, ghPr('CLOSED')));
    expect(down.ok).toBe(true);
    expect(down.detail).toContain('network error');
  }, 30_000);

  it('D3 reads the viewer key from .env', async () => {
    const seen: string[] = [];
    server.use(releases({ 'REQ-030': 'draft' }, seen));
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-030', { pr: '#42' });
    await fsp.writeFile(join(dir, '.env'), '# c\nDEVAUDIT_VIEWER_API_KEY="from-dotenv"\n');
    const { checkClosedReleasePr, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
    const r = await checkClosedReleasePr(await buildDeferralContext(dir, cfg, ghPr('CLOSED')));
    expect(r.ok).toBe(false);
    expect(seen).toEqual(['Bearer from-dotenv']);
  }, 30_000);

  async function bundleFixture(coreDir: 'pending-releases' | 'approved-releases'): Promise<string> {
    const dir = await fixtureRepo(cfg);
    await writeTicket(dir, 'REQ-040', {}, coreDir);
    await writeTicket(dir, 'REQ-041', {});
    await fsp.mkdir(join(dir, 'compliance', 'pending-releases'), { recursive: true });
    await fsp.writeFile(
      join(dir, 'compliance', 'pending-releases', 'BUNDLED-CHANGES-REQ-040.json'),
      JSON.stringify({ members: [{ version: 'REQ-041', role: 'co_tracked' }] }),
    );
    return dir;
  }

  it('D7 positive: member still pending after the core ticket was archived', async () => {
    const dir = await bundleFixture('approved-releases');
    const { checkBundleMembers, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
    const r = await checkBundleMembers(await buildDeferralContext(dir, cfg));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('REQ-041');
    expect(r.detail).toContain('approved-releases/');
    expect(r.findings?.every((f) => f.remediation === undefined)).toBe(true); // report only
  }, 30_000);

  it('D7 positive: member still pending after the core was released on the portal', async () => {
    process.env['DEVAUDIT_VIEWER_API_KEY'] = 'k';
    server.use(releases({ 'REQ-040': 'released' }));
    const dir = await bundleFixture('pending-releases');
    const { checkBundleMembers, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
    const r = await checkBundleMembers(await buildDeferralContext(dir, cfg));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('released on the portal');
  }, 30_000);

  it('D7 positive: orphan portal draft for a declared member', async () => {
    process.env['DEVAUDIT_VIEWER_API_KEY'] = 'k';
    server.use(releases({ 'REQ-040': 'draft', 'REQ-041': 'draft' }));
    const dir = await bundleFixture('pending-releases');
    const { checkBundleMembers, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
    const r = await checkBundleMembers(await buildDeferralContext(dir, cfg));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('orphan portal draft');
  }, 30_000);

  it('D7 negatives: healthy bundle, no manifests, and no portal key (graceful)', async () => {
    process.env['DEVAUDIT_VIEWER_API_KEY'] = 'k';
    server.use(releases({ 'REQ-040': 'draft' })); // member has no portal release of its own
    const dir = await bundleFixture('pending-releases');
    const { checkBundleMembers, buildDeferralContext } = await import('../src/commands/doctor-deferral.js');
    expect((await checkBundleMembers(await buildDeferralContext(dir, cfg))).ok).toBe(true);
    delete process.env['DEVAUDIT_VIEWER_API_KEY'];
    const noKey = await checkBundleMembers(await buildDeferralContext(dir, cfg));
    expect(noKey.ok).toBe(true);
    expect(noKey.detail).toContain('portal not checked');
    const plain = await fixtureRepo(cfg);
    await writeTicket(plain, 'REQ-050', {});
    expect((await checkBundleMembers(await buildDeferralContext(plain, cfg))).detail).toBe('no declared bundles');
  }, 30_000);
});

describe('devaudit doctor — D8 releases check + JSON surface (#956)', () => {
  let srv: Server;
  let baseUrl = '';
  const seenAuth: string[] = [];
  beforeAll(async () => {
    srv = createServer((req, res) => {
      seenAuth.push(req.headers['authorization'] ?? '');
      const u = new URL(req.url ?? '/', 'http://x');
      const prefix = u.searchParams.get('versionPrefix');
      if (prefix === 'REQ-060') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ latest: { status: 'released' } }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const addr = srv.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));

  it('finds pending-releases/ from a subdirectory (repo-root relative) and keeps existing JSON keys', async () => {
    const dir = await fixtureRepo({ project_slug: 'fixture', devaudit: { project_slug: 'fixture', base_url: '' } });
    await fsp.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({ project_slug: 'fixture', devaudit: { project_slug: 'fixture', base_url: baseUrl } }),
    );
    await writeTicket(dir, 'REQ-060', {});
    await writeTicket(dir, 'REQ-061', {});
    const sub = join(dir, 'src', 'deep');
    await fsp.mkdir(sub, { recursive: true });
    seenAuth.length = 0;
    const { json, raw } = await doctorJson(sub, cleanEnv({ DEVAUDIT_VIEWER_API_KEY: 'viewer-xyz', DEVAUDIT_API_KEY: 'api-xyz' }));
    // regression: previously "no pending-releases/" from any cwd but the root
    expect(json.releaseCloseoutDrift.name).toBe('releases');
    expect(json.releaseCloseoutDrift.ok).toBe(false);
    expect(json.releaseCloseoutDrift.detail).toContain('REQ-060');
    expect(json.releaseCloseoutDrift.detail).not.toContain('REQ-061');
    expect(seenAuth.length).toBeGreaterThan(0);
    expect(new Set(seenAuth)).toEqual(new Set(['Bearer viewer-xyz']));
    expect(raw).not.toContain('viewer-xyz');
    expect(raw).not.toContain('api-xyz');
    // existing keys unchanged
    expect(Object.keys(json)).toEqual(expect.arrayContaining(['ok', 'tools', 'releaseCloseoutDrift', 'onboarding']));
    expect(Object.keys(json.releaseCloseoutDrift).sort()).toEqual(['detail', 'name', 'ok']);
    expect(json.tools).toHaveLength(5);
    expect(json.onboarding).toHaveLength(9);
    // additive keys
    expect(Array.isArray(json.deferral)).toBe(true);
    expect(json.proposals).toContainEqual(
      expect.objectContaining({
        check: 'releases',
        subject: 'REQ-060',
        remediation: expect.objectContaining({ id: 'close-out-release', tier: 'A', needsPortal: false, plan: ['./scripts/close-out-release.sh REQ-060'] }),
      }),
    );
  }, 30_000);

  it('D8 negative: portal release not released -> clean, no proposal', async () => {
    const dir = await fixtureRepo({ project_slug: 'fixture', devaudit: { project_slug: 'fixture', base_url: baseUrl } });
    await writeTicket(dir, 'REQ-061', {});
    const { json } = await doctorJson(dir, cleanEnv({ DEVAUDIT_API_KEY: 'k' }));
    expect(json.releaseCloseoutDrift.ok).toBe(true);
    expect(json.releaseCloseoutDrift.detail).toContain('none released on the portal');
    expect(json.proposals.filter((p) => p.check === 'releases')).toEqual([]);
  }, 30_000);

  it('D8 skips with a note when no portal key is available', async () => {
    const dir = await fixtureRepo({ project_slug: 'fixture', devaudit: { project_slug: 'fixture', base_url: baseUrl } });
    await writeTicket(dir, 'REQ-060', {});
    const { json } = await doctorJson(dir);
    expect(json.releaseCloseoutDrift.ok).toBe(true);
    expect(json.releaseCloseoutDrift.detail).toContain('portal drift check skipped');
  }, 30_000);
});
