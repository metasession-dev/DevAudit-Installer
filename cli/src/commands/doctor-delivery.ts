import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Remediation } from '@metasession.co/devaudit-core';
import { defaultGh, type GhRunner } from '../lib/deploy-detect.js';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import {
  DELIVERY_AGENT_API_SECRET,
  DELIVERY_AGENT_GITHUB_SECRET,
  DELIVERY_AGENT_PORTAL_SECRET,
  DELIVERY_CLAUDE_CODE_VERSION,
  DELIVERY_GITHUB_TOKEN_SOURCES,
  type DeliveryGithubTokenSource,
  DELIVERY_PROMPT_FILE,
  DELIVERY_WORKFLOW_FILE,
} from '../lib/delivery.js';

/**
 * DevAudit-Installer#1272 — `delivery-workflow`: a repository that accepts DevAudit Delivery runs
 * (`delivery.enabled`) has the workflow the portal dispatches, its prompt file, the two repository secrets the run
 * reads, and the Claude Code version the CLI generates. Reported only while `delivery.enabled` is true; absent
 * otherwise, so a repository without delivery sees no new check. Names only: it never reads a secret's value.
 * Without a GitHub CLI session that can list secrets it skips the secret part and says so. Every finding is guidance
 * (tier C): `devaudit update` regenerates the files, `gh secret set` stores the secrets.
 */

export interface DeliveryWorkflowDeps {
  readonly gh?: GhRunner;
}

const guidance = (id: string, summary: string, plan: string[]): Remediation => ({ id, tier: 'C', summary, plan, needsPortal: false });

const PINNED = /@anthropic-ai\/claude-code@([0-9A-Za-z.+-]+)/;

export async function deliveryWorkflowCheck(
  consumer: { readonly repoRoot: string; readonly cfg: Record<string, unknown> },
  deps: DeliveryWorkflowDeps = {},
): Promise<CheckResult | null> {
  const name = 'delivery-workflow';
  const delivery = (consumer.cfg['delivery'] ?? {}) as { enabled?: unknown };
  if (delivery.enabled !== true) return null;

  const findings: Finding[] = [];
  // #1286: the agent's GitHub token must come from the secret or the portal's App; a repository that names neither cannot start CI from a run.
  const rawSource = (consumer.cfg['delivery'] as { github_token_source?: unknown } | undefined)?.github_token_source;
  const source = (DELIVERY_GITHUB_TOKEN_SOURCES as readonly unknown[]).includes(rawSource) ? (rawSource as DeliveryGithubTokenSource) : null;
  if (source === null) {
    findings.push({
      subject: 'token-source',
      detail: `delivery.github_token_source is ${rawSource === undefined ? 'not set' : JSON.stringify(rawSource)}; it must be secret (a machine user's token in ${DELIVERY_AGENT_GITHUB_SECRET}) or app (the portal's DevAudit Agent GitHub App). Without a token of its own a run's pushes start no CI.`,
      remediation: guidance('set-github-token-source', 'Choose where the delivery agent gets its GitHub token', [
        'devaudit configure set delivery.github_token_source app      (the portal mints a token from the DevAudit Agent GitHub App; install the App on this repository)',
        `devaudit configure set delivery.github_token_source secret   (a machine user's fine-grained token in the repository secret ${DELIVERY_AGENT_GITHUB_SECRET})`,
      ]),
    });
  }
  const workflow = await fs.readFile(join(consumer.repoRoot, '.github', 'workflows', DELIVERY_WORKFLOW_FILE), 'utf-8').catch(() => null);
  if (workflow === null) {
    findings.push({
      subject: 'workflow-missing',
      detail: `delivery.enabled is true but .github/workflows/${DELIVERY_WORKFLOW_FILE} does not exist, so the portal's dispatch starts nothing.`,
      remediation: guidance('regenerate-delivery-workflow', 'Generate the delivery workflow', ['devaudit update   (on a fix branch; the workflow must then reach the default branch for the portal to dispatch it)']),
    });
  } else {
    // A workflow from before #1286 falls back to the default token, which starts no CI.
    if (/\|\|\s*(github\.token|secrets\.GITHUB_TOKEN)/.test(workflow) || !workflow.includes('delivery github-token')) {
      findings.push({
        subject: 'workflow-token-stale',
        detail: 'the delivery workflow does not resolve the agent\'s GitHub token with `devaudit delivery github-token`, or falls back to the default token. A push made with the default token starts no CI, so the release\'s checks would never run.',
        remediation: guidance('regenerate-delivery-workflow', 'Regenerate the delivery workflow', ['devaudit update   (on a fix branch)']),
      });
    }
    const pinned = PINNED.exec(workflow)?.[1];
    if (pinned !== DELIVERY_CLAUDE_CODE_VERSION) {
      findings.push({
        subject: 'claude-code-version',
        detail: `the delivery workflow installs Claude Code ${pinned ?? '(no pinned version)'}; this CLI generates ${DELIVERY_CLAUDE_CODE_VERSION}.`,
        remediation: guidance('regenerate-delivery-workflow', 'Regenerate the delivery workflow', ['devaudit update   (on a fix branch)']),
      });
    }
  }
  const prompt = await fs.readFile(join(consumer.repoRoot, DELIVERY_PROMPT_FILE), 'utf-8').catch(() => null);
  if (prompt === null) {
    findings.push({
      subject: 'prompt-missing',
      detail: `${DELIVERY_PROMPT_FILE} does not exist; the headless session has no prompt to run.`,
      remediation: guidance('regenerate-delivery-workflow', 'Regenerate the delivery prompt', ['devaudit update   (on a fix branch)']),
    });
  }

  const gh = deps.gh ?? defaultGh;
  const listed = await gh(['secret', 'list', '--json', 'name'], consumer.repoRoot);
  let secretNote = '';
  if (listed.exitCode === 0) {
    let names: string[] = [];
    try {
      const parsed: unknown = JSON.parse(listed.stdout);
      if (Array.isArray(parsed)) names = parsed.map((x) => (x as { name?: unknown }).name).filter((n): n is string => typeof n === 'string');
    } catch {
      names = [];
    }
    if (source === 'secret' && !names.includes(DELIVERY_AGENT_GITHUB_SECRET)) {
      findings.push({
        subject: 'token-secret-missing',
        detail: `delivery.github_token_source is secret, but the repository secret ${DELIVERY_AGENT_GITHUB_SECRET} is not set. The workflow would ask the portal's GitHub App instead, and fails when the App is not installed.`,
        remediation: guidance('set-delivery-secret', `Set ${DELIVERY_AGENT_GITHUB_SECRET}`, [
          `gh secret set ${DELIVERY_AGENT_GITHUB_SECRET}   (a machine user's fine-grained token with Contents and Pull requests read/write and Issues read on this repository; you are prompted for the value)`,
          'or: devaudit configure set delivery.github_token_source app   (and install the DevAudit Agent GitHub App on this repository)',
        ]),
      });
    }
    const missing = [DELIVERY_AGENT_API_SECRET, DELIVERY_AGENT_PORTAL_SECRET].filter((secret) => !names.includes(secret));
    if (missing.length > 0) {
      findings.push({
        subject: 'secret-missing',
        detail: `the repository secret${missing.length > 1 ? 's' : ''} ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set, so a delivery run stops at its first step.`,
        remediation: guidance('set-delivery-secret', `Set ${missing.join(' and ')}`, [
          ...(missing.includes(DELIVERY_AGENT_PORTAL_SECRET) ? [`devaudit install --delivery   (issues the delivery-agent portal key and stores it as ${DELIVERY_AGENT_PORTAL_SECRET})`] : []),
          ...(missing.includes(DELIVERY_AGENT_API_SECRET) ? [`gh secret set ${DELIVERY_AGENT_API_SECRET}   (you are prompted for the value; it is never printed here)`] : []),
        ]),
      });
    }
  } else {
    secretNote = '; the secrets were not checked (the GitHub CLI cannot list them here)';
  }

  if (findings.length === 0) {
    const tokenNote = source === 'app' ? "; the agent's GitHub token is minted by the portal's GitHub App at run time (the portal checks the installation when it starts a run)" : `; the agent's GitHub token is the secret ${DELIVERY_AGENT_GITHUB_SECRET}`;
    return { name, ok: true, detail: `delivery workflow, prompt and secrets present; Claude Code ${DELIVERY_CLAUDE_CODE_VERSION}${tokenNote}${secretNote}`, suspectedOrigin: 'consumer-drift' };
  }
  return { name, ok: false, detail: `${findings.length} gap(s) a delivery run would stop at${secretNote}`, suspectedOrigin: 'consumer-drift', findings };
}
