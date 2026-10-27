import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { resolveHost, DEFAULT_HOST } from '../src/install/hosts.js';
import { collectPlan } from '../src/install/prompts.js';
import type { DetectedStack, InstallContext } from '../src/install/types.js';

// devaudit-installer#1022 — `install` used to hardcode host: 'railway', so a Vercel
// consumer hand-edited sdlc-config.json and a re-run of `install` reset it.

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER_ROOT = resolve(HERE, '..', '..');
const BIN = resolve(HERE, '..', 'bin', 'devaudit.js');

const detected: DetectedStack = { stack: 'node', workingDirectory: '.' };

async function ctxFor(config: Record<string, unknown> | null, extra: Partial<InstallContext> = {}): Promise<InstallContext> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-install-host-'));
  if (config) await fs.writeFile(join(dir, 'sdlc-config.json'), JSON.stringify(config));
  return {
    projectPath: dir,
    repoRoot: dir,
    projectName: 'fixture-app',
    installerRoot: INSTALLER_ROOT,
    token: 't',
    baseUrl: 'https://devaudit.example.test',
    dryRun: false,
    nonInteractive: true,
    installMode: 'operator',
    addTarget: false,
    issueViewerKey: false, printViewerKey: false,
    ...extra,
  };
}

describe('resolveHost (#1022)', () => {
  it('defaults to railway when nothing says otherwise', async () => {
    await expect(resolveHost({ installerRoot: INSTALLER_ROOT })).resolves.toBe(DEFAULT_HOST);
    expect(DEFAULT_HOST).toBe('railway');
  });

  it('keeps the host already in sdlc-config.json', async () => {
    await expect(resolveHost({ installerRoot: INSTALLER_ROOT, existing: 'vercel' })).resolves.toBe('vercel');
  });

  it('an explicit --host wins over the existing one', async () => {
    await expect(resolveHost({ installerRoot: INSTALLER_ROOT, requested: 'railway', existing: 'vercel' })).resolves.toBe('railway');
  });

  it('rejects an unknown host and lists the valid ones', async () => {
    await expect(resolveHost({ installerRoot: INSTALLER_ROOT, requested: 'netlify' })).rejects.toThrow(
      /Unknown host "netlify" \(--host\)\. Available hosts: .*railway.*vercel/,
    );
    await expect(resolveHost({ installerRoot: INSTALLER_ROOT, existing: 'nope' })).rejects.toThrow(/sdlc-config\.json "host"/);
  });
});

describe('collectPlan host handling (#1022)', () => {
  it('a re-run of install preserves host: vercel instead of resetting it to railway', async () => {
    const ctx = await ctxFor({ project_slug: 'fixture-app', stack: 'node', host: 'vercel' });
    const plan = await collectPlan(ctx, detected);
    expect(plan.host).toBe('vercel');
  });

  it('--host sets the host for a fresh config', async () => {
    const ctx = await ctxFor({ project_slug: 'fixture-app', stack: 'node' }, { host: 'vercel' });
    expect((await collectPlan(ctx, detected)).host).toBe('vercel');
  });

  it('defaults to railway for an existing config with no host', async () => {
    const ctx = await ctxFor({ project_slug: 'fixture-app', stack: 'node' });
    expect((await collectPlan(ctx, detected)).host).toBe('railway');
  });

  it('fails with a helpful message for an unknown --host', async () => {
    const ctx = await ctxFor({ project_slug: 'fixture-app', stack: 'node' }, { host: 'netlify' });
    await expect(collectPlan(ctx, detected)).rejects.toThrow(/Unknown host "netlify"/);
  });
});

describe('devaudit install --host (#1022)', () => {
  it('is documented in --help', async () => {
    const r = await execa('node', [BIN, 'install', '--help'], { reject: false });
    expect(r.stdout).toContain('--host <name>');
    expect(r.stdout).toContain('vercel');
  }, 30_000);
});
