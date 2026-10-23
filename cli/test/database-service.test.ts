import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';

// devaudit-installer#963 — generated database service containers.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

interface Service {
  image?: string;
  env?: Record<string, string>;
  ports?: unknown[];
  options?: string;
}
interface Workflow {
  jobs: Record<string, { services?: Record<string, Service>; env?: Record<string, string> }>;
}

let prevRoot: string | undefined;
beforeAll(() => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT'];
  else process.env['DEVAUDIT_INSTALLER_ROOT'] = prevRoot;
});

async function render(
  stack: 'python' | 'node',
  extra: Record<string, unknown>,
): Promise<Record<string, string>> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-dbsvc-'));
  try {
    await fs.writeFile(
      join(dir, 'sdlc-config.json'),
      JSON.stringify({
        project_slug: 'fixture-db',
        stack,
        host: 'railway',
        ...(stack === 'python' ? { python_version: '3.11' } : { node_version: '20' }),
        runner: 'self-hosted',
        working_directory: '.',
        source_dirs: stack === 'python' ? 'src/ tests/' : 'app/ lib/',
        sast_baseline: 0,
        accepted_dep_risks: '',
        production_url_secret: 'FIXTURE_PROD_URL',
        database_service: '',
        database_image: '',
        database_port: '',
        e2e_project: 'chromium',
        e2e_start_command: 'npm run dev',
        paths_ignore: ['SDLC/**', 'compliance/**'],
        ...extra,
      }),
    );
    await fs.writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture-db',
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
    const out: Record<string, string> = {};
    for (const f of await fs.readdir(join(dir, '.github', 'workflows'))) {
      out[f] = await fs.readFile(join(dir, '.github', 'workflows', f), 'utf8');
    }
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function servicesOf(yaml: string): Record<string, Service> {
  const doc = yamlLoad(yaml) as Workflow;
  const merged: Record<string, Service> = {};
  for (const job of Object.values(doc.jobs ?? {})) Object.assign(merged, job.services ?? {});
  return merged;
}

// The exact config from the issue.
const ISSUE_CONFIG = {
  database_service: 'postgres',
  database_image: 'pgvector/pgvector:pg16',
  database_port: '5434',
  database_env: {
    POSTGRES_DB: 'meta_agent',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'postgres',
  },
};

describe('database service container generation (#963)', { timeout: 120_000 }, () => {
  it("renders the issue's postgres config as a bootable service (python ci.yml)", async () => {
    const files = await render('python', ISSUE_CONFIG);
    const svc = servicesOf(files['ci.yml']!)['postgres']!;
    expect(svc.image).toBe('pgvector/pgvector:pg16');
    // 1. env lives inside the service container
    expect(svc.env).toEqual(ISSUE_CONFIG.database_env);
    // 2. host:container mapping, container side from the image default
    expect(svc.ports).toEqual(['5434:5432']);
    // 3. healthcheck
    expect(svc.options).toContain('--health-cmd pg_isready');
    expect(svc.options).toContain('--health-retries 5');
  });

  it('applies to every template that carries a services block', async () => {
    const files = await render('node', { ...ISSUE_CONFIG, e2e_regression_enabled: true });
    for (const f of ['ci.yml', 'feature-e2e.yml', 'e2e-regression.yml']) {
      const svc = servicesOf(files[f]!)['postgres']!;
      expect(svc, f).toBeDefined();
      expect(svc.env?.['POSTGRES_PASSWORD'], f).toBe('postgres');
      expect(svc.ports, f).toEqual(['5434:5432']);
      expect(svc.options, f).toContain('pg_isready');
    }
  });

  it('passes an explicit host:container mapping through unchanged', async () => {
    const files = await render('python', { ...ISSUE_CONFIG, database_port: '5434:5433' });
    expect(servicesOf(files['ci.yml']!)['postgres']!.ports).toEqual(['5434:5433']);
  });

  it('keeps job-level database_env for steps', async () => {
    const files = await render('python', ISSUE_CONFIG);
    expect(files['ci.yml']).toMatch(/^ {6}POSTGRES_PASSWORD: postgres$/m);
  });

  it('leaves mongodb output untouched (no service env/options, port as configured)', async () => {
    const files = await render('node', {
      database_service: 'mongodb',
      database_image: 'mongo:7',
      database_port: '27017',
      database_env: { MONGODB_URI: 'mongodb://localhost:27017' },
    });
    const svc = servicesOf(files['ci.yml']!)['mongodb']!;
    expect(svc.env).toBeUndefined();
    expect(svc.options).toBeUndefined();
    expect(svc.ports).toEqual([27017]);
  });

  // devaudit-installer#1054 — a postgres URL pointing at localhost gets the mapped host port.
  describe('postgres dynamic host port (#1054)', () => {
    const withUrl = (url: string) => ({
      ...ISSUE_CONFIG,
      database_env: { ...ISSUE_CONFIG.database_env, DATABASE_URL: url },
    });

    it('renders a bare container port and exports the mapped port when a localhost *_URL key exists', async () => {
      const files = await render('python', withUrl('postgresql://postgres:postgres@localhost:5434/meta_agent'));
      expect(servicesOf(files['ci.yml']!)['postgres']!.ports).toEqual([5432]);
      expect(files['ci.yml']).toContain("DB_PORT=\"${{ job.services.postgres.ports['5432'] }}\"");
      expect(files['ci.yml']).toContain(
        'echo "DATABASE_URL=postgresql://postgres:postgres@localhost:${DB_PORT}/meta_agent" >> "$GITHUB_ENV"',
      );
    });

    it('detects 127.0.0.1 and a URL without credentials', async () => {
      const files = await render('python', withUrl('postgres://127.0.0.1:5434/meta_agent'));
      expect(servicesOf(files['ci.yml']!)['postgres']!.ports).toEqual([5432]);
      expect(files['ci.yml']).toContain('echo "DATABASE_URL=postgres://localhost:${DB_PORT}/meta_agent" >> "$GITHUB_ENV"');
    });

    it('drops the fixed-port URL from step-level e2e_env / build_env so the mapped one applies', async () => {
      const url = 'postgresql://postgres:postgres@localhost:5434/meta_agent';
      const files = await render('node', {
        ...ISSUE_CONFIG,
        e2e_project: 'chromium',
        e2e_start_command: 'npm run dev',
        e2e_env: { DATABASE_URL: url, E2E_FLAG: '1' },
        build_env: { DATABASE_URL: url },
      });
      for (const name of ['ci.yml', 'feature-e2e.yml']) {
        const body = files[name]!;
        expect(body).toContain('echo "DATABASE_URL=postgresql://postgres:postgres@localhost:${DB_PORT}/meta_agent" >> "$GITHUB_ENV"');
        // the only remaining copy of the fixed-port URL is job-level (6 spaces), which $GITHUB_ENV overrides
        expect(body).not.toMatch(/^ {10}DATABASE_URL: postgresql:\/\/postgres:postgres@localhost:5434/m);
        expect(body).toMatch(/^ {10}E2E_FLAG: 1$/m);
      }
    });

    it('keeps <port>:5432 and emits no URI step when no localhost URL key exists', async () => {
      const files = await render('python', ISSUE_CONFIG);
      expect(servicesOf(files['ci.yml']!)['postgres']!.ports).toEqual(['5434:5432']);
      expect(files['ci.yml']).not.toContain('Set database URI from dynamic port');
    });

    it('keeps the fixed port for a URL that is not local or comes from a secret', async () => {
      const files = await render('python', withUrl('${{ secrets.DATABASE_URL }}'));
      expect(servicesOf(files['ci.yml']!)['postgres']!.ports).toEqual(['5434:5432']);
    });

    it('adds the URI step and the kill/cleanup steps to e2e-regression (node, MongoDB)', async () => {
      const files = await render('node', {
        database_service: 'mongodb',
        database_image: 'mongo:7',
        database_port: '27017',
        database_env: { MONGODB_URI: 'mongodb://localhost:27017' },
        e2e_regression_enabled: true,
      });
      const wf = files['e2e-regression.yml']!;
      expect(wf).toContain('Set database URI from dynamic port');
      expect(wf).toContain('name: Kill stale dev server');
      expect(wf.indexOf('Set database URI from dynamic port')).toBeLessThan(wf.indexOf('name: Kill stale dev server'));
      expect(wf.indexOf('name: Kill stale dev server')).toBeLessThan(wf.indexOf('name: Start dev server'));
      for (const f of ['ci.yml', 'feature-e2e.yml', 'e2e-regression.yml']) {
        expect(files[f], f).toContain('Clean stale build and test output (self-hosted only)');
        expect(files[f], f).toMatch(/run: rm -rf \.next test-results playwright-report .*\.e2e-server\.pid/);
      }
    });
  });

  it('emits no services block and no residual tokens when no database is configured', async () => {
    const files = await render('node', {});
    for (const [name, content] of Object.entries(files)) {
      expect(content, name).not.toMatch(/\{\{DATABASE_[A-Z_]+\}\}/);
    }
    expect(files['ci.yml']).not.toMatch(/^ {4}services:/m);
  });
});
