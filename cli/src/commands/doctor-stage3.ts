import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Remediation } from '@metasession.co/devaudit-core';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import { readPendingTickets } from '../lib/release-tickets.js';

/**
 * DevAudit-Installer#1215 — `stage3-evidence`: an early, local warning for what the
 * release PR's `Compliance Validation` would otherwise report first. For each pending,
 * not-deferred release ticket it reports Stage 3 operator sign-offs that are still pending
 * (the rules of `scripts/check-operator-signoffs.sh`, #1200/#1211) and a missing human UAT
 * pack when `uat.human_pack` requires one (#1198/#1215). Static, no portal call, and never
 * gating: it is an onboarding-style check whose findings are guidance.
 */

export const STAGE3_EVIDENCE_FINDINGS = ['signoff-pending', 'uat-pack-missing'] as const;

export interface PendingSignoff {
  readonly file: string;
  readonly unticked: number;
  readonly reviewerMissing: boolean;
  readonly dateMissing: boolean;
}

const fieldValue = (line: string, name: string): string | null => {
  const t = line.trim();
  for (const prefix of [`**${name}:**`, `**${name}**:`, `${name}:`]) {
    if (t.startsWith(prefix)) return t.slice(prefix.length).trim();
  }
  return null;
};

const reviewerIsReal = (v: string): boolean => {
  if (v === '' || /^pending/i.test(v)) return false;
  if (v.includes('<operator-name>')) return false;
  if (v.startsWith('<') && v.endsWith('>')) return false;
  return true;
};

/** The `## Operator sign-off` block of one artefact, or null when the file has none or it is complete. */
export function pendingSignoffIn(file: string, text: string): PendingSignoff | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.startsWith('## Operator sign-off'));
  if (start < 0) return null;
  let unticked = 0;
  let reviewerOk = false;
  let dateOk = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.trim().startsWith('- [ ]')) {
      unticked += 1;
      continue;
    }
    const reviewer = fieldValue(line, 'Reviewer');
    if (reviewer !== null) {
      if (reviewerIsReal(reviewer)) reviewerOk = true;
      continue;
    }
    const date = fieldValue(line, 'Date');
    if (date !== null && /^\d{4}-\d{2}-\d{2}/.test(date)) dateOk = true;
  }
  if (unticked === 0 && reviewerOk && dateOk) return null;
  return { file, unticked, reviewerMissing: !reviewerOk, dateMissing: !dateOk };
}

/** The RTM `Risk` cell for a requirement, or '' when the table has no Risk column or no row for it. */
export function rtmRisk(rtm: string, req: string): string {
  let riskIdx = -1;
  let idIdx = 0;
  for (const line of rtm.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const r = cells.findIndex((c) => c.toLowerCase() === 'risk');
    if (r >= 0) {
      riskIdx = r;
      const id = cells.findIndex((c) => /^(req-id|id)$/i.test(c));
      idIdx = id >= 0 ? id : 0;
      continue;
    }
    if (riskIdx >= 0 && cells[idIdx] === req) return cells[riskIdx] ?? '';
  }
  return '';
}

const guidance = (id: string, summary: string, plan: string[]): Remediation => ({ id, tier: 'C', summary, plan, needsPortal: false });

export async function stage3EvidenceCheck(consumer: { readonly repoRoot: string; readonly cfg: Record<string, unknown> }): Promise<CheckResult> {
  const name = 'stage3-evidence';
  const tickets = ((await readPendingTickets(consumer.repoRoot)) ?? []).filter((t) => !t.deferred);
  if (tickets.length === 0) {
    return { name, ok: true, detail: 'no pending release ticket (nothing to check)', suspectedOrigin: 'consumer-drift' };
  }
  const uat = (consumer.cfg['uat'] ?? {}) as { human_pack?: unknown };
  const mode = uat.human_pack === 'always' || uat.human_pack === 'never' ? uat.human_pack : 'risk';
  const rtm = await fs.readFile(join(consumer.repoRoot, 'compliance', 'RTM.md'), 'utf-8').catch(() => '');
  const findings: Finding[] = [];

  for (const ticket of tickets) {
    const req = ticket.version;
    const dir = join(consumer.repoRoot, 'compliance', 'evidence', req);
    const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md')).sort();

    const pending: PendingSignoff[] = [];
    for (const n of names) {
      const text = await fs.readFile(join(dir, n), 'utf-8').catch(() => '');
      const p = pendingSignoffIn(`compliance/evidence/${req}/${n}`, text);
      if (p) pending.push(p);
    }
    if (pending.length > 0) {
      const list = pending
        .map((p) => `${p.file} (${p.unticked} unticked box(es)${p.reviewerMissing ? ', reviewer missing' : ''}${p.dateMissing ? ', date missing' : ''})`)
        .join('; ');
      findings.push({
        subject: `${req}: signoff-pending`,
        detail: `${req} has ${pending.length} Stage 3 operator sign-off(s) still pending: ${list}. The release PR's Compliance Validation fails until they are signed.`,
        remediation: guidance('collect-stage3-signoffs', 'Collect the Stage 3 sign-offs', [
          `resume ${req} with the sdlc-implementer skill: Phase 3 step 5d asks for one reply (approved / updated and approved / changes)`,
          `or review each file yourself, tick the boxes that apply (mark one that does not apply \`- [~]\`), fill Reviewer and Date, and check with \`bash scripts/check-operator-signoffs.sh ${req}\``,
        ]),
      });
    }

    const risk = rtmRisk(rtm, req);
    const required = mode === 'always' || (mode === 'risk' && /MEDIUM|HIGH|CRITICAL/i.test(risk));
    if (required) {
      const missing = ['uat-briefing.md', 'uat-test-procedure.md'].filter((f) => !names.includes(f));
      if (missing.length > 0) {
        findings.push({
          subject: `${req}: uat-pack-missing`,
          detail: `${req} needs the human UAT pack (${mode === 'always' ? 'uat.human_pack: always' : `risk ${risk}`}) and is missing ${missing.join(', ')}. The release PR's Compliance Validation fails until it is written.`,
          remediation: guidance('write-uat-pack', 'Write the human UAT pack', [
            `resume ${req} with the sdlc-implementer skill: Phase 3 step 3c writes it from the templates in its references/`,
            'or, if this project does not need it, `devaudit configure set uat.human_pack never`',
          ]),
        });
      }
    }
  }

  if (findings.length === 0) {
    return { name, ok: true, detail: `${tickets.length} pending release(s): sign-offs complete, UAT pack present where required`, suspectedOrigin: 'consumer-drift' };
  }
  return {
    name,
    ok: false,
    detail: `${findings.length} Stage 3 evidence gap(s) a release PR would fail on`,
    suspectedOrigin: 'consumer-drift',
    findings,
  };
}
