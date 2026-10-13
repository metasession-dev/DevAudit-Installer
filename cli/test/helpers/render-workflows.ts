import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncProject } from '../../src/update/index.js';

/**
 * Renders every generated workflow for a fixture consumer (node or python) by
 * running the real sync into a scratch directory. Shared by the workflow
 * syntax test (#987) and the behavioural gate test (#941). The caller sets
 * DEVAUDIT_INSTALLER_ROOT.
 */
export async function renderAll(stack: 'node' | 'python'): Promise<Record<string, string>> {
  const dir = await fs.mkdtemp(join(tmpdir(), `cli-runsyntax-${stack}-`));
  try {
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-app',
        stack,
        host: 'railway',
        node_version: '20',
        runner: 'self-hosted',
        working_directory: '.',
        source_dirs: 'app/ lib/',
        sast_baseline: 0,
        accepted_dep_risks: '',
        production_url_secret: 'FIXTURE_PROD_URL',
        database_service: 'postgres',
        database_image: 'postgres:16',
        database_port: '5432:5432',
        database_env: { POSTGRES_PASSWORD: 'postgres' },
        e2e_project: 'chromium',
        e2e_start_command: 'npm run dev',
        e2e_regression_enabled: true,
        paths_ignore: ['SDLC/**', 'compliance/**'],
      }),
    );
    if (stack === 'node') {
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
    } else {
      await fs.writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "fixture-app"\nversion = "0.0.0"\n');
    }
    await fs.mkdir(join(dir, 'scripts'), { recursive: true });
    await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
    await syncProject(dir);
    const wfDir = join(dir, '.github', 'workflows');
    const out: Record<string, string> = {};
    for (const f of (await fs.readdir(wfDir)).filter((n) => /\.ya?ml$/.test(n)).sort()) {
      out[f] = (await fs.readFile(join(wfDir, f), 'utf8')).replace(/\r\n/g, '\n');
    }
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
