import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';

// devaudit-installer#969 — configurable fixed concurrency group for e2e-regression.yml.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

let prevRoot: string | undefined;
beforeAll(() => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT'];
  else process.env['DEVAUDIT_INSTALLER_ROOT'] = prevRoot;
});

async function renderRegression(extra: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-e2econc-'));
  try {
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-app',
        stack: 'node',
        host: 'railway',
        node_version: '20',
        runner: 'ubuntu-latest',
        working_directory: '.',
        source_dirs: 'app/ lib/',
        sast_baseline: 0,
        accepted_dep_risks: '',
        production_url_secret: 'FIXTURE_PROD_URL',
        database_service: '',
        database_image: '',
        database_port: '',
        e2e_project: 'chromium',
        e2e_start_command: 'npm run dev',
        e2e_regression_enabled: true,
        paths_ignore: ['SDLC/**', 'compliance/**'],
        ...extra,
      }),
    );
    await fs.writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture-app',
        private: true,
        version: '0.0.0',
        devDependencies: {
          husky: '*',
          '@commitlint/cli': '*',
          '@commitlint/config-conventional': '*',
          'lint-staged': '*',
          prettier: '*',
          eslint: '*',
          typescript: '*',
          '@playwright/test': '*',
        },
      }),
    );
    await fs.mkdir(join(dir, '.husky'), { recursive: true });
    await fs.mkdir(join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
    await syncProject(dir);
    // Windows checks templates out with CRLF; normalise so the \n assertions hold.
    return (await fs.readFile(join(dir, '.github', 'workflows', 'e2e-regression.yml'), 'utf8')).replace(/\r\n/g, '\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function concurrencyOf(yaml: string): { group: string; 'cancel-in-progress': unknown } {
  return (yamlLoad(yaml) as { concurrency: { group: string; 'cancel-in-progress': unknown } }).concurrency;
}

describe('e2e-regression.yml concurrency (#969)', { timeout: 120_000 }, () => {
  it('default (key unset) keeps the original block byte-for-byte', async () => {
    const yaml = await renderRegression({});
    expect(yaml).toContain(
      "concurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n\npermissions:",
    );
    expect(yaml).not.toMatch(/\{\{E2E_REGRESSION_CONCURRENCY\}\}/);
  });

  it('empty-string key is the same as unset', async () => {
    const a = await renderRegression({});
    const b = await renderRegression({ e2e_concurrency_group: '' });
    expect(b).toBe(a);
  });

  it('fixed group, cancel-in-progress false by default', async () => {
    const yaml = await renderRegression({ e2e_concurrency_group: 'uat-e2e-data' });
    expect(yaml).toContain('concurrency:\n  group: uat-e2e-data\n  cancel-in-progress: false\n');
    expect(concurrencyOf(yaml)).toEqual({ group: 'uat-e2e-data', 'cancel-in-progress': false });
  });

  it('honours e2e_concurrency_cancel_in_progress with a fixed group', async () => {
    const yaml = await renderRegression({
      e2e_concurrency_group: 'uat-e2e-data',
      e2e_concurrency_cancel_in_progress: true,
    });
    expect(concurrencyOf(yaml)).toEqual({ group: 'uat-e2e-data', 'cancel-in-progress': true });
  });

  it('ignores cancel override when no fixed group is set', async () => {
    const yaml = await renderRegression({ e2e_concurrency_cancel_in_progress: false });
    expect(yaml).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it('quotes a group that is not a plain YAML scalar', async () => {
    const yaml = await renderRegression({ e2e_concurrency_group: 'shared: ${{ github.repository }}' });
    expect(concurrencyOf(yaml).group).toBe('shared: ${{ github.repository }}');
  });

  it('is documented in sdlc-config.example.json with _comment_ entries', async () => {
    const example = JSON.parse(
      await fs.readFile(join(INSTALLER_ROOT, 'sdlc', 'files', 'sdlc-config.example.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(example['e2e_concurrency_group']).toBe('');
    expect(example['_comment_e2e_concurrency_group']).toEqual(expect.any(String));
    expect(example['e2e_concurrency_cancel_in_progress']).toBe(false);
    expect(example['_comment_e2e_concurrency_cancel_in_progress']).toEqual(expect.any(String));
  });
});
