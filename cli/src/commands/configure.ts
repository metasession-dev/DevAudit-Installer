import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { logger, isJsonMode, emitJsonResult } from '../lib/logger.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { resolveInstallerRoot } from '../lib/installer-root.js';
import { listHosts, loadHostAdapter, type HostAdapter } from '../lib/adapter.js';
import { CONFIG_KEYS, SECRET_NAME, findConfigKey, parseConfigValue, type ConfigKeySpec } from '../lib/repo-config-keys.js';
import { detectDeployHost, describeDetection, type DeployDetection, type GhRunner } from '../lib/deploy-detect.js';
import * as prompts from '../lib/prompt.js';

/**
 * devaudit-installer#1040 — `devaudit configure`: read and change a consumer's
 * `sdlc-config.json` with validation, instead of hand-editing it.
 *
 *  - `list` / `get`: every key `configure` knows, its value and meaning.
 *  - `set <key> <value>`: type, allowed-value and pattern checks; a value the
 *    repo's own evidence contradicts (e.g. `host railway` while production
 *    deployments come from Vercel) needs an interactive confirmation or
 *    `--reason`; `--dry-run` shows the result and the generated files the next
 *    `devaudit update` rewrites, and writes nothing.
 *  - `secret <NAME>`: hands the terminal to `gh secret set NAME`, whose own
 *    masked prompt takes the value; devaudit never sees, prints or stores it.
 *
 * `doctor --fix` applies its `set-config` proposals through `planConfigChange`
 * + `writeConfigValue`, so both paths validate identically.
 */

export const CONFIGURE_EXIT_INVALID = 2;
export const CONFIGURE_EXIT_UNAPPLIED = 8;

export interface ConfigContext {
  readonly repoRoot: string;
  readonly installerRoot: string;
  readonly cfg: Record<string, unknown>;
  readonly hosts: readonly string[];
}

export interface ConfigPlan {
  readonly key: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  /** Set when the repo's evidence disagrees with the new value: needs confirmation or a reason. */
  readonly contradiction: string | null;
  /** Generated files the next `devaudit update` adds, rewrites or removes. */
  readonly impact: readonly string[];
  /** Follow-up steps the operator must still take (secrets to add, keys to set). */
  readonly followUps: readonly string[];
}

export async function loadConfigContext(cwd: string = process.cwd()): Promise<ConfigContext> {
  const repoRoot = await resolveRepoRoot(cwd);
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(await fs.readFile(join(repoRoot, 'sdlc-config.json'), 'utf-8')) as Record<string, unknown>;
  } catch {
    throw new Error(`no readable sdlc-config.json at ${repoRoot} — run \`devaudit install\` first`);
  }
  const installerRoot = await resolveInstallerRoot();
  return { repoRoot, installerRoot, cfg, hosts: await listHosts(installerRoot) };
}

function recordedHost(cfg: Record<string, unknown>): string {
  return typeof cfg['host'] === 'string' && cfg['host'] !== '' ? (cfg['host'] as string) : 'railway';
}

async function adapterOrNull(installerRoot: string, host: string): Promise<HostAdapter | null> {
  try {
    return await loadHostAdapter(installerRoot, host);
  } catch {
    return null;
  }
}

async function adapterConfigKeys(installerRoot: string, host: string): Promise<{ required: string[] }> {
  try {
    const raw = JSON.parse(
      await fs.readFile(join(installerRoot, 'sdlc', 'files', 'hosts', host, 'adapter.json'), 'utf-8'),
    ) as { config_keys?: { required?: string[] } };
    return { required: raw.config_keys?.required ?? [] };
  } catch {
    return { required: [] };
  }
}

/** Workflows a host generates beyond the host-neutral set. */
function hostWorkflows(adapter: HostAdapter | null): string[] {
  const out: string[] = [];
  if (adapter?.reconcile) out.push('.github/workflows/reconcile-deployment.yml');
  if (adapter?.deploy_workflow) out.push('.github/workflows/deploy-custom.yml');
  return out;
}

export async function planConfigChange(
  ctx: ConfigContext,
  key: string,
  raw: string,
  deps: { readonly detection?: DeployDetection | null; readonly gh?: GhRunner } = {},
): Promise<ConfigPlan> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const followUps: string[] = [];
  let contradiction: string | null = null;
  const before = ctx.cfg[key];
  const spec = findConfigKey(key);
  if (!spec) {
    return {
      key,
      before,
      after: undefined,
      errors: [`unknown key \`${key}\`; \`devaudit configure list\` shows the keys it can change`],
      warnings,
      contradiction,
      impact: [],
      followUps,
    };
  }
  if (spec.ownedBy) {
    errors.push(`\`${key}\` is changed with \`${spec.ownedBy}\`, which also syncs the workflows it controls`);
  }
  const parsed = parseConfigValue(spec, raw);
  if (parsed.error) errors.push(`\`${key}\` ${parsed.error}`);
  const after = parsed.value;
  if (!parsed.error) {
    if (spec.enum && !spec.enum.includes(String(after))) {
      errors.push(`\`${key}\` must be one of: ${spec.enum.join(', ')}`);
    }
    const invalid = spec.validate?.(after);
    if (invalid) errors.push(`\`${key}\` ${invalid}`);
  }

  const currentHost = recordedHost(ctx.cfg);
  const targetHost = key === 'host' && typeof after === 'string' ? after : currentHost;
  let impact = [...spec.affects];

  if (key === 'host' && typeof after === 'string' && errors.length === 0) {
    if (!ctx.hosts.includes(after)) {
      errors.push(`\`host\` must be a shipped host adapter: ${ctx.hosts.join(', ')}`);
    } else {
      const detection =
        deps.detection !== undefined ? deps.detection : await detectDeployHost(ctx.repoRoot, currentHost, { gh: deps.gh });
      if (detection?.detected && detection.detected !== after) {
        const summary = describeDetection(detection);
        if (detection.confidence === 'low') warnings.push(`the repo's evidence is mixed: ${summary}`);
        else contradiction = `this repo's evidence points to ${summary}, not \`${after}\``;
      }
      const [oldAdapter, newAdapter] = await Promise.all([
        adapterOrNull(ctx.installerRoot, currentHost),
        adapterOrNull(ctx.installerRoot, after),
      ]);
      const oldFlows = hostWorkflows(oldAdapter);
      const newFlows = hostWorkflows(newAdapter);
      impact = [
        ...newFlows.filter((f) => !oldFlows.includes(f)).map((f) => `${f} (added)`),
        ...oldFlows.filter((f) => !newFlows.includes(f)).map((f) => `${f} (removed)`),
        '.github/workflows/post-deploy-prod.yml',
      ];
      for (const secret of newAdapter?.required_secrets ?? []) {
        if (secret !== 'DEVAUDIT_API_KEY') followUps.push(`add the repo secret ${secret}: devaudit configure secret ${secret}`);
      }
      for (const secret of newAdapter?.reconcile?.secrets ?? []) {
        if (!followUps.some((f) => f.includes(` ${secret}:`))) {
          followUps.push(`add the repo secret ${secret} (webhook-loss recovery): devaudit configure secret ${secret}`);
        }
      }
    }
  }

  if (spec.hosts && !spec.hosts.includes(targetHost)) {
    warnings.push(`\`${key}\` is only used with host ${spec.hosts.join('/')}; this repo's host is \`${targetHost}\``);
  }
  if (errors.length === 0) {
    const { required } = await adapterConfigKeys(ctx.installerRoot, targetHost);
    const next = { ...ctx.cfg, [key]: after };
    for (const req of required) {
      const v = next[req];
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
        followUps.push(`host \`${targetHost}\` requires \`${req}\`: devaudit configure set ${req} <value>`);
      }
    }
    if (key === 'production_url_secret' && typeof after === 'string') {
      followUps.push(`make sure the repo secret ${after} holds the production base URL: devaudit configure secret ${after}`);
    }
    if (key === 'deploy_secrets' && Array.isArray(after)) {
      for (const s of after) followUps.push(`make sure the repo secret ${String(s)} exists: devaudit configure secret ${String(s)}`);
    }
  }
  if (JSON.stringify(before) === JSON.stringify(after) && errors.length === 0) {
    warnings.push(`\`${key}\` already has this value; nothing would change`);
    impact = [];
  }
  return { key, before, after, errors, warnings, contradiction, impact, followUps };
}

/** Write one key, keeping the file's key order and two-space formatting. */
export async function writeConfigValue(ctx: ConfigContext, key: string, value: unknown): Promise<void> {
  const next: Record<string, unknown> = { ...ctx.cfg, [key]: value };
  await fs.writeFile(join(ctx.repoRoot, 'sdlc-config.json'), `${JSON.stringify(next, null, 2)}\n`);
}

function show(value: unknown): string {
  return value === undefined ? '(unset)' : JSON.stringify(value);
}

function describeSpec(spec: ConfigKeySpec, cfg: Record<string, unknown>, host: string, required: readonly string[]) {
  return {
    key: spec.key,
    value: cfg[spec.key] ?? null,
    type: spec.type,
    description: spec.description,
    ...(spec.enum ? { allowed: spec.enum } : {}),
    ...(spec.hosts ? { hosts: spec.hosts } : {}),
    requiredByHost: required.includes(spec.key),
    applies: !spec.hosts || spec.hosts.includes(host),
    ...(spec.ownedBy ? { changeWith: spec.ownedBy } : {}),
  };
}

export async function runConfigureList(): Promise<void> {
  const log = logger();
  const ctx = await loadConfigContext();
  const host = recordedHost(ctx.cfg);
  const { required } = await adapterConfigKeys(ctx.installerRoot, host);
  const rows = CONFIG_KEYS.map((spec) => describeSpec(spec, ctx.cfg, host, required));
  if (isJsonMode()) {
    emitJsonResult({ repoRoot: ctx.repoRoot, host, hosts: ctx.hosts, keys: rows });
    return;
  }
  log.log(`sdlc-config.json in ${ctx.repoRoot} (host: ${host})\n`);
  for (const row of rows) {
    if (!row.applies) continue;
    const req = row.requiredByHost ? ' [required by host]' : '';
    log.log(`  ${row.key.padEnd(36)} ${show(row.value ?? undefined)}${req}`);
  }
  log.log('\nKeys for other hosts are hidden; `devaudit configure get <key>` explains any key.');
}

export async function runConfigureGet(key: string): Promise<void> {
  const log = logger();
  const ctx = await loadConfigContext();
  const spec = findConfigKey(key);
  const host = recordedHost(ctx.cfg);
  if (!spec) {
    if (isJsonMode()) emitJsonResult({ key, value: ctx.cfg[key] ?? null, known: false });
    else log.log(`${key} = ${show(ctx.cfg[key])} (not a key \`devaudit configure\` manages)`);
    return;
  }
  const { required } = await adapterConfigKeys(ctx.installerRoot, host);
  const row = describeSpec(spec, ctx.cfg, host, required);
  if (isJsonMode()) {
    emitJsonResult({ ...row, known: true });
    return;
  }
  log.log(`${key} = ${show(ctx.cfg[key])}`);
  log.log(`  ${spec.description}`);
  if (spec.enum) log.log(`  allowed: ${spec.enum.join(', ')}`);
  if (key === 'host') log.log(`  allowed: ${ctx.hosts.join(', ')}`);
  if (spec.hosts) log.log(`  used with host: ${spec.hosts.join(', ')}`);
  if (row.requiredByHost) log.log(`  required by host \`${host}\``);
  if (spec.ownedBy) log.log(`  change with: ${spec.ownedBy}`);
}

export interface ConfigureSetOptions {
  readonly reason?: string;
  readonly yes: boolean;
  readonly dryRun: boolean;
}

export async function runConfigureSet(
  key: string,
  raw: string,
  opts: ConfigureSetOptions,
  deps: { readonly gh?: GhRunner; readonly ask?: Pick<typeof prompts, 'confirm' | 'input'>; readonly cwd?: string } = {},
): Promise<number> {
  const log = logger();
  const json = isJsonMode();
  const ask = deps.ask ?? prompts;
  const ctx = await loadConfigContext(deps.cwd);
  const plan = await planConfigChange(ctx, key, raw, { gh: deps.gh });
  let status: 'invalid' | 'planned' | 'applied' | 'unchanged' | 'unapplied' = 'planned';
  let reason = opts.reason?.trim() || null;

  if (plan.errors.length > 0) status = 'invalid';
  else if (plan.impact.length === 0 && JSON.stringify(plan.before) === JSON.stringify(plan.after)) status = 'unchanged';
  else if (opts.dryRun) status = 'planned';
  else {
    let approved = true;
    if (plan.contradiction) {
      if (!reason) {
        const confirmed = await ask.confirm(`${plan.contradiction}. Set \`${key}\` to ${show(plan.after)} anyway?`, { json });
        if (confirmed) reason = await ask.input('Why does this repo differ from its evidence?', { json });
        approved = Boolean(confirmed && reason);
      }
    } else if (!opts.yes) {
      const confirmed = await ask.confirm(`Set \`${key}\` from ${show(plan.before)} to ${show(plan.after)}?`, { json });
      // Non-interactive with no --yes: a validated, uncontradicted change is still the operator's explicit command.
      approved = confirmed !== false;
    }
    if (approved) {
      await writeConfigValue(ctx, key, plan.after);
      status = 'applied';
    } else {
      status = 'unapplied';
    }
  }

  if (json) {
    emitJsonResult({ ...plan, status, ...(reason ? { reason } : {}) });
  } else {
    log.log(`${key}: ${show(plan.before)} -> ${show(plan.after)}`);
    for (const e of plan.errors) log.error(`  ${e}`);
    if (plan.contradiction) log.warn(`  ${plan.contradiction}`);
    for (const w of plan.warnings) log.warn(`  ${w}`);
    if (plan.impact.length > 0) {
      log.log('  The next `devaudit update` regenerates:');
      for (const f of plan.impact) log.log(`    - ${f}`);
    }
    if (plan.followUps.length > 0) {
      log.log('  Still to do:');
      for (const f of plan.followUps) log.log(`    - ${f}`);
    }
    if (status === 'applied') {
      log.success(`  updated sdlc-config.json${reason ? ` (reason: ${reason})` : ''}. Run \`devaudit update\` to regenerate the workflows.`);
    } else if (status === 'planned') log.info('  dry run: nothing written');
    else if (status === 'unapplied') {
      log.warn(
        plan.contradiction
          ? '  not applied: confirm interactively, or pass --reason "<why>" to record why this repo differs from its evidence'
          : '  not applied',
      );
    }
  }
  if (status === 'invalid') return CONFIGURE_EXIT_INVALID;
  if (status === 'unapplied') return CONFIGURE_EXIT_UNAPPLIED;
  return 0;
}

/** Secrets `configure secret` recognises, and what each one is for. */
export function knownSecretPurpose(cfg: Record<string, unknown>, name: string, adapter: HostAdapter | null): string | null {
  if (name === cfg['production_url_secret']) return 'production base URL for the post-deploy probe and smoke checks';
  if (name === 'DEVAUDIT_PROBE_HEADER') return 'header sent with the production probe, for an access-gated origin (e.g. Vercel Deployment Protection)';
  if (name === 'DEVAUDIT_API_KEY') return 'portal CI API key';
  if ((adapter?.required_secrets ?? []).includes(name)) return `required by host \`${adapter?.name}\``;
  if ((adapter?.reconcile?.secrets ?? []).includes(name)) return `used by host \`${adapter?.name}\` webhook-loss recovery`;
  if (Array.isArray(cfg['deploy_secrets']) && (cfg['deploy_secrets'] as unknown[]).includes(name)) return 'listed in deploy_secrets for deploy_command';
  return null;
}

export async function runConfigureSecret(name: string, opts: { readonly dryRun: boolean }): Promise<number> {
  const log = logger();
  if (!SECRET_NAME.test(name)) {
    log.error(`${name} is not a valid GitHub secret name (upper case letters, digits, underscores, starting with a letter)`);
    return CONFIGURE_EXIT_INVALID;
  }
  const ctx = await loadConfigContext();
  const adapter = await adapterOrNull(ctx.installerRoot, recordedHost(ctx.cfg));
  const purpose = knownSecretPurpose(ctx.cfg, name, adapter);
  if (purpose) log.info(`${name}: ${purpose}`);
  else log.warn(`${name} is not referenced by sdlc-config.json or the host adapter; nothing generated will read it`);
  const why = prompts.nonInteractiveReason(isJsonMode());
  if (why) {
    log.error(`configure secret needs an interactive terminal (${why}); run \`gh secret set ${name}\` yourself`);
    return CONFIGURE_EXIT_UNAPPLIED;
  }
  if (opts.dryRun) {
    log.info(`dry run: would run \`gh secret set ${name}\``);
    return 0;
  }
  log.info(`Handing over to \`gh secret set ${name}\`: paste the value at gh's masked prompt. devaudit does not see it.`);
  const r = await execa('gh', ['secret', 'set', name], { cwd: ctx.repoRoot, stdio: 'inherit', reject: false });
  return r.exitCode === 0 ? 0 : 1;
}
