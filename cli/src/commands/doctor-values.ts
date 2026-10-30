import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Remediation } from '@metasession.co/devaudit-core';
import { defaultGh, type GhRunner } from '../lib/deploy-detect.js';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import { isManagedName, referencedValues, workflowReferences } from '../lib/config-values.js';

/**
 * DevAudit-Installer#1160 — the `ci-values` doctor check: does every `${{ secrets.X }}` / `${{ vars.X }}` that the
 * configuration hands to the generated workflows, or that a workflow file reads directly, exist where the workflows can
 * read it? Names DevAudit manages are left to the credential and deploy checks; an expression with a fallback or a
 * comparison names a value that may be absent and is not checked. GitHub reads a missing one
 * as an empty string, so the first symptom is usually far from the cause. Names only: the check never reads a value.
 * It needs a GitHub CLI session that can list secrets; without one it says it could not check and does not fail.
 * A finding is either a name that exists nowhere the workflows can read, or one that exists only inside an environment. Both are
 * tier C (the plan is printed, never run).
 */

export interface CiValuesDeps {
  readonly gh?: GhRunner;
}

interface Names {
  readonly secrets: Set<string>;
  readonly vars: Set<string>;
}

async function listNames(gh: GhRunner, repoRoot: string, args: readonly string[]): Promise<string[] | null> {
  const r = await gh(args, repoRoot);
  if (r.exitCode !== 0) return null;
  try {
    const parsed: unknown = JSON.parse(r.stdout);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x !== null && typeof (x as { name?: unknown }).name === 'string' ? (x as { name: string }).name : '')).filter((n) => n !== '');
  } catch {
    return null;
  }
}

const guidance = (id: string, summary: string, plan: string[]): Remediation => ({ id, tier: 'C', summary, plan, needsPortal: false });

interface Reference {
  readonly kind: 'secrets' | 'vars';
  readonly source: string;
  /** What reads it: `e2e_env.NAME` for a configuration entry, `.github/workflows/x.yml` for a workflow file. */
  readonly readers: string[];
}

function missingRemediation(ref: Reference): Remediation {
  const define = ref.kind === 'secrets' ? `gh secret set ${ref.source}` : `gh variable set ${ref.source}`;
  const fromConfig = ref.readers.some((r) => !r.startsWith('.github/'));
  return guidance('define-repository-value', `Define ${ref.source} at repository level, or correct the name`, [
    `${define}   (you are prompted for the value; it is never printed here)`,
    fromConfig ? 'or correct the name in sdlc-config.json with `devaudit configure set <map>`' : 'or correct the name in the workflow file',
  ]);
}

/** Every secret and variable the configuration and the workflow files read, once per name, with their readers. */
async function collectReferences(repoRoot: string, cfg: Record<string, unknown>): Promise<Reference[]> {
  const byKey = new Map<string, Reference>();
  const add = (kind: 'secrets' | 'vars', source: string, reader: string): void => {
    const key = `${kind}.${source}`;
    const existing = byKey.get(key);
    if (existing) existing.readers.push(reader);
    else byKey.set(key, { kind, source, readers: [reader] });
  };
  for (const r of referencedValues(cfg)) add(r.kind, r.source, `${r.map}.${r.env}`);
  const dir = join(repoRoot, '.github', 'workflows');
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
  for (const file of files) {
    const text = await fs.readFile(join(dir, file), 'utf-8').catch(() => '');
    for (const r of workflowReferences(text)) if (!isManagedName(cfg, r.source)) add(r.kind, r.source, `.github/workflows/${file}`);
  }
  return [...byKey.values()];
}

export async function ciValuesCheck(
  consumer: { readonly repoRoot: string; readonly cfg: Record<string, unknown> },
  deps: CiValuesDeps = {},
): Promise<CheckResult> {
  const name = 'ci-values';
  const gh = deps.gh ?? defaultGh;
  const refs = await collectReferences(consumer.repoRoot, consumer.cfg);
  if (refs.length === 0) {
    return { name, ok: true, detail: 'neither the configuration nor the workflow files reference a secret or variable (nothing to check)', suspectedOrigin: 'consumer-drift' };
  }

  const repoSecrets = await listNames(gh, consumer.repoRoot, ['secret', 'list', '--json', 'name']);
  if (repoSecrets === null) {
    return { name, ok: true, detail: 'skipped (the GitHub CLI cannot list secrets here: not signed in, or no access to the repository)', suspectedOrigin: 'unknown' };
  }
  const repoVars = (await listNames(gh, consumer.repoRoot, ['variable', 'list', '--json', 'name'])) ?? [];
  // Organisation-level values shared with the repository are visible to every job as well.
  const orgSecrets = (await listNames(gh, consumer.repoRoot, ['api', 'repos/{owner}/{repo}/actions/organization-secrets', '--jq', '[.secrets[].name]'])) ?? [];
  const orgVars = (await listNames(gh, consumer.repoRoot, ['api', 'repos/{owner}/{repo}/actions/organization-variables', '--jq', '[.variables[].name]'])) ?? [];
  const visible: Names = { secrets: new Set([...repoSecrets, ...orgSecrets]), vars: new Set([...repoVars, ...orgVars]) };

  // Values that exist only inside an environment: no generated job sets `environment:`, so none can read them.
  const environments = (await listNames(gh, consumer.repoRoot, ['api', 'repos/{owner}/{repo}/environments', '--jq', '[.environments[].name]'])) ?? [];
  const inEnvironment = new Map<string, string[]>(); // "secrets.X" -> environment names
  for (const env of environments) {
    const enc = encodeURIComponent(env);
    const secrets = (await listNames(gh, consumer.repoRoot, ['api', `repos/{owner}/{repo}/environments/${enc}/secrets`, '--jq', '[.secrets[].name]'])) ?? [];
    const vars = (await listNames(gh, consumer.repoRoot, ['api', `repos/{owner}/{repo}/environments/${enc}/variables`, '--jq', '[.variables[].name]'])) ?? [];
    for (const n of secrets) inEnvironment.set(`secrets.${n}`, [...(inEnvironment.get(`secrets.${n}`) ?? []), env]);
    for (const n of vars) inEnvironment.set(`vars.${n}`, [...(inEnvironment.get(`vars.${n}`) ?? []), env]);
  }

  const findings: Finding[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}.${ref.source}`;
    if (visible[ref.kind].has(ref.source)) continue;
    const users = ref.readers;
    const envs = inEnvironment.get(key);
    const what = ref.kind === 'secrets' ? 'secret' : 'variable';
    if (envs && envs.length > 0) {
      findings.push({
        subject: `${ref.source}`,
        detail: `The ${what} ${ref.source} (read by ${users.join(', ')}) exists only in the environment ${envs.join(', ')}. No generated workflow job sets \`environment:\`, so it reads as empty.`,
        remediation: guidance('define-repository-value', `Define ${ref.source} at repository level`, [
          `${ref.kind === 'secrets' ? 'gh secret set' : 'gh variable set'} ${ref.source}   (you are prompted for the value; it is never printed here)`,
        ]),
      });
    } else {
      findings.push({
        subject: `${ref.source}`,
        detail: `The ${what} ${ref.source} (read by ${users.join(', ')}) does not exist at repository or organisation level, so GitHub reads it as empty.`,
        remediation: missingRemediation(ref),
      });
    }
  }

  if (findings.length === 0) {
    return { name, ok: true, detail: `all ${refs.length} referenced secret(s) and variable(s) exist at repository or organisation level`, suspectedOrigin: 'consumer-drift' };
  }
  return { name, ok: false, detail: `${findings.length} referenced value(s) not visible to the generated workflows: ${findings.map((f) => f.subject).join(', ')}`, suspectedOrigin: 'consumer-drift', findings };
}
