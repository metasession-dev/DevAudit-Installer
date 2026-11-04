import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { deleteConfigPath, getConfigPath, setConfigPath } from '../src/lib/config-path.js';
import { CONFIG_KEYS, findConfigKey, validateConfigKeyValue } from '../src/lib/repo-config-keys.js';
import { loadConfigContext, planConfigChange, runConfigureSet } from '../src/commands/configure.js';

// DevAudit-Installer#1116 WP2 — dotted configuration keys (approval.mode), the onboarding and
// approval keys, and the test-data keys of decision M7.

const HERE = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = resolve(HERE, '..', '..');
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function repo(cfg: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'cli-keys1116-'));
  dirs.push(dir);
  await execa('git', ['init', '-q'], { cwd: dir });
  await fs.writeFile(join(dir, 'sdlc-config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  return dir;
}

const readCfg = async (dir: string) => JSON.parse(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;

const BASE = { project_slug: 'example-app', stack: 'node', host: 'railway', production_url_secret: 'EXAMPLE_APP_PROD_URL', runner: 'ubuntu-latest' };

describe('config-path helpers', () => {
  const cfg = { a: 1, approval: { mode: 'dual_actor', auto_low_risk_threshold: 'LOW' }, z: 'last' };

  it('reads a top-level key and a dotted key, and returns undefined for anything missing', () => {
    expect(getConfigPath(cfg, 'a')).toBe(1);
    expect(getConfigPath(cfg, 'approval.mode')).toBe('dual_actor');
    expect(getConfigPath(cfg, 'approval')).toEqual({ mode: 'dual_actor', auto_low_risk_threshold: 'LOW' });
    expect(getConfigPath(cfg, 'approval.nope')).toBeUndefined();
    expect(getConfigPath(cfg, 'nope.mode')).toBeUndefined();
    expect(getConfigPath(cfg, 'a.b')).toBeUndefined();
    expect(getConfigPath({ x: null }, 'x.y')).toBeUndefined();
  });

  it('a dotted write keeps the siblings and the key order, and does not change the input', () => {
    const next = setConfigPath(cfg, 'approval.mode', 'solo_with_gap');
    expect(next).toEqual({ a: 1, approval: { mode: 'solo_with_gap', auto_low_risk_threshold: 'LOW' }, z: 'last' });
    expect(Object.keys(next)).toEqual(['a', 'approval', 'z']);
    expect(Object.keys(next['approval'] as object)).toEqual(['mode', 'auto_low_risk_threshold']);
    expect(cfg.approval.mode).toBe('dual_actor');
  });

  it('a write creates missing parents and replaces a parent that is not an object', () => {
    expect(setConfigPath({ a: 1 }, 'production_review.terminal_status', 'released')).toEqual({
      a: 1,
      production_review: { terminal_status: 'released' },
    });
    expect(setConfigPath({ approval: 'x' }, 'approval.mode', 'dual_actor')).toEqual({ approval: { mode: 'dual_actor' } });
    expect(setConfigPath({ a: 1 }, 'b', 2)).toEqual({ a: 1, b: 2 });
  });

  it('a delete removes the key, and a section left empty', () => {
    expect(deleteConfigPath(cfg, 'a')).toEqual({ approval: { mode: 'dual_actor', auto_low_risk_threshold: 'LOW' }, z: 'last' });
    expect(deleteConfigPath(cfg, 'approval.mode')).toEqual({ a: 1, approval: { auto_low_risk_threshold: 'LOW' }, z: 'last' });
    expect(deleteConfigPath({ approval: { mode: 'x' }, b: 1 }, 'approval.mode')).toEqual({ b: 1 });
    expect(deleteConfigPath(cfg, 'nope')).toEqual(cfg);
    expect(deleteConfigPath(cfg, 'a.b')).toEqual(cfg);
  });
});

describe('the keys added by #1116 WP2', () => {
  it('lists every new key once', () => {
    const wanted = [
      'approval.mode',
      'production_review.terminal_status',
      'release_branch_required_reviews',
      'compliance_frameworks',
      'onboarding_preset',
      'e2e_data_isolation',
      'e2e_seed_paths',
      'e2e_reset_command',
      'e2e_preflight_command',
      'e2e_leak_check_command',
      'e2e_max_skipped',
      'feature_e2e_projects',
    ];
    for (const key of wanted) expect(CONFIG_KEYS.filter((k) => k.key === key), key).toHaveLength(1);
    expect(new Set(CONFIG_KEYS.map((k) => k.key)).size).toBe(CONFIG_KEYS.length);
  });

  it('approval.mode and production_review.terminal_status accept only their values', () => {
    expect(validateConfigKeyValue('approval.mode', 'dual_actor')).toEqual({ value: 'dual_actor' });
    expect(validateConfigKeyValue('approval.mode', 'solo_with_gap')).toEqual({ value: 'solo_with_gap' });
    expect(validateConfigKeyValue('approval.mode', 'auto_low_risk').error).toMatch(/must be one of dual_actor, solo_with_gap/);
    expect(validateConfigKeyValue('production_review.terminal_status', 'released')).toEqual({ value: 'released' });
    expect(validateConfigKeyValue('production_review.terminal_status', 'prod_review')).toEqual({ value: 'prod_review' });
    expect(validateConfigKeyValue('production_review.terminal_status', 'done').error).toMatch(/must be one of prod_review, released/);
  });

  it('release_branch_required_reviews is a whole number from 0 to 2', () => {
    for (const ok of ['0', '1', '2']) expect(validateConfigKeyValue('release_branch_required_reviews', ok)).toEqual({ value: Number(ok) });
    expect(validateConfigKeyValue('release_branch_required_reviews', '3').error).toBe('must be 0, 1 or 2');
    expect(validateConfigKeyValue('release_branch_required_reviews', '-1').error).toBe('must be 0, 1 or 2');
    expect(validateConfigKeyValue('release_branch_required_reviews', '1.5').error).toBe('must be a whole number');
    expect(validateConfigKeyValue('release_branch_required_reviews', 'one').error).toBe('must be a whole number');
  });

  it('compliance_frameworks takes the five codes, as JSON or a comma list, and may be empty', () => {
    expect(validateConfigKeyValue('compliance_frameworks', 'soc-2,iso-27001')).toEqual({ value: ['soc-2', 'iso-27001'] });
    expect(validateConfigKeyValue('compliance_frameworks', '["gdpr","eu-ai-act","iso-29119"]')).toEqual({
      value: ['gdpr', 'eu-ai-act', 'iso-29119'],
    });
    expect(validateConfigKeyValue('compliance_frameworks', '')).toEqual({ value: [] });
    expect(validateConfigKeyValue('compliance_frameworks', 'soc-2,hipaa').error).toMatch(/every entry must be one of: soc-2, iso-27001, iso-29119, gdpr, eu-ai-act/);
  });

  it('onboarding_preset accepts A, B, C, D and custom', () => {
    for (const v of ['A', 'B', 'C', 'D', 'custom']) expect(validateConfigKeyValue('onboarding_preset', v)).toEqual({ value: v });
    expect(validateConfigKeyValue('onboarding_preset', 'E').error).toMatch(/must be one of A, B, C, D, custom/);
    expect(validateConfigKeyValue('onboarding_preset', 'a').error).toMatch(/must be one of/);
  });

  it('e2e_data_isolation accepts its four values and refuses others', () => {
    for (const v of ['none', 'ephemeral', 'shared_serialised', 'shared']) expect(validateConfigKeyValue('e2e_data_isolation', v)).toEqual({ value: v });
    expect(validateConfigKeyValue('e2e_data_isolation', 'per-run').error).toMatch(/must be one of none, ephemeral, shared_serialised, shared/);
  });

  it('the list keys take JSON or comma lists', () => {
    expect(validateConfigKeyValue('e2e_seed_paths', 'scripts/seed.ts,e2e/fixtures')).toEqual({ value: ['scripts/seed.ts', 'e2e/fixtures'] });
    expect(validateConfigKeyValue('feature_e2e_projects', '["chromium"]')).toEqual({ value: ['chromium'] });
    expect(validateConfigKeyValue('feature_e2e_projects', '')).toEqual({ value: [] });
  });

  it('the three commands are one line of at most 500 characters, and may be empty to unset', () => {
    for (const key of ['e2e_reset_command', 'e2e_preflight_command', 'e2e_leak_check_command']) {
      expect(validateConfigKeyValue(key, 'npm run seed:reset')).toEqual({ value: 'npm run seed:reset' });
      expect(validateConfigKeyValue(key, '')).toEqual({ value: '' });
      expect(validateConfigKeyValue(key, 'a\nb').error).toBe('must be a single line');
      expect(validateConfigKeyValue(key, 'x'.repeat(501)).error).toBe('must be at most 500 characters');
    }
  });

  it('e2e_max_skipped is 0 or more', () => {
    expect(validateConfigKeyValue('e2e_max_skipped', '0')).toEqual({ value: 0 });
    expect(validateConfigKeyValue('e2e_max_skipped', '12')).toEqual({ value: 12 });
    expect(validateConfigKeyValue('e2e_max_skipped', '-1').error).toBe('must be 0 or more');
  });

  it('no new key claims a generated file, because nothing renders from them yet', () => {
    for (const key of [
      'approval.mode',
      'production_review.terminal_status',
      'release_branch_required_reviews',
      'compliance_frameworks',
      'onboarding_preset',
      'e2e_data_isolation',
      'e2e_seed_paths',
      'e2e_reset_command',
      'e2e_preflight_command',
      'e2e_leak_check_command',
      'e2e_max_skipped',
      'feature_e2e_projects',
    ]) {
      expect(findConfigKey(key)?.affects, key).toEqual([]);
    }
  });
});

describe('configure with dotted keys', () => {
  it('plans a dotted change against the nested value and keeps the siblings', async () => {
    const dir = await repo({ ...BASE, approval: { mode: 'dual_actor', auto_low_risk_threshold: 'LOW' } });
    const ctx = await loadConfigContext(dir);
    const plan = await planConfigChange(ctx, 'approval.mode', 'solo_with_gap');
    expect(plan.errors).toEqual([]);
    expect(plan.before).toBe('dual_actor');
    expect(plan.after).toBe('solo_with_gap');
    expect(plan.followUps.join(' ')).toMatch(/recorded control gap/);
  });

  it('a dotted set writes into the nested object, keeps its other fields, and leaves the rest of the file as it was', async () => {
    const dir = await repo({ ...BASE, approval: { mode: 'dual_actor', auto_low_risk_threshold: 'LOW' }, paths_ignore: ['docs/**'] });
    const code = await runConfigureSet('approval.mode', 'solo_with_gap', { yes: true, dryRun: false }, { cwd: dir });
    expect(code).toBe(0);
    const after = await readCfg(dir);
    expect(after['approval']).toEqual({ mode: 'solo_with_gap', auto_low_risk_threshold: 'LOW' });
    expect(Object.keys(after)).toEqual(Object.keys({ ...BASE, approval: 1, paths_ignore: 1 }));
    expect(after['paths_ignore']).toEqual(['docs/**']);
  });

  it('a dotted set creates the section when the file has none', async () => {
    const dir = await repo({ ...BASE });
    expect(await runConfigureSet('production_review.terminal_status', 'released', { yes: true, dryRun: false }, { cwd: dir })).toBe(0);
    expect((await readCfg(dir))['production_review']).toEqual({ terminal_status: 'released' });
  });

  it('an invalid value exits 2 and writes nothing', async () => {
    const dir = await repo({ ...BASE, approval: { mode: 'dual_actor' } });
    const before = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8');
    expect(await runConfigureSet('approval.mode', 'auto_low_risk', { yes: true, dryRun: false }, { cwd: dir })).toBe(2);
    expect(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).toBe(before);
  });

  it('--dry-run writes nothing', async () => {
    const dir = await repo({ ...BASE });
    const before = await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8');
    expect(await runConfigureSet('approval.mode', 'solo_with_gap', { yes: true, dryRun: true }, { cwd: dir })).toBe(0);
    expect(await fs.readFile(join(dir, 'sdlc-config.json'), 'utf-8')).toBe(before);
  });

  it('setting the value the file already has changes nothing', async () => {
    const dir = await repo({ ...BASE, approval: { mode: 'dual_actor' } });
    const plan = await planConfigChange(await loadConfigContext(dir), 'approval.mode', 'dual_actor');
    expect(plan.warnings.join(' ')).toMatch(/already has this value/);
  });

  it('each test-data key round-trips through set (strings, lists, an integer and an enum)', async () => {
    const dir = await repo({ ...BASE });
    const sets: [string, string, unknown][] = [
      ['e2e_data_isolation', 'ephemeral', 'ephemeral'],
      ['e2e_seed_paths', 'scripts/seed.ts,e2e/fixtures', ['scripts/seed.ts', 'e2e/fixtures']],
      ['e2e_reset_command', 'npm run db:reset', 'npm run db:reset'],
      ['e2e_preflight_command', 'npm run db:check', 'npm run db:check'],
      ['e2e_leak_check_command', 'npm run db:leaks', 'npm run db:leaks'],
      ['e2e_max_skipped', '3', 3],
      ['feature_e2e_projects', 'chromium', ['chromium']],
      ['release_branch_required_reviews', '0', 0],
      ['compliance_frameworks', 'soc-2', ['soc-2']],
      ['onboarding_preset', 'D', 'D'],
    ];
    for (const [key, raw] of sets) expect(await runConfigureSet(key, raw, { yes: true, dryRun: false }, { cwd: dir }), key).toBe(0);
    const after = await readCfg(dir);
    for (const [key, , expected] of sets) expect(after[key], key).toEqual(expected);
  });

  it('release_branch_required_reviews points at devaudit update, and 0 names the control gap', async () => {
    const dir = await repo({ ...BASE });
    const ctx = await loadConfigContext(dir);
    const zero = await planConfigChange(ctx, 'release_branch_required_reviews', '0');
    expect(zero.followUps.join(' ')).toMatch(/devaudit update/);
    expect(zero.followUps.join(' ')).toMatch(/control gap/);
    const one = await planConfigChange(ctx, 'release_branch_required_reviews', '1');
    expect(one.followUps.join(' ')).not.toMatch(/control gap/);
    expect((await planConfigChange(ctx, 'release_branch_required_reviews', '5')).errors.join(' ')).toMatch(/must be 0, 1 or 2/);
  });
});
