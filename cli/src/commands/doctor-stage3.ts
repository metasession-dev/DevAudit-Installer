import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Remediation } from '@metasession.co/devaudit-core';
import type { CheckResult, Finding } from '../lib/doctor-types.js';
import { archivedTicketDir, readBundleManifests, readPendingTickets } from '../lib/release-tickets.js';

/**
 * DevAudit-Installer#1215 — `stage3-evidence`: an early, local warning for what the
 * release PR's `Compliance Validation` would otherwise report first. For each pending,
 * not-deferred release ticket it reports Stage 3 operator sign-offs that are still pending
 * (the rules of `scripts/check-operator-signoffs.sh`, #1200/#1211) and a missing human UAT
 * pack when `uat.human_pack` requires one (#1198/#1215). Static, no portal call, and never
 * gating: it is an onboarding-style check whose findings are guidance.
 */

export const STAGE3_EVIDENCE_FINDINGS = ['signoff-pending', 'uat-pack-missing', 'uat.human_pack', 'uat.mode', 'uat.mode-independence'] as const;

const HUMAN_PACK_MODES = ['risk', 'always', 'never'] as const;
const UAT_MODES = ['manual', 'auto'] as const;
/** An RTM status that means the REQ is done (the validator's #1210 rule). */
const TERMINAL_STATUS = /APPROVED|RELEASED|SUPERSEDED|ABANDONED/;

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
  return rtmCell(rtm, req, 'risk');
}

/** One RTM cell (`column` matched case-insensitively) for a requirement, or '' when absent. */
export function rtmCell(rtm: string, req: string, column: string): string {
  let colIdx = -1;
  let idIdx = 0;
  for (const line of rtm.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const r = cells.findIndex((c) => c.toLowerCase() === column.toLowerCase());
    if (r >= 0) {
      colIdx = r;
      const id = cells.findIndex((c) => /^(req-id|id)$/i.test(c));
      idIdx = id >= 0 ? id : 0;
      continue;
    }
    if (colIdx >= 0 && cells[idIdx] === req) return cells[colIdx] ?? '';
  }
  return '';
}

const guidance = (id: string, summary: string, plan: string[]): Remediation => ({ id, tier: 'C', summary, plan, needsPortal: false });

export async function stage3EvidenceCheck(consumer: { readonly repoRoot: string; readonly cfg: Record<string, unknown> }): Promise<CheckResult> {
  const name = 'stage3-evidence';
  const rtm = await fs.readFile(join(consumer.repoRoot, 'compliance', 'RTM.md'), 'utf-8').catch(() => '');
  // #1227: a leftover pending copy of a ticket that is already released is not in flight (the validator skips it, #1210).
  const tickets: { version: string }[] = [];
  for (const t of ((await readPendingTickets(consumer.repoRoot)) ?? []).filter((t) => !t.deferred)) {
    if ((await archivedTicketDir(consumer.repoRoot, t.version)) !== null) continue;
    if (TERMINAL_STATUS.test(rtmCell(rtm, t.version, 'status'))) continue;
    tickets.push(t);
  }
  const uat = (consumer.cfg['uat'] ?? {}) as { human_pack?: unknown; mode?: unknown };
  const findings: Finding[] = [];
  // #1227: a hand-edited value the validator would read as `risk`.
  const rawMode = uat.human_pack;
  const mode = rawMode === 'always' || rawMode === 'never' ? rawMode : 'risk';
  if (rawMode !== undefined && !(HUMAN_PACK_MODES as readonly unknown[]).includes(rawMode)) {
    findings.push({
      subject: 'uat.human_pack',
      detail: `uat.human_pack is ${JSON.stringify(rawMode)} in sdlc-config.json; expected risk, always or never. It is read as risk.`,
      remediation: {
        id: 'set-config',
        tier: 'A',
        summary: 'Set uat.human_pack to risk (the default)',
        plan: ['devaudit configure set uat.human_pack risk'],
        needsPortal: false,
        data: { key: 'uat.human_pack', value: 'risk' },
      },
    });
  }
  // #1246: `uat.mode` is manual or auto; anything else is read as manual.
  if (uat.mode !== undefined && !(UAT_MODES as readonly unknown[]).includes(uat.mode)) {
    findings.push({
      subject: 'uat.mode',
      detail: `uat.mode is ${JSON.stringify(uat.mode)} in sdlc-config.json; expected manual or auto. It is read as manual.`,
      remediation: {
        id: 'set-config',
        tier: 'A',
        summary: 'Set uat.mode to manual (the default)',
        plan: ['devaudit configure set uat.mode manual'],
        needsPortal: false,
        data: { key: 'uat.mode', value: 'manual' },
      },
    });
  }
  // #1246: agent-executed UAT leans on an independent human reviewer; with solo_with_gap there is none.
  const approvalMode = ((consumer.cfg['approval'] ?? {}) as { mode?: unknown }).mode;
  if (uat.mode === 'auto' && mode !== 'never' && approvalMode === 'solo_with_gap') {
    findings.push({
      subject: 'uat.mode-independence',
      detail:
        'uat.mode is auto and approval.mode is solo_with_gap: the agent executes the UAT procedure and the author is the only reviewer, so no one independent of the change has looked at it. The gap is recorded (control-gap risk entry and the solo sign-off on the release ticket); it is not removed.',
    });
  }
  if (tickets.length === 0 && findings.length === 0) {
    return { name, ok: true, detail: 'no pending release ticket (nothing to check)', suspectedOrigin: 'consumer-drift' };
  }
  // #1226: a declared bundle has one UAT, so a co_tracked member of a live bundle needs no pack of its own.
  const bundleCoreOf = new Map<string, string>();
  for (const manifest of await readBundleManifests(consumer.repoRoot)) {
    if ((await archivedTicketDir(consumer.repoRoot, manifest.core)) !== null) continue;
    for (const member of manifest.coTracked) if (member !== manifest.core) bundleCoreOf.set(member, manifest.core);
  }

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
    const required = !bundleCoreOf.has(req) && (mode === 'always' || (mode === 'risk' && /MEDIUM|HIGH|CRITICAL/i.test(risk)));
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
