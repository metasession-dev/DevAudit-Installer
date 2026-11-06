import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { renderAll } from './helpers/render-workflows.js';

// devaudit-installer#1029 — GitHub runs `run:` blocks under `bash -e`, so
// `cmd; STATUS=$?` aborts on a failure and the metadata stays at "running".
// Runs the real step on every branch of both runners, with a fake test command.

const ROOT = resolve(import.meta.dirname, '../..');

type Workflow = { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> };

function testStep(yaml: string): string {
  const steps = (yamlLoad(yaml) as Workflow).jobs['e2e-regression']!.steps;
  const run = steps.find((s) => s.name === 'E2E Regression Tests')?.run;
  expect(run).toBeTruthy();
  return run!;
}

function runStep(script: string, exitCode: number, env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'cli-e2e-exit-'));
  try {
    const fake = `#!/usr/bin/env bash\nexit ${exitCode}\n`;
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'scripts'));
    for (const path of ['bin/npx', 'bin/pytest', 'scripts/run-test-tier.sh']) {
      writeFileSync(join(dir, path), fake);
      chmodSync(join(dir, path), 0o755);
    }
    writeFileSync(join(dir, 'e2e-regression-metadata.json'), '{"outcome":"running"}');
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, ...env, GITHUB_WORKSPACE: dir, PATH: `${join(dir, 'bin')}:${process.env['PATH']}` },
    });
    return { status: result.status, metadata: JSON.parse(readFileSync(join(dir, 'e2e-regression-metadata.json'), 'utf8')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Skipped on Windows: the fake commands rely on the executable bit and a POSIX PATH; the workflow runs on Linux.
describe.skipIf(process.platform === 'win32')('e2e-regression.yml test step records the outcome under -e (#1029)', { timeout: 120_000 }, () => {
  let playwright: string;
  let pytest: string;

  beforeAll(async () => {
    process.env['DEVAUDIT_INSTALLER_ROOT'] = ROOT;
    playwright = testStep((await renderAll('node', { e2e_regression_enabled: true }))['e2e-regression.yml']!);
    pytest = testStep((await renderAll('python', { e2e_regression_enabled: true, test_runner: 'pytest' }))['e2e-regression.yml']!);
    expect(pytest).toContain('run-test-tier.sh');
  }, 120_000);

  const branches: Array<{ name: string; step: () => string; env: Record<string, string> }> = [
    { name: 'Playwright, unscoped', step: () => playwright, env: { PROJECT: 'regression', SPECS: '', E2E_PORT: '3000' } },
    { name: 'Playwright, scoped', step: () => playwright, env: { PROJECT: 'regression', SPECS: 'e2e/a.spec.ts', E2E_PORT: '3000' } },
    { name: 'pytest, tier', step: () => pytest, env: { TIER: 'full', SPECS: '', TEST_JUNIT_XML: 'r.xml' } },
    { name: 'pytest, scoped', step: () => pytest, env: { TIER: 'full', SPECS: 'tests/test_a.py', TEST_JUNIT_XML: 'r.xml' } },
  ];
  const outcomes = [
    { code: 1, outcome: 'failed' },
    { code: 124, outcome: 'timed_out' },
    { code: 0, outcome: 'passed' },
  ];

  for (const branch of branches) {
    for (const { code, outcome } of outcomes) {
      it(`${branch.name}: exit ${code} is recorded as ${outcome}`, () => {
        const r = runStep(branch.step(), code, branch.env);
        expect(r.status).toBe(code);
        expect(r.metadata.outcome).toBe(outcome);
        expect(r.metadata.exit_code).toBe(code);
        expect(r.metadata.completed_at).toBeTruthy();
      });
    }
  }
});

describe('no copy of the regression step keeps the aborting capture (#1029)', () => {
  const files = [
    'sdlc/files/ci/e2e-regression.yml.template',
    'sdlc/files/ci/runners/pytest/e2e-regression.yml.template',
    'sdlc/files/_common/skills/e2e-test-engineer/references/e2e-regression-3-tier.yml',
  ];

  for (const file of files) {
    it(file, () => {
      const text = readFileSync(resolve(ROOT, file), 'utf8');
      expect(text).toContain('|| STATUS=$?');
      expect(text).not.toMatch(/^\s*STATUS=\$\?\s*$/m);
    });
  }
});
