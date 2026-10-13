import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';

// devaudit-installer#987 — every bash `run:` step of every generated workflow
// must pass `bash -n` with no warnings. An indented heredoc terminator inside a
// nested block (e.g. `  PY` after YAML strips the base indentation) never
// terminates: bash only warns ("here-document ... delimited by end-of-file"),
// so the step silently swallows the rest of its script. Found by the
// release-validation gate (docs/release-validation-plan.md).

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

interface Step {
  readonly name?: string;
  readonly run?: string;
  readonly shell?: string;
}
interface Workflow {
  readonly jobs?: Record<string, { readonly steps?: Step[]; readonly defaults?: { run?: { shell?: string } } }>;
}

async function renderAll(stack: 'node' | 'python'): Promise<Record<string, string>> {
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

function bashProblems(workflows: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, text] of Object.entries(workflows)) {
    const wf = yamlLoad(text) as Workflow;
    for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
      (job.steps ?? []).forEach((step, i) => {
        const shell = step.shell ?? job.defaults?.run?.shell ?? 'bash';
        if (!step.run || !shell.includes('bash')) return;
        // GitHub substitutes expressions before the shell sees the script.
        const script = step.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'X');
        const r = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
        if (r.status !== 0 || /warning/i.test(r.stderr)) {
          problems.push(`${file} ${jobId} step ${i} (${step.name ?? 'unnamed'}): ${r.stderr.trim().split('\n')[0]}`);
        }
      });
    }
  }
  return problems;
}

describe.skipIf(process.platform === 'win32')('generated workflow run: steps pass bash -n (#987)', () => {
  for (const stack of ['node', 'python'] as const) {
    it(`${stack}: every bash run step parses with no warnings`, async () => {
      const workflows = await renderAll(stack);
      expect(Object.keys(workflows).length).toBeGreaterThan(5);
      expect(bashProblems(workflows)).toEqual([]);
    }, 120_000);
  }
});
