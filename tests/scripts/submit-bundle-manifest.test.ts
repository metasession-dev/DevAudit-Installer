/**
 * devaudit-installer#622 — submit-bundle-manifest.sh must accept
 * schemaVersion 2 manifests (the portal's own contract,
 * lib/api/release-lineage-contract.ts, already accepts 1 or 2;
 * generate-bundled-changes.sh has produced schemaVersion 2 for a while).
 * The pre-fix script only accepted "1" and would hard-fail every
 * non-empty schemaVersion-2 manifest before it ever reached the network.
 *
 * These tests exploit the script's own empty-manifest short-circuit
 * (members + nonReleaseWorkItems both empty exits 0 immediately after
 * the schema check, before any network call) to verify schema
 * acceptance/rejection without needing to mock the portal API.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'sdlc/files/_common/scripts/submit-bundle-manifest.sh');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(schemaVersion: number | string): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'submit-bundle-manifest-'));
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({ schemaVersion, members: [], nonReleaseWorkItems: [] }),
  );
  try {
    const stdout = execFileSync('bash', [SCRIPT, 'demo-project', 'v2026.08.02', manifestPath], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        DEVAUDIT_BASE_URL: 'https://devaudit.example.test',
        DEVAUDIT_API_KEY: 'test-key',
      },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('submit-bundle-manifest.sh — schemaVersion acceptance (devaudit-installer#622)', () => {
  it('accepts schemaVersion 1 (empty manifest short-circuits before any network call)', () => {
    const result = run(1);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no members or non-release work items');
  });

  it('accepts schemaVersion 2 — previously hard-rejected, matching the portal contract which allows 1 or 2', () => {
    const result = run(2);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no members or non-release work items');
  });

  it('still rejects an unknown schemaVersion', () => {
    const result = run(3);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('schemaVersion must be 1 or 2');
  });
});
