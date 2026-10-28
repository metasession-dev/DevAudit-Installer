import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { syncProject } from '../src/update/index.js';

import { nodeStackPackageJson } from './helpers-node-stack.js';

// devaudit-installer#1022 part C -- the `custom` host (AWS / self-hosted / any script).
const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');

async function fixture(extra: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-custom-host-'));
  await fs.mkdir(join(dir, 'scripts'), { recursive: true });
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  // Declares the stack devDependencies, so the sync runs no `npm install` (#1089).
  await fs.writeFile(join(dir, 'package.json'), nodeStackPackageJson('fixture'));
  await fs.writeFile(
    join(dir, 'sdlc-config.json'),
    JSON.stringify({
      project_slug: 'fixture-app', stack: 'node', host: 'custom', node_version: '20', runner: 'ubuntu-latest',
      working_directory: '.', source_dirs: 'app/', sast_baseline: 0, accepted_dep_risks: '', production_url_secret: 'FIXTURE_PROD_URL',
      database_service: '', database_image: '', database_port: '', database_env: {}, e2e_project: 'chromium', e2e_start_command: 'npm run dev',
      paths_ignore: ['SDLC/**'], ...extra,
    }),
  );
  return dir;
}

async function sync(extra: Record<string, unknown>) {
  const dir = await fixture(extra);
  const prev = process.env['DEVAUDIT_INSTALLER_ROOT'];
  process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
  try {
    await syncProject(dir);
    const wfDir = join(dir, '.github', 'workflows');
    const files = await fs.readdir(wfDir);
    const deploy = files.includes('deploy-custom.yml') ? await fs.readFile(join(wfDir, 'deploy-custom.yml'), 'utf8') : '';
    return { dir, files, deploy };
  } finally {
    if (prev === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT']; else process.env['DEVAUDIT_INSTALLER_ROOT'] = prev;
  }
}

describe('custom host (#1022)', () => {
  it('generates deploy-custom.yml (and no reconcile workflow) with the command, secrets and verification from config', async () => {
    const { dir, files, deploy } = await sync({
      deploy_command: 'aws ecs update-service --cluster prod --service web --force-new-deployment\naws ecs wait services-stable --cluster prod --services web',
      deploy_secrets: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'bad name'],
      deployed_sha_url: 'https://app.example.com/version',
      deployed_sha_jq: '.version.sha',
    });
    try {
      expect(files).toContain('deploy-custom.yml');
      expect(files).not.toContain('reconcile-deployment.yml');
      const wf = yamlLoad(deploy) as { on: Record<string, unknown>; jobs: Record<string, { steps: { name?: string; run?: string; env?: Record<string, string> }[] }> };
      expect(Object.keys(wf.on)).toEqual(expect.arrayContaining(['push', 'workflow_dispatch']));
      expect((wf.on['push'] as { branches: string[] }).branches).toEqual(['main']);
      const steps = wf.jobs['deploy']!.steps;
      const run = steps.find((s) => s.name === 'Run deploy command')!;
      expect(run.run).toContain('aws ecs update-service');
      expect(run.run).toContain('aws ecs wait services-stable');
      expect(run.env).toMatchObject({ AWS_ACCESS_KEY_ID: '${{ secrets.AWS_ACCESS_KEY_ID }}', AWS_SECRET_ACCESS_KEY: '${{ secrets.AWS_SECRET_ACCESS_KEY }}' });
      expect(Object.keys(run.env ?? {})).not.toContain('bad name');
      const verify = steps.find((s) => s.name === 'Verify the new build is serving')!;
      expect(verify.run).toContain('--sha-url="https://app.example.com/version"');
      expect(verify.run).toContain('--sha-jq=".version.sha"');
      const order = steps.map((s) => s.name);
      expect(order.indexOf('Create GitHub deployment')).toBeLessThan(order.indexOf('Run deploy command'));
      expect(order.indexOf('Run deploy command')).toBeLessThan(order.indexOf('Verify the new build is serving'));
      expect(deploy).toContain('gh workflow run post-deploy-prod.yml');
      expect(deploy).toContain('-f deployed_sha="$DEPLOY_SHA"');
      expect(deploy).not.toMatch(/\{\{[A-Z_]+\}\}/);
      for (const f of ['record-custom-deployment.sh']) await expect(fs.stat(join(dir, 'scripts', f))).resolves.toBeTruthy();
      const postDeploy = await fs.readFile(join(dir, '.github', 'workflows', 'post-deploy-prod.yml'), 'utf8');
      expect(postDeploy).toContain('deployed_sha:');
      expect(postDeploy).toContain('github.event.inputs.deployed_sha');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }, 300_000);

  it('honours deploy_trigger: git_tag deploys on v* tags, manual only on dispatch', async () => {
    const tag = await sync({ deploy_command: 'make deploy', deploy_trigger: 'git_tag' });
    const manual = await sync({ deploy_command: 'make deploy', deploy_trigger: 'manual' });
    try {
      const tagWf = yamlLoad(tag.deploy) as { on: { push: { tags?: string[]; branches?: string[] } } };
      expect(tagWf.on.push.tags).toEqual(['v*']);
      expect(tagWf.on.push.branches).toBeUndefined();
      const wf = yamlLoad(manual.deploy) as { on: Record<string, unknown> };
      expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
    } finally {
      await fs.rm(tag.dir, { recursive: true, force: true });
      await fs.rm(manual.dir, { recursive: true, force: true });
    }
  }, 300_000);

  it('a missing deploy_command renders a loud failing step, and falls back to a health check', async () => {
    const { dir, deploy } = await sync({});
    try {
      expect(deploy).toContain('sdlc-config.json deploy_command is not set');
      expect(deploy).toContain('--health-url="${PROD_URL}/"');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }, 300_000);

  it('removes deploy-custom.yml when the host changes to one with no deploy workflow', async () => {
    const { dir } = await sync({ deploy_command: 'make deploy' });
    const prev = process.env['DEVAUDIT_INSTALLER_ROOT'];
    process.env['DEVAUDIT_INSTALLER_ROOT'] = INSTALLER_ROOT;
    try {
      const cfgPath = join(dir, 'sdlc-config.json');
      const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as Record<string, unknown>;
      cfg['host'] = 'vercel';
      await fs.writeFile(cfgPath, JSON.stringify(cfg));
      await syncProject(dir);
      expect(await fs.readdir(join(dir, '.github', 'workflows'))).not.toContain('deploy-custom.yml');
    } finally {
      if (prev === undefined) delete process.env['DEVAUDIT_INSTALLER_ROOT']; else process.env['DEVAUDIT_INSTALLER_ROOT'] = prev;
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it('railway and vercel get no deploy-custom.yml', async () => {
    const { dir, files } = await sync({ host: 'vercel' });
    try { expect(files).not.toContain('deploy-custom.yml'); } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }, 300_000);
});
