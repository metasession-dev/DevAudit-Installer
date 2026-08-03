/**
 * devaudit-installer#622 — generate-bundled-changes.sh must describe a
 * bare-date housekeeping release's own constituent commits without
 * requiring a release ticket (bare-date releases never have one by
 * design). Executes the real script against a throwaway git repo rather
 * than string-matching its source, since the bug here was a runtime
 * `exit 1` triggered only when `compliance/pending-releases` exists
 * without a matching ticket — invisible to a static content check.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(process.cwd());
const SCRIPT = join(ROOT, 'sdlc/files/_common/scripts/generate-bundled-changes.sh');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf-8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

function initRepo(dir: string): void {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email test@example.com', { cwd: dir });
  execSync('git config user.name Test', { cwd: dir });
}

function commit(dir: string, file: string, message: string): void {
  writeFileSync(join(dir, file), `${message}\n`);
  execSync(`git add ${file}`, { cwd: dir });
  execSync(`git commit -q -m ${JSON.stringify(message)}`, { cwd: dir });
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bundled-changes-'));
  initRepo(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('generate-bundled-changes.sh — bare-date releases (devaudit-installer#622)', () => {
  it('describes its own housekeeping commits without a release ticket, even when compliance/pending-releases exists for an unrelated tracked release', () => {
    // An unrelated in-flight tracked release's pending ticket — this used
    // to make the script hard-fail for a bare-date VERSION with no
    // matching ticket of its own (`compliance/pending-releases` existing
    // was enough to trigger "release ticket not found").
    mkdirSync(join(dir, 'compliance/pending-releases'), { recursive: true });
    writeFileSync(
      join(dir, 'compliance/pending-releases/RELEASE-TICKET-REQ-100.md'),
      '# Release ticket REQ-100\n',
    );
    commit(dir, 'a.txt', 'chore: unrelated pending ticket seed');

    const sinceRef = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
    commit(dir, 'b.txt', 'chore: sync DevAudit SDLC templates to 0.3.35');
    commit(dir, 'c.txt', 'chore(security): fix stale vulnerableRange in accepted-vulnerabilities.json');
    commit(dir, 'd.txt', 'chore(scripts): correctly derive DB name and authSource');

    const manifestPath = join(dir, 'manifest.json');
    const result = run([sinceRef, 'v2026.08.02', '--json-out', manifestPath], dir);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.members).toEqual([]);
    expect(manifest.nonReleaseWorkItems).toHaveLength(3);
    // git log lists newest-first
    expect(manifest.nonReleaseWorkItems.map((i: { title: string }) => i.title)).toEqual([
      'chore(scripts): correctly derive DB name and authSource',
      'chore(security): fix stale vulnerableRange in accepted-vulnerabilities.json',
      'chore: sync DevAudit SDLC templates to 0.3.35',
    ]);
    expect(manifest.manifestHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    expect(result.stdout).toContain('## Bundled Changes');
    expect(result.stdout).toContain('- **Absorbed predecessor releases:** None');
    expect(result.stdout).toContain('housekeeping commits since');
  });

  it('produces an empty, still-valid manifest when a bare-date release has nothing new to bundle', () => {
    commit(dir, 'a.txt', 'chore: seed');
    const sinceRef = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();

    const manifestPath = join(dir, 'manifest.json');
    const result = run([sinceRef, 'v2026.08.03', '--json-out', manifestPath], dir);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.members).toEqual([]);
    expect(manifest.nonReleaseWorkItems).toEqual([]);
  });

  it('still requires an explicit release ticket for a REQ-tracked version when compliance/pending-releases exists (regression check)', () => {
    mkdirSync(join(dir, 'compliance/pending-releases'), { recursive: true });
    writeFileSync(
      join(dir, 'compliance/pending-releases/RELEASE-TICKET-REQ-200.md'),
      '# Release ticket REQ-200\n',
    );
    commit(dir, 'a.txt', 'chore: seed');
    const sinceRef = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
    commit(dir, 'b.txt', 'feat: REQ-100 work');

    // REQ-100 has no release ticket on disk at all (only REQ-200 does) —
    // this is the pre-existing, still-desired failure mode for tracked
    // releases: the bare-date carve-out above must not weaken it.
    const result = run([sinceRef, 'REQ-100', '--json-out', join(dir, 'manifest.json')], dir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('release ticket for REQ-100 not found');
  });
});
