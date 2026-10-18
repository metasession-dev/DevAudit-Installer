import { join } from 'node:path';
import { execa } from 'execa';
import { exists } from './fs-utils.js';

/**
 * devaudit-installer#1040 — evidence for where a consumer's production really
 * deploys, compared with the `host` recorded in `sdlc-config.json`. Onboarding
 * before 1.9.0 hardcoded `host: railway`, so a Vercel-hosted or self-hosted project silently got the Railway-specific workflows.
 *
 * Signals, strongest first:
 *  - who created the repo's production GitHub deployments (the host's GitHub
 *    app, or a workflow in the repo for a deploy devaudit or the team runs);
 *  - host config files committed to the repo.
 * Nothing here fails when `gh` is unavailable: what could not be checked is
 * listed in `unchecked`.
 */

export type DetectedHost = 'railway' | 'vercel' | 'custom';

export interface DeployEvidence {
  readonly host: DetectedHost;
  readonly source: 'deployments' | 'file';
  readonly detail: string;
  readonly weight: number;
}

export interface DeployDetection {
  readonly recorded: string;
  /** Host with the most evidence, or null when there is none. */
  readonly detected: DetectedHost | null;
  readonly confidence: 'high' | 'medium' | 'low' | 'none';
  readonly evidence: readonly DeployEvidence[];
  /** Signals that could not be checked (e.g. `gh` unauthenticated). */
  readonly unchecked: readonly string[];
  /** Latest production deployment URL GitHub recorded, if any (for the probe check). */
  readonly environmentUrl: string | null;
}

export interface GhResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type GhRunner = (args: readonly string[], cwd: string) => Promise<GhResult>;

export const defaultGh: GhRunner = async (args, cwd) => {
  try {
    const r = await execa('gh', [...args], { cwd, reject: false, timeout: 20_000 });
    return { exitCode: r.exitCode ?? 1, stdout: r.stdout };
  } catch {
    return { exitCode: 1, stdout: '' };
  }
};

/** GitHub app / bot logins that create deployments, mapped to a host. */
const CREATORS: ReadonlyArray<[RegExp, DetectedHost, string]> = [
  [/^vercel(\[bot\])?$/i, 'vercel', 'Vercel GitHub app'],
  [/^railway(-app)?(\[bot\])?$/i, 'railway', 'Railway GitHub app'],
  [/^github-actions(\[bot\])?$/i, 'custom', 'a GitHub Actions workflow in this repo'],
];

const FILES: ReadonlyArray<[string, DetectedHost, string, number]> = [
  ['vercel.json', 'vercel', 'vercel.json', 2],
  ['.vercel/project.json', 'vercel', '.vercel/project.json (linked Vercel project)', 2],
  ['railway.json', 'railway', 'railway.json', 2],
  ['railway.toml', 'railway', 'railway.toml', 2],
  ['fly.toml', 'custom', 'fly.toml (Fly.io: deploy with the custom host)', 2],
  ['serverless.yml', 'custom', 'serverless.yml (Serverless Framework)', 1],
  ['appspec.yml', 'custom', 'appspec.yml (AWS CodeDeploy)', 1],
  ['terraform', 'custom', 'terraform/', 1],
  ['k8s', 'custom', 'k8s/ manifests', 1],
  ['helm', 'custom', 'helm/ chart', 1],
];

interface Deployment {
  readonly id: number;
  readonly environment: string;
  readonly creator?: { readonly login?: string } | null;
}

const isProduction = (env: string): boolean => /prod/i.test(env);

export async function detectDeployHost(
  repoRoot: string,
  recordedHost: string,
  deps: { readonly gh?: GhRunner } = {},
): Promise<DeployDetection> {
  const gh = deps.gh ?? defaultGh;
  const evidence: DeployEvidence[] = [];
  const unchecked: string[] = [];
  let environmentUrl: string | null = null;

  const listed = await gh(['api', 'repos/{owner}/{repo}/deployments?per_page=30'], repoRoot);
  if (listed.exitCode !== 0) {
    unchecked.push('GitHub deployments (gh api failed: not authenticated, no repo access, or no origin remote)');
  } else {
    let deployments: Deployment[] = [];
    try {
      deployments = (JSON.parse(listed.stdout) as Deployment[]).filter((d) => isProduction(d.environment ?? ''));
    } catch {
      unchecked.push('GitHub deployments (unreadable response)');
    }
    const byHost = new Map<DetectedHost, { count: number; label: string; login: string }>();
    for (const d of deployments) {
      const login = d.creator?.login ?? '';
      const match = CREATORS.find(([re]) => re.test(login));
      if (!match) continue;
      const [, host, label] = match;
      const prev = byHost.get(host);
      byHost.set(host, { count: (prev?.count ?? 0) + 1, label, login });
    }
    for (const [host, { count, label, login }] of byHost) {
      evidence.push({
        host,
        source: 'deployments',
        detail: `${count} recent production deployment(s) created by ${login} (${label})`,
        weight: 3 + Math.min(count, 5),
      });
    }
    const latest = deployments[0];
    if (latest) {
      const statuses = await gh(['api', `repos/{owner}/{repo}/deployments/${latest.id}/statuses?per_page=5`], repoRoot);
      if (statuses.exitCode === 0) {
        try {
          const url = (JSON.parse(statuses.stdout) as Array<{ environment_url?: string }>).find(
            (s) => typeof s.environment_url === 'string' && s.environment_url !== '',
          )?.environment_url;
          environmentUrl = url ?? null;
        } catch {
          // no URL; not an error
        }
      }
    }
  }

  for (const [rel, host, detail, weight] of FILES) {
    if (await exists(join(repoRoot, rel))) evidence.push({ host, source: 'file', detail, weight });
  }

  const totals = new Map<DetectedHost, number>();
  for (const e of evidence) totals.set(e.host, (totals.get(e.host) ?? 0) + e.weight);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) {
    return { recorded: recordedHost, detected: null, confidence: 'none', evidence, unchecked, environmentUrl };
  }
  const [detected, score] = top;
  const runnerUp = ranked[1]?.[1] ?? 0;
  const fromDeployments = evidence.some((e) => e.host === detected && e.source === 'deployments');
  const confidence =
    runnerUp > 0 && score - runnerUp < 3 ? 'low' : fromDeployments ? 'high' : 'medium';
  return { recorded: recordedHost, detected, confidence, evidence, unchecked, environmentUrl };
}

/** One-line human summary, e.g. for doctor output and configure warnings. */
export function describeDetection(d: DeployDetection): string {
  if (!d.detected) return 'no deploy-host evidence found';
  const reasons = d.evidence
    .filter((e) => e.host === d.detected)
    .map((e) => e.detail)
    .join('; ');
  return `${d.detected} (${d.confidence} confidence: ${reasons})`;
}
