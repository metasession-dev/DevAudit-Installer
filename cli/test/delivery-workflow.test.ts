import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';
import { CLI_VERSION } from '../src/lib/version.js';
import {
  DELIVERY_CLAUDE_CODE_VERSION,
  DELIVERY_GIT_AUTHOR_EMAIL,
  DELIVERY_GIT_AUTHOR_NAME,
  DELIVERY_PROMPT_FILE,
  DELIVERY_PROMPT_TEMPLATE,
} from '../src/lib/delivery.js';

// DevAudit-Installer#1272, #1274 — devaudit-delivery.yml: generated only while `delivery.enabled`,
// dispatched by the portal, one run at a time, run by a headless session under the agent's own key.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

// Each case runs a whole sync; under the full parallel suite that can pass the 30 s default.
vi.setConfig({ testTimeout: 120_000 });

let prevRoot: string | undefined;
beforeAll(() => {
  prevRoot = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT'];
  else process.env['DEVAUDIT_INSTALLER_ROOT'] = prevRoot;
});

const BASE_CONFIG = {
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
  paths_ignore: ['SDLC/**', 'compliance/**'],
};

async function fixture(config: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-delivery-wf-'));
  await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ ...BASE_CONFIG, ...config }));
  await fs.writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture-app',
      private: true,
      version: '0.0.0',
      devDependencies: { husky: '*', '@commitlint/cli': '*', '@commitlint/config-conventional': '*', 'lint-staged': '*', prettier: '*', eslint: '*', typescript: '*', '@playwright/test': '*' },
    }),
  );
  await fs.mkdir(join(dir, '.husky'), { recursive: true });
  await fs.mkdir(join(dir, 'scripts'), { recursive: true });
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  return dir;
}

const workflowPath = (dir: string) => join(dir, '.github', 'workflows', 'devaudit-delivery.yml');
const read = async (path: string) => (await fs.readFile(path, 'utf8')).replace(/\r\n/g, '\n');
const exists = (path: string) => fs.access(path).then(() => true, () => false);

async function rendered(config: Record<string, unknown>): Promise<string> {
  const dir = await fixture({ delivery: { enabled: true }, ...config });
  try {
    await syncProject(dir);
    return await read(workflowPath(dir));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('devaudit-delivery.yml generation (#1272)', () => {
  it('is not generated without delivery.enabled, and the prompt file is not written', async () => {
    for (const delivery of [undefined, { enabled: false }]) {
      const dir = await fixture(delivery === undefined ? {} : { delivery });
      try {
        await syncProject(dir);
        expect(await exists(workflowPath(dir))).toBe(false);
        expect(await exists(join(dir, DELIVERY_PROMPT_FILE))).toBe(false);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('is generated with delivery.enabled, with the prompt file, and removed again when it is turned off', async () => {
    const dir = await fixture({ delivery: { enabled: true } });
    try {
      await syncProject(dir);
      expect(await exists(workflowPath(dir))).toBe(true);
      expect(await read(join(dir, DELIVERY_PROMPT_FILE))).toBe(DELIVERY_PROMPT_TEMPLATE);
      const cfg = JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf8')) as Record<string, unknown>;
      await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify({ ...cfg, delivery: { enabled: false } }));
      await syncProject(dir);
      expect(await exists(workflowPath(dir))).toBe(false);
      expect(await exists(join(dir, DELIVERY_PROMPT_FILE))).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('renders valid YAML with no template token left', async () => {
    const text = await rendered({});
    expect(() => yamlLoad(text)).not.toThrow();
    expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('is started by a repository_dispatch of type devaudit-delivery, one run at a time per repository', async () => {
    const doc = yamlLoad(await rendered({})) as Record<string, any>;
    expect(doc['on']).toEqual({ repository_dispatch: { types: ['devaudit-delivery'] } });
    expect(doc['concurrency']).toEqual({ group: 'delivery-${{ github.repository }}', 'cancel-in-progress': false });
    expect(doc['jobs']['delivery']['env']['RUN_ID']).toBe('${{ github.event.client_payload.runId }}');
    expect(doc['jobs']['delivery']['env']['ISSUE_NUMBER']).toBe('${{ github.event.client_payload.issueNumber }}');
  });

  it('takes the timeout and the turn limit from delivery.max_minutes and delivery.max_turns, with defaults', async () => {
    const defaults = await rendered({});
    expect(defaults).toContain('timeout-minutes: 90');
    expect(defaults).toContain('--max-turns 200');
    const custom = await rendered({ delivery: { enabled: true, max_minutes: 45, max_turns: 80 } });
    expect(custom).toContain('timeout-minutes: 45');
    expect(custom).toContain('--max-turns 80');
  });

  it('checks out the integration branch and pins Claude Code and the DevAudit CLI', async () => {
    const text = await rendered({ integration_branch: 'integration' });
    expect(text).toContain('ref: integration');
    expect(text).toContain(`@anthropic-ai/claude-code@${DELIVERY_CLAUDE_CODE_VERSION}`);
    expect(text).toContain(`@metasession.co/devaudit-cli@${CLI_VERSION}`);
  });

  it('sets the agent as the git author, never the client', async () => {
    const text = await rendered({});
    expect(text).toContain(`git config user.name "${DELIVERY_GIT_AUTHOR_NAME}"`);
    expect(text).toContain(`git config user.email "${DELIVERY_GIT_AUTHOR_EMAIL}"`);
  });

  it('reports running first and the end of the run in a step that always runs, with the cost file and the CI seconds', async () => {
    const doc = yamlLoad(await rendered({})) as Record<string, any>;
    const steps = doc['jobs']['delivery']['steps'] as Array<Record<string, any>>;
    const running = steps.findIndex((s) => String(s['run'] ?? '').includes('--phase running'));
    const agent = steps.findIndex((s) => s['id'] === 'agent');
    const end = steps.findIndex((s) => String(s['run'] ?? '').includes('--cost-file'));
    expect(running).toBeGreaterThan(-1);
    expect(agent).toBeGreaterThan(running);
    expect(end).toBeGreaterThan(agent);
    expect(steps[end]!['if']).toBe('always()');
    expect(steps[agent]!['continue-on-error']).toBe(true);
    expect(String(steps[end]!['run'])).toContain('--ci-seconds "$SECONDS"');
  });

  it('uses the Node setup of a Node project, and Node plus Python for a Python project', async () => {
    const node = await rendered({ node_version: '20' });
    expect(node).toContain("node-version: '20'");
    expect(node).not.toContain('setup-python');
    const py = await rendered({ stack: 'python', python_version: '3.12', node_version: undefined });
    expect(py).toContain('actions/setup-python@v6');
    expect(py).toContain("python-version: '3.12'");
    expect(py).toContain("node-version: '22'");
  });

  it('keeps every run block under the 20,000 byte limit', async () => {
    const doc = yamlLoad(await rendered({})) as Record<string, any>;
    for (const step of doc['jobs']['delivery']['steps'] as Array<Record<string, any>>) {
      if (typeof step['run'] === 'string') expect(Buffer.byteLength(step['run'])).toBeLessThan(20_000);
    }
  });

  it('resolves the runner like the other workflows', async () => {
    expect(await rendered({ runner: 'self-hosted' })).toContain("(inputs.runner_label || vars.CI_RUNNER_LABEL || 'github-ci')");
  });
});

describe('the agent identity (#1274)', () => {
  it('works under DEVAUDIT_AGENT_PORTAL_KEY, which is read by no other generated workflow', async () => {
    const text = await rendered({});
    expect(text).toContain('${{ secrets.DEVAUDIT_AGENT_PORTAL_KEY }}');
    // the scripts and `delivery report` read it as DEVAUDIT_API_KEY / DEVAUDIT_AGENT_PORTAL_KEY inside this job only
    const ciDir = join(INSTALLER_ROOT, 'sdlc', 'files', 'ci');
    const offenders: string[] = [];
    for (const entry of await fs.readdir(ciDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.template') || entry.name === 'devaudit-delivery.yml.template') continue;
      const body = await fs.readFile(join(entry.parentPath, entry.name), 'utf8');
      if (body.includes('DEVAUDIT_AGENT_PORTAL_KEY')) offenders.push(entry.name);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the gates on the project key: the template names no gate secret of the project key', async () => {
    const text = await rendered({});
    expect(text).not.toContain('secrets.DEVAUDIT_API_KEY');
  });

  it('stores the agent session key under the secret it reads', async () => {
    expect(await rendered({})).toContain('ANTHROPIC_API_KEY: ${{ secrets.DEVAUDIT_AGENT_API_KEY }}');
  });
});
