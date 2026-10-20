import { describe, it, expect, beforeAll } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { renderAll } from './helpers/render-workflows.js';
import { findConfigKey } from '../src/lib/repo-config-keys.js';

// devaudit-installer#1060 Phase A — test tier keys and scripts/run-test-tier.sh.
// A config that sets none of the keys must render exactly the inline Playwright
// commands it always did; setting a key switches only the matching step.

const HERE = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = resolve(HERE, '..', '..');
});

const SCRIPT = 'bash "$GITHUB_WORKSPACE/scripts/run-test-tier.sh"';

describe('test tiers: workflows with no tier key are unchanged', { timeout: 120_000 }, () => {
  it('keeps the inline Playwright commands and never references the tier script', async () => {
    const wf = await renderAll('node');
    expect(wf['ci.yml']).toContain('run: npx playwright test --project=chromium --reporter=json,html');
    expect(wf['feature-e2e.yml']).toContain('npx playwright test --grep "$REQ_ID" --reporter=json,html');
    expect(wf['e2e-regression.yml']).toContain(
      '40m npx playwright test --project="$PROJECT" --reporter=json,html\n            STATUS=$?',
    );
    for (const [name, content] of Object.entries(wf)) {
      expect(content, name).not.toContain('run-test-tier.sh');
      expect(content, name).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });

  it('renders the python stack without the tier script as well', async () => {
    const wf = await renderAll('python');
    for (const [name, content] of Object.entries(wf)) expect(content, name).not.toContain('run-test-tier.sh');
  });

  it('feature-e2e.yml triggers on the integration branch (develop by default)', async () => {
    expect((await renderAll('node'))['feature-e2e.yml']).toContain('pull_request:\n    branches: [develop]');
    const custom = await renderAll('node', { integration_branch: 'next' });
    expect(custom['feature-e2e.yml']).toContain('pull_request:\n    branches: [next]');
    expect(custom['feature-e2e.yml']).toContain("github.base_ref || 'next'");
    expect(custom['feature-e2e.yml']).not.toContain('develop');
  });
});

describe('test tiers: a key switches the matching step to the script', { timeout: 120_000 }, () => {
  it('test_tier_smoke drives the blocking smoke gate in ci.yml only', async () => {
    const wf = await renderAll('node', { test_tier_smoke: 'make smoke' });
    expect(wf['ci.yml']).toContain(`run: ${SCRIPT} smoke`);
    expect(wf['ci.yml']).not.toContain('run: npx playwright test --project=chromium');
    expect(wf['feature-e2e.yml']).toContain('npx playwright test --grep "$REQ_ID"');
    expect(wf['e2e-regression.yml']).toContain('40m npx playwright test --project="$PROJECT"');
  });

  it('test_feature_command drives the in-scope step', async () => {
    const wf = await renderAll('node', { test_feature_command: 'jest -t {REQ}' });
    expect(wf['feature-e2e.yml']).toContain(`${SCRIPT} feature "$REQ_ID"`);
    expect(wf['feature-e2e.yml']).not.toContain('npx playwright test --grep');
    expect(wf['ci.yml']).toContain('run: npx playwright test --project=chromium');
  });

  it('test_tier_full or test_tier_critical replace only the unscoped regression command', async () => {
    for (const key of ['test_tier_full', 'test_tier_critical']) {
      const wf = await renderAll('node', { [key]: 'make tier' });
      const reg = wf['e2e-regression.yml']!;
      expect(reg, key).toContain(`40m ${SCRIPT} "$([ "$PROJECT" = regression ] && echo full || echo critical)"`);
      // scoped dispatch, the hook script and the timeout handling stay as they were
      expect(reg, key).toContain('40m npx playwright test --project="$PROJECT" --reporter=json,html $SPECS');
      expect(reg, key).toContain('bash e2e/ci-reliability/regression-run.sh');
      expect(reg, key).toContain('if [ "$STATUS" -eq 124 ]');
    }
  });

  it('test_tier_smoke alone does not touch e2e-regression.yml', async () => {
    const base = (await renderAll('node'))['e2e-regression.yml'];
    expect((await renderAll('node', { test_tier_smoke: 'make smoke' }))['e2e-regression.yml']).toBe(base);
  });

  it('blank values count as unset', async () => {
    const base = await renderAll('node');
    const blank = await renderAll('node', { test_tier_smoke: '  ', test_tier_full: '', test_feature_command: '' });
    expect(blank).toEqual(base);
  });

  it('the workflows with every key set are still valid YAML', async () => {
    const wf = await renderAll('node', {
      test_tier_smoke: 'make smoke',
      test_tier_critical: 'make critical',
      test_tier_full: 'make full',
      test_feature_command: 'make feature REQ={REQ}',
    });
    for (const name of ['ci.yml', 'feature-e2e.yml', 'e2e-regression.yml']) {
      expect(() => yamlLoad(wf[name]!), name).not.toThrow();
    }
  });
});

describe('test tier config keys', () => {
  const validate = (key: string, value: unknown) => findConfigKey(key)!.validate!(value);

  it('accepts a single-line command and rejects empty, multi-line and over-long ones', () => {
    for (const key of ['test_tier_smoke', 'test_tier_critical', 'test_tier_full']) {
      expect(validate(key, 'pytest -m smoke'), key).toBeNull();
      expect(validate(key, ''), key).toMatch(/empty/);
      expect(validate(key, 'a\nb'), key).toMatch(/single line/);
      expect(validate(key, 'x'.repeat(501)), key).toMatch(/500/);
      expect(validate(key, 'x'.repeat(500)), key).toBeNull();
    }
  });

  it('test_feature_command needs the {REQ} placeholder', () => {
    expect(validate('test_feature_command', 'jest -t {REQ}')).toBeNull();
    expect(validate('test_feature_command', 'jest')).toMatch(/\{REQ\}/);
  });

  it('test_runner allows playwright and pytest only, and the keys name the workflows they change', () => {
    expect(findConfigKey('test_runner')!.enum).toEqual(['playwright', 'pytest']);
    expect(findConfigKey('test_feature_command')!.affects).toEqual(['.github/workflows/feature-e2e.yml']);
    expect(findConfigKey('test_tier_full')!.affects).toContain('.github/workflows/e2e-regression.yml');
  });
});

describe('test_runner pytest selects the pytest tier workflows (#1060 Phase B)', { timeout: 180_000 }, () => {
  for (const stack of ['node', 'python'] as const) {
    it(`${stack}: feature-e2e.yml and e2e-regression.yml run pytest through the tier script`, async () => {
      const wf = await renderAll(stack, { test_runner: 'pytest', python_version: '3.12' });
      for (const name of ['feature-e2e.yml', 'e2e-regression.yml']) {
        const text = wf[name]!;
        expect(() => yamlLoad(text), name).not.toThrow();
        expect(text, name).toContain("python-version: '3.12'");
        expect(text, name).toContain('run-test-tier.sh');
        expect(text, name).not.toMatch(/playwright|setup-node|npm ci/i);
        expect(text, name).not.toMatch(/\{\{[A-Z_]+\}\}/);
      }
      expect(wf['feature-e2e.yml']).toContain(`${SCRIPT} feature "$REQ_ID"`);
      expect(wf['feature-e2e.yml']).toContain('feature-e2e-results.xml');
      expect(wf['feature-e2e.yml']).toContain('grep -rl "$REQ_ID"');
    });

    it(`${stack}: the regression workflow keeps the names compliance-evidence.yml depends on`, async () => {
      const reg = (await renderAll(stack, { test_runner: 'pytest' }))['e2e-regression.yml']!;
      expect(reg).toMatch(/^name: E2E Regression$/m);
      expect(reg).toContain('name: E2E Regression Suite');
      expect(reg).toContain('name: e2e-regression-report');
      expect(reg).toContain('e2e-regression-results*.xml');
      expect(reg).toContain('e2e-regression-metadata.json');
      expect(reg).toContain('pull_request:\n    branches: [main]');
      expect(reg).toContain('deployment_status:');
      expect(reg).toContain('tier=critical');
      expect(reg).toContain('tier=full');
    });
  }

  it('compliance-evidence.yml uploads the JUnit XML as the e2e_result only for the pytest runner', async () => {
    const pytest = (await renderAll('python', { test_runner: 'pytest' }))['compliance-evidence.yml']!;
    expect(pytest).toContain('e2e-artifacts/e2e-regression-results.xml');
    expect(pytest).toMatch(/fixture-app "\$REQ" e2e_result \\\n\s+e2e-artifacts\/e2e-regression-results\.xml/);
    for (const stack of ['node', 'python'] as const) {
      expect((await renderAll(stack))['compliance-evidence.yml'], stack).not.toContain('e2e-regression-results.xml');
    }
  });

  it('a python project without test_runner keeps the Node tier workflows; playwright is the same as absent', async () => {
    const absent = await renderAll('python');
    expect(absent['feature-e2e.yml']).toContain('setup-node');
    expect(absent['feature-e2e.yml']).not.toContain('setup-python');
    expect(await renderAll('python', { test_runner: 'playwright' })).toEqual(absent);
  });
});
