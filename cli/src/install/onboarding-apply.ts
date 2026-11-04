import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { deleteConfigPath, setConfigPath } from '../lib/config-path.js';
import { claimStandard, setApprovalPolicy, type FetchLike } from '../lib/onboarding-portal.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import type { Asker } from './test-config.js';
import type { InstallContext, InstallPlan, StepResult } from './types.js';

const STEP = '6/12 Approval policy and standards';

export interface ApplyDeps {
  readonly fetchImpl?: FetchLike;
  readonly ask?: Pick<Asker, 'confirm'>;
}

/**
 * The portal writes of the guided onboarding (devaudit-installer#1116 WP6, tier B): the project's
 * approval policy and the standards it claims. Runs after the project exists. A portal that does not
 * have the feature answers with "unavailable"; install then says so in one line and carries on, and a
 * solo approval mode the portal would not accept is reverted to the safe default so the repository never
 * says "I approve my own" while the portal still blocks it.
 */
export async function applyOnboardingPortal(ctx: InstallContext, plan: InstallPlan, deps: ApplyDeps = {}): Promise<StepResult> {
  const onboarding = plan.onboarding;
  if (ctx.installMode === 'developer' || !onboarding) {
    return { step: STEP, status: 'skipped', message: ctx.installMode === 'developer' ? 'developer mode — leaving the project policy as it is.' : 'no preset or approval choice to apply.' };
  }
  const messages: string[] = [];
  let warn = false;
  const write = plan.projectId ? { baseUrl: ctx.baseUrl, token: ctx.token, projectId: plan.projectId, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) } : null;

  if (onboarding.policyToSet !== null) {
    const label = onboarding.policyToSet === 'self_allowed_with_gap' ? 'self-approval with a recorded gap' : 'approval by a different person';
    if (ctx.dryRun) {
      messages.push(`would set the portal approval policy to ${label}`);
    } else if (write === null) {
      messages.push('no portal project id, so the approval policy was not set');
      warn = true;
    } else {
      const result = await setApprovalPolicy(write, onboarding.policyToSet, `Set by devaudit install (preset ${onboarding.preset ?? 'none'})`);
      if (result.ok) {
        messages.push(`portal approval policy set to ${label}`);
      } else {
        warn = true;
        if (onboarding.policyToSet === 'self_allowed_with_gap') {
          await revertToDualActor(ctx);
          messages.push(
            `the portal did not accept the approval policy (${result.message}); this portal does not yet allow a solo approver or you are not a project admin, so the repository keeps "approved by a different person" and records preset custom. Ask the portal's operator to upgrade, then run \`devaudit configure\`.`,
          );
        } else {
          messages.push(`the portal did not accept the approval policy (${result.message}); it is unchanged.`);
        }
      }
    }
  }

  if (onboarding.frameworks.length > 0) {
    const have = new Set(onboarding.portalStandards ?? []);
    const missing = onboarding.frameworks.filter((f) => !have.has(f));
    if (onboarding.portalStandards === null) {
      messages.push('standards are saved in sdlc-config.json; claiming them on the portal needs a portal that supports it.');
    } else if (missing.length > 0) {
      if (ctx.dryRun) {
        messages.push(`would claim ${missing.join(', ')} on the portal`);
      } else if (write === null || ctx.nonInteractive || !deps.ask || !(await deps.ask.confirm(`Claim ${missing.join(', ')} on the portal for this project?`, true))) {
        messages.push(`standards not claimed on the portal (${missing.join(', ')}); claim them in the portal's project settings.`);
      } else {
        for (const code of missing) {
          // eslint-disable-next-line no-await-in-loop
          const r = await claimStandard(write, code);
          messages.push(r.ok ? `claimed ${code} on the portal` : `could not claim ${code} (${r.message})`);
          if (!r.ok) warn = true;
        }
      }
    }
  }

  if (messages.length === 0) return { step: STEP, status: 'skipped', message: 'nothing to change on the portal.' };
  return { step: STEP, status: warn ? 'warn' : ctx.dryRun ? 'planned' : 'ok', message: messages.join('; ') };
}

async function revertToDualActor(ctx: InstallContext): Promise<void> {
  const existing = (await readSdlcConfig(ctx.repoRoot)) as unknown as Record<string, unknown> | null;
  if (existing === null) return;
  let next = setConfigPath(existing, 'approval.mode', 'dual_actor');
  next = deleteConfigPath(next, 'release_branch_required_reviews');
  next = setConfigPath(next, 'onboarding_preset', 'custom');
  await fs.writeFile(join(ctx.repoRoot, 'sdlc-config.json'), JSON.stringify(next, null, 2) + '\n', 'utf-8');
}
