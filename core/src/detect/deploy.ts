import { pathExists, type RepoReader } from '../repo-reader.js';

/**
 * Evidence for where a repository's production deploys, from the files it commits (ported from the
 * CLI's `deploy-detect.ts`, DevAudit-Installer#1040 and #1116 WP3). The CLI adds the GitHub
 * deployments signal on top, because that needs `gh`; this module is the part that needs only files,
 * and the ranking of any evidence.
 */

export type DetectedHost = 'railway' | 'vercel' | 'custom';

export interface DeployEvidence {
  readonly host: DetectedHost;
  readonly source: 'deployments' | 'file';
  readonly detail: string;
  readonly weight: number;
}

export type DeployConfidence = 'high' | 'medium' | 'low' | 'none';

/** Host config files: [path, host, description, weight]. */
export const HOST_FILE_SIGNALS: ReadonlyArray<readonly [string, DetectedHost, string, number]> = [
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

/** The host evidence the committed files give. */
export async function hostEvidenceFromFiles(reader: RepoReader): Promise<DeployEvidence[]> {
  const evidence: DeployEvidence[] = [];
  for (const [path, host, detail, weight] of HOST_FILE_SIGNALS) {
    if (await pathExists(reader, path)) evidence.push({ host, source: 'file', detail, weight });
  }
  return evidence;
}

/**
 * The host with the most evidence and how sure that is: `high` when GitHub deployments back it,
 * `medium` from files alone, `low` when the runner-up is close, `none` without evidence.
 */
export function rankHostEvidence(evidence: readonly DeployEvidence[]): {
  readonly detected: DetectedHost | null;
  readonly confidence: DeployConfidence;
} {
  const totals = new Map<DetectedHost, number>();
  for (const e of evidence) totals.set(e.host, (totals.get(e.host) ?? 0) + e.weight);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) return { detected: null, confidence: 'none' };
  const [detected, score] = top;
  const runnerUp = ranked[1]?.[1] ?? 0;
  const fromDeployments = evidence.some((e) => e.host === detected && e.source === 'deployments');
  const confidence: DeployConfidence = runnerUp > 0 && score - runnerUp < 3 ? 'low' : fromDeployments ? 'high' : 'medium';
  return { detected, confidence };
}
