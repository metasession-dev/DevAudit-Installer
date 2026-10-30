import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ciValuesCheck } from '../src/commands/doctor-values.js';
import { CHECK_EXPLANATIONS, gapsFromCheck } from '../src/lib/doctor-explain.js';
import type { GhRunner } from '../src/lib/deploy-detect.js';

// DevAudit-Installer#1160 — the `ci-values` doctor check.

interface World {
  repoSecrets?: string[];
  repoVars?: string[];
  orgSecrets?: string[];
  environments?: Record<string, { secrets?: string[]; vars?: string[] }>;
  /** Everything fails, as when gh is not signed in. */
  signedOut?: boolean;
}

/** A gh that answers from a fixed world. Names only, as the real calls return. */
function ghFor(world: World): GhRunner {
  const ok = (value: unknown) => ({ exitCode: 0, stdout: JSON.stringify(value) });
  const fail = { exitCode: 1, stdout: '' };
  return async (args) => {
    if (world.signedOut) return fail;
    const a = args.join(' ');
    if (a.startsWith('secret list')) return ok((world.repoSecrets ?? []).map((name) => ({ name })));
    if (a.startsWith('variable list')) return ok((world.repoVars ?? []).map((name) => ({ name })));
    if (a.includes('organization-secrets')) return ok(world.orgSecrets ?? []);
    if (a.includes('organization-variables')) return ok([]);
    const envList = /repos\/\{owner\}\/\{repo\}\/environments(?: |$)/.exec(a);
    if (envList) return ok(Object.keys(world.environments ?? {}));
    const m = /environments\/([^/]+)\/(secrets|variables)/.exec(a);
    if (m) {
      const env = world.environments?.[decodeURIComponent(m[1]!)];
      return ok((m[2] === 'secrets' ? env?.secrets : env?.vars) ?? []);
    }
    return fail;
  };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

/** A repository folder holding the given workflow files. */
async function repoWith(workflows: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-civalues-'));
  dirs.push(dir);
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  for (const [name, text] of Object.entries(workflows)) await fs.writeFile(join(dir, '.github', 'workflows', name), text);
  return dir;
}

const consumer = (cfg: Record<string, unknown>, repoRoot: string = process.cwd()) => ({ repoRoot, cfg });
const cfg = {
  e2e_env: { SUPABASE_SECRET_KEY: '${{ secrets.SUPABASE_SECRET_KEY }}', FLAG: '${{ vars.FEATURE_FLAG }}', E2E_BACKEND: 'uat' },
  app_env: { SESSION: '${{ secrets.SESSION_PASSWORD }}' },
};

describe('ci-values', () => {
  it('has nothing to check when the configuration references no secret or variable', async () => {
    const r = await ciValuesCheck(consumer({ e2e_env: { E2E_BACKEND: 'uat' } }), { gh: ghFor({ signedOut: true }) });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('nothing to check');
  });

  it('passes when every name exists at repository level (secrets and variables), or is an organisation secret', async () => {
    const r = await ciValuesCheck(consumer(cfg), { gh: ghFor({ repoSecrets: ['SUPABASE_SECRET_KEY'], repoVars: ['FEATURE_FLAG'], orgSecrets: ['SESSION_PASSWORD'] }) });
    expect(r.ok).toBe(true);
    expect(r.findings).toBeUndefined();
  });

  it('reports a name that exists nowhere, naming the entries that read it', async () => {
    const r = await ciValuesCheck(consumer(cfg), { gh: ghFor({ repoSecrets: ['SESSION_PASSWORD'], repoVars: ['FEATURE_FLAG'] }) });
    expect(r.ok).toBe(false);
    expect(r.findings).toHaveLength(1);
    const f = r.findings![0]!;
    expect(f.subject).toBe('SUPABASE_SECRET_KEY');
    expect(f.detail).toContain('e2e_env.SUPABASE_SECRET_KEY');
    expect(f.detail).toContain('does not exist at repository or organisation level');
    expect(f.remediation).toMatchObject({ tier: 'C', needsPortal: false });
    expect(f.remediation!.plan[0]).toContain('gh secret set SUPABASE_SECRET_KEY');
  });

  it('reports a name that exists only inside an environment, and which one', async () => {
    const r = await ciValuesCheck(consumer(cfg), {
      gh: ghFor({ repoSecrets: ['SESSION_PASSWORD'], repoVars: ['FEATURE_FLAG'], environments: { 'E2E-Tests': { secrets: ['SUPABASE_SECRET_KEY'] }, 'CI/CD': {} } }),
    });
    expect(r.ok).toBe(false);
    const f = r.findings![0]!;
    expect(f.subject).toBe('SUPABASE_SECRET_KEY');
    expect(f.detail).toContain('only in the environment E2E-Tests');
    expect(f.detail).toContain('No generated workflow job sets `environment:`');
  });

  it('asks for a variable with gh variable set, and reports a name once even when two entries read it', async () => {
    const twice = { e2e_env: { A: '${{ vars.SHARED }}' }, app_env: { B: '${{ vars.SHARED }}' } };
    const r = await ciValuesCheck(consumer(twice), { gh: ghFor({}) });
    expect(r.findings).toHaveLength(1);
    expect(r.findings![0]!.detail).toContain('app_env.B, e2e_env.A');
    expect(r.findings![0]!.remediation!.plan[0]).toContain('gh variable set SHARED');
  });

  it('skips without failing when gh cannot list secrets', async () => {
    const r = await ciValuesCheck(consumer(cfg), { gh: ghFor({ signedOut: true }) });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('skipped');
  });

  it('also reads the workflow files, and reports a name only a workflow reads', async () => {
    const dir = await repoWith({ 'deploy.yml': 'env:\n  KEY: ${{ secrets.STRIPE_KEY }}\n  REGION: ${{ vars.REGION }}\n' });
    const r = await ciValuesCheck(consumer({}, dir), { gh: ghFor({ repoVars: ['REGION'] }) });
    expect(r.ok).toBe(false);
    expect(r.findings).toHaveLength(1);
    const f = r.findings![0]!;
    expect(f.subject).toBe('STRIPE_KEY');
    expect(f.detail).toContain('.github/workflows/deploy.yml');
    expect(f.remediation!.plan.join(' ')).toContain('correct the name in the workflow file');
  });

  it('merges the readers of a name used by the configuration and by a workflow', async () => {
    const dir = await repoWith({ 'ci.yml': 'env:\n  K: ${{ secrets.SUPABASE_SECRET_KEY }}\n' });
    const r = await ciValuesCheck(consumer({ e2e_env: { K: '${{ secrets.SUPABASE_SECRET_KEY }}' } }, dir), { gh: ghFor({}) });
    expect(r.findings).toHaveLength(1);
    expect(r.findings![0]!.detail).toContain('e2e_env.K, .github/workflows/ci.yml');
  });

  it('does not report names DevAudit manages, optional reads, or the built-in token', async () => {
    const dir = await repoWith({
      'a.yml': [
        'env:',
        '  A: ${{ secrets.DEVAUDIT_API_KEY }}',
        '  B: ${{ secrets.INSTALLER_DISPATCH_TOKEN || github.token }}',
        '  C: ${{ secrets.GITHUB_TOKEN }}',
        '  D: ${{ secrets.MY_PORTAL_KEY }}',
        '  E: ${{ vars.DEVAUDIT_BASE_URL }}',
      ].join('\n'),
    });
    const r = await ciValuesCheck(consumer({ api_key_secret: 'MY_PORTAL_KEY' }, dir), { gh: ghFor({}) });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('nothing to check');
  });

  it('never prints a value and has an explanation', async () => {
    const r = await ciValuesCheck(consumer(cfg), { gh: ghFor({}) });
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/ghp_|mck_|mctok_/);
    expect(CHECK_EXPLANATIONS['ci-values']?.guidance).toContain('repository level');
    expect(gapsFromCheck(r).length).toBeGreaterThan(0);
  });
});
