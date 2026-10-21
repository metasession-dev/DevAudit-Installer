import type { CheckResult, Finding } from '../lib/doctor-types.js';
import { detectDeployHost, describeDetection, defaultGh, type DeployDetection, type GhRunner } from '../lib/deploy-detect.js';
import { SECRET_NAME } from '../lib/repo-config-keys.js';
import { e2eReleaseGateCheck, testTiersCheck, type CommandRunner } from './doctor-tiers.js';

/**
 * devaudit-installer#1040 — doctor checks for a consumer's deploy and CI
 * settings: does `sdlc-config.json` match what the repo actually does, and is
 * everything the recorded host needs in place? Non-gating, like the other
 * onboarding checks. A `deploy-host` mismatch carries a tier A `set-config`
 * remediation that `doctor --fix` applies through `devaudit configure`'s
 * validation; the rest are guidance (tier C) naming the `configure` command.
 */

export interface ConfigCheckDeps {
  readonly gh?: GhRunner;
  /** HEAD request status for a URL, or null when unreachable (test seam). */
  readonly probe?: (url: string) => Promise<number | null>;
  readonly detection?: DeployDetection;
  /** Runs a collect-only test command (test seam for the `test-tiers` check). */
  readonly run?: CommandRunner;
}

export const PROBE_HEADER_SECRET = 'DEVAUDIT_PROBE_HEADER';
const GITHUB_HOSTED = /^(ubuntu|windows|macos)-/;

async function defaultProbe(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return res.status;
  } catch {
    return null;
  }
}

async function repoSecretNames(repoRoot: string, gh: GhRunner): Promise<string[] | null> {
  const r = await gh(['secret', 'list', '--json', 'name'], repoRoot);
  if (r.exitCode !== 0) return null;
  try {
    return (JSON.parse(r.stdout) as Array<{ name: string }>).map((s) => s.name);
  } catch {
    return null;
  }
}

const guidance = (id: string, summary: string, plan: string[]): Finding['remediation'] => ({
  id,
  tier: 'C',
  summary,
  plan,
  needsPortal: false,
});

export async function runConfigChecks(
  repoRoot: string,
  cfg: Record<string, unknown>,
  deps: ConfigCheckDeps = {},
): Promise<readonly CheckResult[]> {
  const gh = deps.gh ?? defaultGh;
  const probe = deps.probe ?? defaultProbe;
  const host = typeof cfg['host'] === 'string' && cfg['host'] !== '' ? (cfg['host'] as string) : 'railway';
  const detection = deps.detection ?? (await detectDeployHost(repoRoot, host, { gh }));
  const secrets = await repoSecretNames(repoRoot, gh);
  return [
    deployHostCheck(host, detection),
    await productionUrlCheck(cfg, secrets, detection, probe),
    customDeployCheck(host, cfg, secrets),
    await ciRunnerCheck(repoRoot, cfg, gh),
    // devaudit-installer#1059/#1060: the release gate and the test tiers. Appended so existing order is unchanged.
    await e2eReleaseGateCheck(repoRoot, cfg, gh),
    await testTiersCheck(repoRoot, cfg, gh, deps.run),
  ];
}

export function deployHostCheck(host: string, detection: DeployDetection): CheckResult {
  const name = 'deploy-host';
  const note = detection.unchecked.length > 0 ? ` (not checked: ${detection.unchecked.join('; ')})` : '';
  if (!detection.detected) {
    return { name, ok: true, detail: `host: ${host}; no deploy evidence found to compare${note}`, suspectedOrigin: 'consumer-drift' };
  }
  if (detection.detected === host) {
    return { name, ok: true, detail: `host: ${host}, matching ${describeDetection(detection)}`, suspectedOrigin: 'consumer-drift' };
  }
  if (detection.confidence === 'low') {
    return {
      name,
      ok: true,
      detail: `host: ${host}; evidence is mixed (${describeDetection(detection)}) — confirm with \`devaudit configure get host\`${note}`,
      suspectedOrigin: 'consumer-drift',
    };
  }
  const detail = `sdlc-config.json says host \`${host}\`, but this repo deploys with ${describeDetection(detection)}`;
  return {
    name,
    ok: false,
    detail,
    suspectedOrigin: 'consumer-drift',
    findings: [
      {
        subject: 'host',
        detail,
        remediation: {
          id: 'set-config',
          tier: 'A',
          summary: `Set host to ${detection.detected} in sdlc-config.json`,
          plan: [`devaudit configure set host ${detection.detected}`, 'devaudit update'],
          needsPortal: false,
          data: { key: 'host', value: detection.detected },
        },
      },
    ],
  };
}

export async function productionUrlCheck(
  cfg: Record<string, unknown>,
  secrets: readonly string[] | null,
  detection: DeployDetection,
  probe: (url: string) => Promise<number | null>,
): Promise<CheckResult> {
  const name = 'production-url';
  const secret = cfg['production_url_secret'];
  if (typeof secret !== 'string' || secret === '') {
    const detail = '`production_url_secret` is not set: the post-deploy health probe and smoke checks have no URL';
    return {
      name,
      ok: false,
      detail,
      suspectedOrigin: 'consumer-drift',
      findings: [{ subject: 'production_url_secret', detail, remediation: guidance('set-production-url', 'Name the production URL secret', ['devaudit configure set production_url_secret <SECRET_NAME>', 'devaudit configure secret <SECRET_NAME>']) }],
    };
  }
  const findings: Finding[] = [];
  if (secrets && !secrets.includes(secret)) {
    findings.push({
      subject: secret,
      detail: `repo secret ${secret} (production_url_secret) is missing`,
      remediation: guidance('add-secret', `Add the repo secret ${secret}`, [`devaudit configure secret ${secret}`]),
    });
  }
  let probeNote = '';
  if (detection.environmentUrl) {
    const status = await probe(detection.environmentUrl);
    if (status === 401 || status === 403 || status === 407) {
      if (secrets && !secrets.includes(PROBE_HEADER_SECRET)) {
        findings.push({
          subject: PROBE_HEADER_SECRET,
          detail: `the latest production deployment (${detection.environmentUrl}) answers ${status} to an unauthenticated request, so the post-deploy probe will fail; set ${PROBE_HEADER_SECRET} (e.g. "x-vercel-protection-bypass: <token>")`,
          remediation: guidance('add-probe-header', `Add the repo secret ${PROBE_HEADER_SECRET}`, [`devaudit configure secret ${PROBE_HEADER_SECRET}`]),
        });
      } else probeNote = `; production answers ${status}, probe header configured`;
    } else if (status !== null) probeNote = `; latest production deployment answers ${status}`;
  }
  if (findings.length > 0) {
    return { name, ok: false, detail: findings.map((f) => f.detail).join('; '), suspectedOrigin: 'consumer-drift', findings };
  }
  const known = secrets ? `repo secret ${secret} present` : `secret ${secret} (repo secrets not readable: gh unauthenticated?)`;
  return { name, ok: true, detail: `${known}${probeNote}`, suspectedOrigin: 'consumer-drift' };
}

export function customDeployCheck(host: string, cfg: Record<string, unknown>, secrets: readonly string[] | null): CheckResult {
  const name = 'custom-deploy';
  if (host !== 'custom') return { name, ok: true, detail: `skipped (host ${host})`, suspectedOrigin: 'consumer-drift' };
  const findings: Finding[] = [];
  const cmd = cfg['deploy_command'];
  if (typeof cmd !== 'string' || cmd.trim() === '') {
    findings.push({
      subject: 'deploy_command',
      detail: '`deploy_command` is not set: deploy-custom.yml fails every run',
      remediation: guidance('set-deploy-command', 'Set the deploy command', ['devaudit configure set deploy_command "<command>"']),
    });
  }
  const list = Array.isArray(cfg['deploy_secrets']) ? (cfg['deploy_secrets'] as unknown[]) : [];
  for (const s of list) {
    if (typeof s !== 'string' || !SECRET_NAME.test(s)) {
      findings.push({ subject: 'deploy_secrets', detail: `deploy_secrets entry ${JSON.stringify(s)} is not a valid secret name and is ignored`, remediation: guidance('fix-deploy-secrets', 'Fix deploy_secrets', ['devaudit configure set deploy_secrets <NAME,NAME>']) });
    } else if (secrets && !secrets.includes(s)) {
      findings.push({ subject: s, detail: `repo secret ${s} (deploy_secrets) is missing`, remediation: guidance('add-secret', `Add the repo secret ${s}`, [`devaudit configure secret ${s}`]) });
    }
  }
  const shaUrl = cfg['deployed_sha_url'];
  if (typeof shaUrl === 'string' && shaUrl !== '' && !/^https:\/\//.test(shaUrl)) {
    findings.push({ subject: 'deployed_sha_url', detail: '`deployed_sha_url` must be an https:// URL', remediation: guidance('fix-deployed-sha-url', 'Fix deployed_sha_url', ['devaudit configure set deployed_sha_url https://...']) });
  }
  const trigger = cfg['deploy_trigger'];
  if (trigger !== undefined && !['push_to_main', 'git_tag', 'manual'].includes(String(trigger))) {
    findings.push({ subject: 'deploy_trigger', detail: '`deploy_trigger` must be push_to_main, git_tag or manual', remediation: guidance('fix-deploy-trigger', 'Fix deploy_trigger', ['devaudit configure set deploy_trigger push_to_main']) });
  }
  if (findings.length > 0) {
    return { name, ok: false, detail: findings.map((f) => f.detail).join('; '), suspectedOrigin: 'consumer-drift', findings };
  }
  const verify = typeof shaUrl === 'string' && shaUrl !== '' ? 'running SHA verified via deployed_sha_url' : 'no deployed_sha_url: deploy is verified by a health check only (weaker)';
  return { name, ok: true, detail: `deploy_command set; ${verify}`, suspectedOrigin: 'consumer-drift' };
}

export async function ciRunnerCheck(repoRoot: string, cfg: Record<string, unknown>, gh: GhRunner): Promise<CheckResult> {
  const name = 'ci-runner';
  const runner = typeof cfg['runner'] === 'string' && cfg['runner'].trim() !== '' ? (cfg['runner'] as string) : 'self-hosted';
  let label = runner;
  let how = `runner: ${runner}`;
  if (runner === 'self-hosted') {
    const vars = await gh(['variable', 'list', '--json', 'name,value'], repoRoot);
    let repoLabel: string | undefined;
    if (vars.exitCode === 0) {
      try {
        repoLabel = (JSON.parse(vars.stdout) as Array<{ name: string; value: string }>).find((v) => v.name === 'CI_RUNNER_LABEL')?.value;
      } catch {
        // treat as unset
      }
    }
    label = repoLabel && repoLabel !== '' ? repoLabel : 'github-ci';
    how = repoLabel
      ? `runner: self-hosted -> CI_RUNNER_LABEL=${repoLabel}`
      : 'runner: self-hosted -> CI_RUNNER_LABEL not set on the repo (an organization value may apply), defaulting to github-ci';
  }
  if (label === 'github-ci' || GITHUB_HOSTED.test(label)) {
    return { name, ok: true, detail: `${how} (GitHub-hosted)`, suspectedOrigin: 'consumer-drift' };
  }
  const runners = await gh(['api', 'repos/{owner}/{repo}/actions/runners?per_page=100'], repoRoot);
  if (runners.exitCode !== 0) {
    return { name, ok: true, detail: `${how}; registered runners not visible (repo admin needed, or organization runners) — not checked`, suspectedOrigin: 'unknown' };
  }
  try {
    const list = (JSON.parse(runners.stdout) as { runners?: Array<{ status: string; labels: Array<{ name: string }> }> }).runners ?? [];
    const matching = list.filter((r) => r.labels.some((l) => l.name === label));
    if (matching.length === 0) {
      const detail = `${how}, but no repository runner carries the label \`${label}\`; jobs will queue unless an organization runner has it`;
      return {
        name,
        ok: false,
        detail,
        suspectedOrigin: 'consumer-drift',
        findings: [{ subject: 'runner', detail, remediation: guidance('fix-runner', 'Point CI at a runner that exists', ['devaudit configure set runner ubuntu-latest', 'or register a runner with that label, or set the CI_RUNNER_LABEL variable']) }],
      };
    }
    const online = matching.filter((r) => r.status === 'online').length;
    return { name, ok: true, detail: `${how}; ${matching.length} runner(s) with label \`${label}\`, ${online} online`, suspectedOrigin: 'consumer-drift' };
  } catch {
    return { name, ok: true, detail: `${how}; runner list unreadable — not checked`, suspectedOrigin: 'unknown' };
  }
}
