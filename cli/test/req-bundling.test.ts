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
    // devaudit-installer#817 — must be the portal's underscore spelling
    // (co_tracked); the portal validates this exact enum value and does
    // not normalise a hyphenated variant, hard-rejecting it with HTTP 400.
    expect(script).toContain('role: "co_tracked"');
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
    expect(template).toContain('select(.role == "co_tracked") | .version');
    expect(template).toContain('DECLARED_BUNDLE_ARGS=(--declared-bundle "$DECLARED_MEMBERS")');
    expect(template).toContain('"${DECLARED_BUNDLE_ARGS[@]}" > "$BUNDLED_FILE"');
  });

  it('hands the full committed manifest to submit-bundle-manifest.sh, which owns the co_tracked filter (#955)', () => {
    // devaudit-installer#817 lifted an earlier filter in this template; #955
    // moved the (different, deliberate) filtering into submit-bundle-manifest.sh
    // so EVERY caller gets it and the manifestHash is recomputed in one place.
    // The template must therefore not filter on its own.
    expect(template).not.toContain('.members |= map(select(.role != "co-tracked"))');
    expect(template).not.toContain('.members |= map(select(.role != "co_tracked"))');
    expect(template).not.toContain('SUBMIT_MANIFEST');
    const submitIdx = template.indexOf('bash scripts/submit-bundle-manifest.sh {{PROJECT_SLUG}} "$VERSION" "$BUNDLED_MANIFEST"');
    expect(submitIdx).toBeGreaterThan(-1);
  });

  it('uploads the manifest as bundled_changes evidence after submitting it to the portal', () => {
    const uploadIdx = template.indexOf('_compliance-docs bundled_changes "$BUNDLED_FILE"');
    const submitIdx = template.indexOf('bash scripts/submit-bundle-manifest.sh {{PROJECT_SLUG}} "$VERSION" "$BUNDLED_MANIFEST"');
    expect(submitIdx).toBeGreaterThan(-1);
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

describe('declared bundle = one portal release (#955)', () => {
  const read = (rel: string) =>
    readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n');
  const ciTemplate = read('sdlc/files/ci/ci.yml.template');
  const uploadDocs = readCommon('scripts/upload-compliance-documents.sh');
  const submit = readCommon('scripts/submit-bundle-manifest.sh');
  const closeOut = readCommon('scripts/close-out-release.sh');
  const resolver = readCommon('scripts/resolve-bundle-release.sh');

  it('ships the resolver and keys it on co_tracked membership of a live declared bundle', () => {
    expect(resolver).toContain('any(.role == "co_tracked" and .version == $req)');
    expect(resolver).toContain('compliance/approved-releases/RELEASE-TICKET-${core}.md');
    expect(resolver).toContain('compliance/superseded-releases/RELEASE-TICKET-${core}.md');
    expect(resolver).toContain('exit 3');
  });

  it('files every per-REQ upload in ci.yml.template against the resolved release, never the member', () => {
    expect(ciTemplate).toContain('MEMBER_RELEASE=$(bash scripts/resolve-bundle-release.sh "$MEMBER_REQ")');
    expect(ciTemplate).toContain('FANOUT_RELEASE=$(bash scripts/resolve-bundle-release.sh "$REQ_ID")');
    expect(ciTemplate).toContain('REQ_RELEASE=$(bash scripts/resolve-bundle-release.sh "$REQ")');
    expect(ciTemplate).toContain('--category screenshot ${FLAGS} --release "$REQ_RELEASE"');
    expect(ciTemplate).not.toContain('--release ${MEMBER_REQ} --create-release-if-missing');
    expect(ciTemplate).not.toContain('--release ${REQ_ID} --create-release-if-missing');
    expect(ciTemplate).not.toContain('--category screenshot ${FLAGS} --release "$REQ" ');
  });

  it('files compliance documents against the resolved release and skips rather than mis-files on a conflict', () => {
    expect(uploadDocs).toContain('bash scripts/resolve-bundle-release.sh "$TICKET_REQ"');
    expect(uploadDocs).toContain('bash scripts/resolve-bundle-release.sh "$REQ_ID"');
    expect(uploadDocs).toContain('--release \\"${REQ_RELEASE}\\"');
    expect(uploadDocs).not.toContain('--release \\"${REQ_ID}\\"');
  });

  it('does not submit co_tracked members to the portal and recomputes manifestHash for the stripped payload', () => {
    expect(submit).toContain('map(select(.role != "co_tracked"))');
    expect(submit).toContain("jq -cS 'del(.generator.generatedAt)'");
    expect(submit).toContain('sha256sum');
  });

  it('closes declared-bundle members out with the core', () => {
    expect(closeOut).toContain('mark_ticket_released_with_bundle');
    expect(closeOut).toContain('select((.role // "") == "co_tracked")');
    expect(closeOut).toContain('update_rtm_status "$version" "RELEASED"');
  });
});
