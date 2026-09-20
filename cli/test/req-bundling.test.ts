import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// sdlc-implementer's opt-in bundling of multiple tracked REQs onto one
// shared branch/PR/release (#736), instead of forcing N full
// REQ->plan->PR->UAT->release cycles for small, independent issues.

const root = resolve(import.meta.dirname, '..', '..');
const readCommon = (relPath: string) =>
  readFileSync(resolve(root, 'sdlc/files/_common', relPath), 'utf8').replace(/\r\n/g, '\n');

describe('sdlc-implementer skill — bundle eligibility (#736)', () => {
  const skill = readCommon('skills/sdlc-implementer/SKILL.md');

  it('requires a structural declaration, never inferring from prose', () => {
    expect(skill).toContain('Bundles: #A, #B');
    expect(skill).toContain('Never infer bundle-worthiness from free prose alone');
  });

  it('rejects CRITICAL members, wide risk-tier gaps, and overlapping files', () => {
    expect(skill).toContain('any bundled issue classifies as CRITICAL risk');
    expect(skill).toContain('span more than one tier apart');
    expect(skill).toContain('touch overlapping files/logic');
  });

  it('runs bundle ceremony at the max risk class across the set', () => {
    expect(skill).toContain('Bundle-level ceremony = the max risk class across the set');
  });

  it('still runs Phase 1 steps 1-12 once per REQ inside an eligible bundle', () => {
    expect(skill).toContain('Run Phase 1 steps 1–12 once per REQ-XXX in the bundle');
    expect(skill).toContain('own plan, own AC table, own SRS-IDs, own ADR/risk assessment, own RTM row');
  });

  it('the out-of-scope list carries the bundling exception', () => {
    const idx = skill.indexOf('**Out of scope**');
    expect(idx).toBeGreaterThan(-1);
    const section = skill.slice(idx, idx + 600);
    expect(section).toContain('**unless** the operator has explicitly declared a bundle');
  });

  it('shares one branch and one PR in bundle mode, still one commit per REQ', () => {
    expect(skill).toContain('feat/bundle-<slug>');
    expect(skill).toContain('still one commit per REQ');
    expect(skill).toContain('open **one** PR');
  });

  it('the Workflow Decision template has a bundled variant surfacing the change-request-loop cost', () => {
    expect(skill).toContain('Bundled-REQs variant');
    expect(skill).toContain('the shared PR still needs full re-review');
  });
});

describe('generate-bundled-changes.sh — declared co-tracked bundle members (#736)', () => {
  const script = readCommon('scripts/generate-bundled-changes.sh');

  it('accepts --declared-bundle as an additive mode alongside predecessor absorption', () => {
    expect(script).toContain('--declared-bundle');
    expect(script).toContain('role: "co-tracked"');
    expect(script).toContain('relationship: "bundled"');
  });

  it('rejects self-inclusion and duplicate declared members', () => {
    expect(script).toContain('cannot include its own core release');
    expect(script).toContain('duplicate declared bundle member');
  });

  it('keeps co-tracked members fully evidence-isolated (no inheritance)', () => {
    expect(script).toMatch(/mode:\s*"none"/);
  });
});

describe('ci.yml.template — preserves declared co-tracked bundle members (#817)', () => {
  const template = readFileSync(resolve(root, 'sdlc/files/ci/ci.yml.template'), 'utf8').replace(
    /\r\n/g,
    '\n',
  );

  it('re-derives --declared-bundle from the already-committed manifest before regenerating', () => {
    // #817 — without this, the unconditional retroactive-scan regeneration
    // below silently overwrote a declared bundle's committed
    // BUNDLED-CHANGES-${VERSION}.json/.md with an absorption-only rescan on
    // every push. Verified manually against generate-bundled-changes.sh
    // directly: a committed manifest with role=="co-tracked" members drops
    // to zero members after one unguarded regeneration; re-passing
    // --declared-bundle (re-derived from the same file before it's
    // overwritten) preserves them, while still picking up newly-landed
    // housekeeping/predecessor absorption in the same run — a release can
    // need both kinds of bundling at once and neither may clobber the
    // other (the existing housekeeping-ride-along mechanism is a real,
    // separately-used feature and must not regress).
    expect(template).toContain("grep -q 'Co-Tracked Bundle Members' \"$BUNDLED_FILE\"");
    expect(template).toContain('select(.role == "co-tracked") | .version');
    expect(template).toContain('DECLARED_BUNDLE_ARGS=(--declared-bundle "$DECLARED_MEMBERS")');
    expect(template).toContain('"${DECLARED_BUNDLE_ARGS[@]}" > "$BUNDLED_FILE"');
  });

  it('filters co-tracked members out of the portal submission until devaudit#857 ships', () => {
    // The portal's MEMBER_ROLES/MEMBER_RELATIONSHIPS enum doesn't accept
    // role="co-tracked" yet, and submit-bundle-manifest.sh hard-fails
    // (set -euo pipefail, unguarded exit 1) on any non-201 response with
    // no error suppression at the call site — submitting co-tracked
    // members today would break this step on every push for every
    // declared bundle, not just silently drop them as before.
    expect(template).toContain('.members |= map(select(.role != "co-tracked"))');
    const filterIdx = template.indexOf('.members |= map(select(.role != "co-tracked"))');
    const submitIdx = template.indexOf('bash scripts/submit-bundle-manifest.sh {{PROJECT_SLUG}} "$VERSION" "$SUBMIT_MANIFEST"');
    expect(filterIdx).toBeGreaterThan(-1);
    expect(submitIdx).toBeGreaterThan(filterIdx);
  });

  it('still uploads the full (unfiltered) manifest as bundled_changes evidence for local/PR visibility', () => {
    const uploadIdx = template.indexOf('_compliance-docs bundled_changes "$BUNDLED_FILE"');
    const submitIdx = template.indexOf('bash scripts/submit-bundle-manifest.sh {{PROJECT_SLUG}} "$VERSION" "$SUBMIT_MANIFEST"');
    expect(uploadIdx).toBeGreaterThan(submitIdx);
  });
});

describe('derive-release-version.sh — declared-bundle manifest priority tier (#736)', () => {
  const script = readCommon('scripts/derive-release-version.sh');

  it('checks for a declared-bundle manifest before the subject-tag rule', () => {
    const bundleIdx = script.indexOf('Co-Tracked Bundle Members');
    const subjectRuleIdx = script.indexOf("# 1. Subject: [REQ-XXX]");
    expect(bundleIdx).toBeGreaterThan(-1);
    expect(subjectRuleIdx).toBeGreaterThan(-1);
    expect(bundleIdx).toBeLessThan(subjectRuleIdx);
  });

  it('requires exactly one declared-bundle file, else falls through unchanged', () => {
    expect(script).toContain('DECLARED_BUNDLE_FILES[@]');
    expect(script).toContain('-eq 1');
  });
});
