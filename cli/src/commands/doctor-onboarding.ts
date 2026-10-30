import { PRESETS, PRESET_CONFIG_KEYS, PRESET_IDS, SELF_APPROVAL_CLAUSES, detectFacts, type PresetId, type TestGroups } from '@metasession.co/devaudit-core';
import { fsRepoReader } from '@metasession.co/devaudit-core/node';
import { resolveViewerKey } from '../lib/viewer-keys.js';
import { getConfigPath } from '../lib/config-path.js';
import { defaultGh, type GhRunner } from '../lib/deploy-detect.js';
import { readApprovalPolicy, readClaimedStandards, type PolicyRead, type StandardsRead } from '../lib/onboarding-portal.js';
import type { CheckResult, Finding } from '../lib/doctor-types.js';

/**
 * DevAudit-Installer#1116 WP8 — the doctor checks that compare a project with the preset it chose, the
 * standards it claims and the approval policy the portal enforces, plus the measured run times. All are
 * non-gating like the other onboarding checks; they report nothing for a project that never chose a
 * preset (decision 12), and never claim a project is compliant.
 */

const json = (v: unknown): string => JSON.stringify(v);
const isPreset = (v: unknown): v is PresetId => typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v);

function differences(cfg: Record<string, unknown>, id: PresetId): Array<{ key: string; have: unknown; want: unknown }> {
  const out: Array<{ key: string; have: unknown; want: unknown }> = [];
  for (const [key, want] of Object.entries(PRESETS[id].config)) {
    if (key === 'onboarding_preset') continue;
    const have = getConfigPath(cfg, key);
    if (json(have) !== json(want)) out.push({ key, have, want });
  }
  // Keys another preset writes and this one does not, left behind by a switch or a hand edit.
  for (const key of PRESET_CONFIG_KEYS) {
    if (key === 'onboarding_preset' || key in PRESETS[id].config) continue;
    const have = getConfigPath(cfg, key);
    if (have !== undefined) out.push({ key, have, want: undefined });
  }
  return out;
}

const show = (v: unknown): string => (v === undefined ? 'unset' : json(v));

/** `preset-drift`: the configuration no longer matches `onboarding_preset`, or a gated tier has no tests. */
export function presetDriftCheck(cfg: Record<string, unknown>, testGroups: TestGroups | null): CheckResult {
  const name = 'preset-drift';
  const recorded = cfg['onboarding_preset'];
  if (!isPreset(recorded)) {
    return { name, ok: true, detail: 'no preset chosen (nothing to compare); `devaudit configure` suggests one for this repository', suspectedOrigin: 'consumer-drift' };
  }
  const diffs = differences(cfg, recorded);
  const closest = PRESET_IDS.map((id) => ({ id, n: differences(cfg, id).length })).sort((a, b) => a.n - b.n || a.id.localeCompare(b.id))[0]!;
  const nearest = closest.id !== recorded && closest.n < diffs.length ? ` Closest preset: ${closest.id} (${closest.n} difference${closest.n === 1 ? '' : 's'}).` : '';
  const findings: Finding[] = diffs.map((d) => ({
    subject: d.key,
    detail:
      d.want === undefined
        ? `\`${d.key}\` is ${show(d.have)}, but preset ${recorded} does not write it.${nearest}`
        : `\`${d.key}\` is ${show(d.have)}; preset ${recorded} writes ${show(d.want)}.${nearest}`,
    ...(d.want === undefined
      ? {}
      : {
          remediation: {
            id: 'set-config',
            tier: 'A' as const,
            summary: `Set ${d.key} to ${String(d.want)} as preset ${recorded} writes it`,
            plan: [`devaudit configure set ${d.key} ${String(d.want)}`, 'devaudit update'],
            needsPortal: false,
            data: { key: d.key, value: String(d.want) },
          },
        }),
  }));
  const gate = cfg['release_gate_tier'];
  const gateProblem = testGroups !== null && (gate === 'smoke' || gate === 'critical' || gate === 'full') && !testGroups[gate];
  if (gateProblem) {
    findings.push({ subject: 'release_gate_tier', detail: `The release gate is \`${String(gate)}\` but no ${String(gate)} tests were found, so the gate has nothing to run.` });
  }
  if (findings.length === 0) return { name, ok: true, detail: `matches preset ${recorded}`, suspectedOrigin: 'consumer-drift' };
  findings.push({
    subject: 'onboarding_preset',
    detail: `If these differences are deliberate, record the project as custom so this check stops comparing it with preset ${recorded}.`,
    remediation: {
      id: 'set-config',
      tier: 'A',
      summary: 'Record the preset as custom',
      plan: ['devaudit configure set onboarding_preset custom'],
      needsPortal: false,
      data: { key: 'onboarding_preset', value: 'custom' },
    },
  });
  return {
    name,
    ok: false,
    detail: `${diffs.length} setting(s) differ from preset ${recorded}${gateProblem ? ' and a gated tier has no tests' : ''}.${nearest}`,
    suspectedOrigin: 'consumer-drift',
    findings,
  };
}

/** `standards-fit`: the standards the project needs against its preset, and against what the portal claims. */
export function standardsFitCheck(cfg: Record<string, unknown>, portalStandards: readonly string[] | null): CheckResult {
  const name = 'standards-fit';
  const configured = Array.isArray(cfg['compliance_frameworks']) ? (cfg['compliance_frameworks'] as unknown[]).filter((f): f is string => typeof f === 'string') : [];
  const findings: Finding[] = [];
  const needsEvidence = configured.some((f) => f === 'soc-2' || f === 'iso-27001');
  if (needsEvidence && getConfigPath(cfg, 'approval.mode') === 'solo_with_gap') {
    findings.push({
      subject: 'approval.mode',
      detail: `You need evidence for ${configured.filter((f) => f === 'soc-2' || f === 'iso-27001').join(' and ')}, but releases are approved by their author, so ${SELF_APPROVAL_CLAUSES.join(' and ')} show as not covered (a recorded gap). An auditor will ask for a compensating control.`,
    });
  }
  if (portalStandards !== null) {
    const missingOnPortal = configured.filter((f) => !portalStandards.includes(f));
    const notInConfig = portalStandards.filter((f) => !configured.includes(f));
    if (missingOnPortal.length > 0) {
      findings.push({ subject: 'compliance_frameworks', detail: `sdlc-config.json lists ${missingOnPortal.join(', ')} but the portal does not show the project as claiming it.` });
    }
    if (notInConfig.length > 0) {
      findings.push({ subject: 'compliance_frameworks', detail: `The portal shows the project claiming ${notInConfig.join(', ')} but sdlc-config.json does not list it.` });
    }
  }
  if (findings.length === 0) {
    return {
      name,
      ok: true,
      detail: configured.length === 0 && (portalStandards ?? []).length === 0 ? 'no standards recorded' : `${configured.join(', ') || 'portal standards'} fit the approval settings`,
      suspectedOrigin: 'consumer-drift',
    };
  }
  return { name, ok: false, detail: `${findings.length} mismatch(es) between the standards, the preset and the portal`, suspectedOrigin: 'consumer-drift', findings };
}

/** `approval-policy`: `approval.mode` against the approval policy the portal enforces (portal issue #931). */
export function approvalPolicyCheck(cfg: Record<string, unknown>, policy: PolicyRead): CheckResult {
  const name = 'approval-policy';
  const mode = getConfigPath(cfg, 'approval.mode') === 'solo_with_gap' ? 'solo_with_gap' : 'dual_actor';
  if (policy.status === 'unsupported') {
    return { name, ok: true, detail: 'the portal does not report an approval policy yet, so it was not compared' };
  }
  if (policy.status === 'unknown') {
    return { name, ok: true, detail: 'not checked (no portal project or viewer key to read the approval policy with)' };
  }
  const expected = mode === 'solo_with_gap' ? 'self_allowed_with_gap' : 'independent';
  if (policy.policy === expected) return { name, ok: true, detail: `approval.mode ${mode} matches the portal policy ${policy.policy}` };
  const detail =
    mode === 'solo_with_gap'
      ? 'approval.mode is solo_with_gap but the portal requires an independent approver, so the author cannot approve their own release there.'
      : 'approval.mode is dual_actor but the portal allows self-approval with a recorded gap, so the portal will not enforce a different approver.';
  return {
    name,
    ok: false,
    detail,
    suspectedOrigin: 'consumer-drift',
    findings: [{ subject: 'approval.mode', detail }],
  };
}

export interface OnboardingCheckDeps {
  /** Test seams: the portal reads, the gh runner and the test groups found. */
  readonly policy?: PolicyRead;
  readonly standards?: StandardsRead;
  readonly gh?: GhRunner;
  readonly testGroups?: TestGroups | null;
}

/** The four checks of this file for a consumer repository. `skipDurations` leaves out the slow `gh` measurement (a re-check). */
export async function onboardingChecksFor(
  consumer: { readonly repoRoot: string; readonly cfg: Record<string, unknown> },
  deps: OnboardingCheckDeps = {},
  opts: { readonly skipDurations?: boolean } = {},
): Promise<CheckResult[]> {
  const cfg = consumer.cfg;
  const slug = typeof cfg['project_slug'] === 'string' ? (cfg['project_slug'] as string) : '';
  const devaudit = (cfg['devaudit'] ?? {}) as { base_url?: string };
  const baseUrl = (devaudit.base_url ?? '').replace(/\/$/, '');
  let policy = deps.policy;
  let standards = deps.standards;
  if (!policy || !standards) {
    const viewerKey = baseUrl && slug ? ((await resolveViewerKey({ repoRoot: consumer.repoRoot, baseUrl, slug }))?.key ?? null) : null;
    const portal = { baseUrl, slug, viewerKey };
    policy ??= baseUrl && slug ? await readApprovalPolicy(portal) : { status: 'unknown', reason: 'no-project' };
    standards ??= baseUrl && slug ? await readClaimedStandards(portal) : { status: 'unavailable' };
  }
  const testGroups = deps.testGroups !== undefined ? deps.testGroups : (await detectFacts(fsRepoReader(consumer.repoRoot))).testGroups;
  return [
    presetDriftCheck(cfg, testGroups),
    standardsFitCheck(cfg, standards.status === 'ok' ? standards.codes : null),
    approvalPolicyCheck(cfg, policy),
    ...(opts.skipDurations ? [] : [await durationsCheck(consumer.repoRoot, deps.gh)]),
  ];
}

const WORKFLOWS = ['ci.yml', 'e2e-regression.yml'] as const;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const minutes = (ms: number): string => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`);

/** `durations`: the median duration of each job over the last 10 successful runs of ci.yml and e2e-regression.yml. */
export async function durationsCheck(repoRoot: string, gh: GhRunner = defaultGh): Promise<CheckResult> {
  const name = 'durations';
  const parts: string[] = [];
  for (const workflow of WORKFLOWS) {
    const list = await gh(['run', 'list', '--workflow', workflow, '--status', 'success', '--limit', '10', '--json', 'databaseId'], repoRoot);
    if (list.exitCode !== 0) continue;
    let ids: number[];
    try {
      ids = (JSON.parse(list.stdout) as Array<{ databaseId: number }>).map((r) => r.databaseId);
    } catch {
      continue;
    }
    const byJob = new Map<string, number[]>();
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const view = await gh(['run', 'view', String(id), '--json', 'jobs'], repoRoot);
      if (view.exitCode !== 0) continue;
      try {
        const jobs = (JSON.parse(view.stdout) as { jobs?: Array<{ name: string; startedAt?: string; completedAt?: string; conclusion?: string }> }).jobs ?? [];
        for (const job of jobs) {
          if (job.conclusion !== 'success' || !job.startedAt || !job.completedAt) continue;
          const ms = Date.parse(job.completedAt) - Date.parse(job.startedAt);
          if (Number.isFinite(ms) && ms >= 0) byJob.set(job.name, [...(byJob.get(job.name) ?? []), ms]);
        }
      } catch {
        // an unreadable run is skipped
      }
    }
    if (byJob.size > 0) {
      parts.push(`${workflow}: ${[...byJob.entries()].map(([job, ms]) => `${job} ${minutes(median(ms))}`).join(', ')}`);
    }
  }
  return {
    name,
    ok: true,
    detail: parts.length > 0 ? `median of the last successful runs — ${parts.join('; ')}` : 'not measured yet (no successful runs, or `gh` is not available)',
  };
}
