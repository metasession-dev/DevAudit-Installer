# IMPLEMENTATION GUIDE — SDLC-stage evidence dimension

> For the implementer. Follow tasks **in order**. Each task gives the EXACT file,
> the EXACT text to find, and the EXACT replacement. Do not improvise.

## Rules (read first)

1. **Edit templates/scripts only under the repo-root `sdlc/` and `scripts/`.** NEVER
   edit `cli/sdlc/` or `cli/scripts/` — those are git-ignored snapshots regenerated
   automatically by `cli/tools/bundle-templates.mjs` on `npm pack`. Touching them does
   nothing. **Exception:** `cli/src/**` is real, committed TypeScript source and *is*
   edited (see T6b).
2. The stage values are **fixed** — use exactly the number given in each task. Do
   not decide stages yourself.
3. After all tasks, run the verification in the last section.
4. Portal work is a **separate repository**. Do not attempt it here. Hand
   Appendix A to the portal team.

---

## T1 — Add `--sdlc-stage` flag to the uploader

**File:** `scripts/upload-evidence.sh`

**T1a.** Find this line (near line 74):
```
GATE_STATUS=""
```
Replace with:
```
GATE_STATUS=""
SDLC_STAGE=""
```

**T1b.** Find this line (in the `while`/`case` arg parser, near line 98):
```
    --gate-status) GATE_STATUS="$2"; shift 2 ;;
```
Replace with:
```
    --gate-status) GATE_STATUS="$2"; shift 2 ;;
    --sdlc-stage) SDLC_STAGE="$2"; shift 2 ;;
```

**T1c.** Find this block (near line 118):
```
if [ -n "$RELEASE_VERSION" ] && [ -z "$EVIDENCE_CATEGORY" ]; then
  echo "Error: --category is required when --release is specified (gate validation)"
  exit 1
fi
```
Add immediately AFTER it:
```
if [ -n "$SDLC_STAGE" ] && ! [[ "$SDLC_STAGE" =~ ^[1-5]$ ]]; then
  echo "Error: --sdlc-stage must be an integer 1-5 (got: $SDLC_STAGE)"
  exit 1
fi
```

**T1d.** Find this line (in CURL_ARGS construction, near line 279):
```
  [ -n "$GATE_STATUS" ] && CURL_ARGS+=(-F "gateStatus=${GATE_STATUS}")
```
Replace with:
```
  [ -n "$GATE_STATUS" ] && CURL_ARGS+=(-F "gateStatus=${GATE_STATUS}")
  [ -n "$SDLC_STAGE" ] && CURL_ARGS+=(-F "sdlcStage=${SDLC_STAGE}")
```

**T1e.** In the header comment block (the `--gate-status` doc, near line 29-34),
add after the `--gate-status` description:
```
#   --sdlc-stage <1-5>          SDLC stage that produced this artefact:
#                               1 plan, 2 implement/test, 3 compile-evidence,
#                               4 submit-for-review, 5 deploy. Forwarded as
#                               `sdlcStage`; unknown to older portals (ignored
#                               server-side, no error).
```

---

## T2 — Stamp stage 2 on CI gate evidence + per-AC screenshots

**File:** `sdlc/files/ci/ci.yml.template`

Find (near line 414):
```
          FLAGS="${FLAGS} --environment uat"
```
Replace with:
```
          FLAGS="${FLAGS} --environment uat"
          FLAGS="${FLAGS} --sdlc-stage 2"
```
> This single `FLAGS` is reused by every upload in the step — gate JSON, SAST,
> dep-audit, e2e results, the Playwright zip, coverage, AND the per-AC
> evidenceShot screenshot loop — so all become stage 2 (implement & test).

---

## T3 — Stamp stage 3 on committed compliance docs

**File:** `sdlc/files/ci/compliance-evidence.yml.template`

Find (near line 240):
```
          FLAGS="${FLAGS} --create-release-if-missing --environment uat"
```
Replace with:
```
          FLAGS="${FLAGS} --create-release-if-missing --environment uat --sdlc-stage 3"
```

---

## T4 — Stamp event-derived stage on the E2E regression report + upload full bundle

**File:** `sdlc/files/ci/compliance-evidence.yml.template`

**T4a.** Find the TIER case (near line 588):
```
          case "$PRIOR_EVENT" in
            pull_request) TIER=critical ;;
            push)         TIER=regression ;;
            *)            TIER="${PRIOR_EVENT}" ;;
          esac
```
Replace with:
```
          case "$PRIOR_EVENT" in
            pull_request) TIER=critical; STAGE=2 ;;
            push)         TIER=regression; STAGE=5 ;;
            *)            TIER="${PRIOR_EVENT}"; STAGE="" ;;
          esac
```

**T4b.** Find the FLAGS block (near line 596):
```
          FLAGS="--create-release-if-missing --environment uat \
                 --git-sha ${{ github.event.workflow_run.head_sha }} \
                 --ci-run-id ${{ github.event.workflow_run.id }} \
                 --branch ${PRIOR_BRANCH}"
```
Replace with:
```
          FLAGS="--create-release-if-missing --environment uat \
                 --git-sha ${{ github.event.workflow_run.head_sha }} \
                 --ci-run-id ${{ github.event.workflow_run.id }} \
                 --branch ${PRIOR_BRANCH}"
          [ -n "$STAGE" ] && FLAGS="${FLAGS} --sdlc-stage ${STAGE}"
```

**T4c.** Replace the bare-`index.html` upload with a full zipped bundle. Find
(near line 637):
```
            if [ -f e2e-artifacts/playwright-report/index.html ]; then
              if bash scripts/upload-evidence.sh \
                {{PROJECT_SLUG}} "$REQ" test_report \
                e2e-artifacts/playwright-report/index.html \
                --category test_report ${FLAGS} --release "${DERIVED_RELEASE}" \
                --meta-key "tier=${TIER}"
              then
```
Replace with:
```
            if [ -d e2e-artifacts/playwright-report ]; then
              (cd e2e-artifacts && zip -qr playwright-report.zip playwright-report/) 2>/dev/null || true
            fi
            if [ -f e2e-artifacts/playwright-report.zip ]; then
              if bash scripts/upload-evidence.sh \
                {{PROJECT_SLUG}} "$REQ" test_report \
                e2e-artifacts/playwright-report.zip \
                --category test_report ${FLAGS} --release "${DERIVED_RELEASE}" \
                --meta-key "tier=${TIER}"
              then
```
> Mirrors the zip-bundle pattern already used in `ci.yml.template` lines 498-505,
> so the portal receives the whole report (screenshots included), not a shell HTML.

---

## T5 — Stamp stage 5 on production evidence

**File:** `sdlc/files/ci/post-deploy-prod.yml.template`

**T5a.** In the smoke-results upload (near line 167), find:
```
                --category test_report --git-sha "${GIT_SHA}" --ci-run-id "${CI_RUN}" --branch main \
```
Replace with:
```
                --category test_report --sdlc-stage 5 --git-sha "${GIT_SHA}" --ci-run-id "${CI_RUN}" --branch main \
```

**T5b.** In the ticket upload (near line 182), find:
```
                --category release_artifact --git-sha "${GIT_SHA}" --ci-run-id "${CI_RUN}" --branch main \
```
Replace with:
```
                --category release_artifact --sdlc-stage 5 --git-sha "${GIT_SHA}" --ci-run-id "${CI_RUN}" --branch main \
```

---

## T6 — New workflow: feature-branch in-scope E2E (issue #174)

**Create file:** `sdlc/files/ci/feature-e2e.yml.template` with EXACT contents:

```yaml
# Feature-branch in-scope E2E (DEVAUDIT-003, issue #174)
#
# Generated by `devaudit install` / `devaudit update` from sdlc-config.json.
# Runs the E2E specs tagged with the branch's REQ on PRs to the integration
# branch, so regression-tier bugs surface during the feature cycle instead of
# at the release gate. Uploads the report as stage-2, origin=feature evidence
# so it does NOT co-mingle with the stage-3/5 regression runs and is NOT
# counted as release/UAT evidence by the portal.
name: Feature In-Scope E2E

on:
  pull_request:
    branches: [develop]

jobs:
  detect-req:
    name: Detect REQ from branch
    runs-on: {{RUNNER}}
    outputs:
      req_id: ${{ steps.detect.outputs.req_id }}
      has_tests: ${{ steps.detect.outputs.has_tests }}
    steps:
      - uses: actions/checkout@v6
      - name: Parse REQ from branch name
        id: detect
        run: |
          BRANCH="${{ github.head_ref }}"
          if [[ $BRANCH =~ (REQ-[0-9]+) ]]; then
            REQ_ID="${BASH_REMATCH[1]}"
            echo "req_id=$REQ_ID" >> "$GITHUB_OUTPUT"
            if grep -rl "@requirement $REQ_ID" e2e/ --include="*.spec.ts" >/dev/null 2>&1; then
              echo "has_tests=true" >> "$GITHUB_OUTPUT"
            else
              echo "has_tests=false" >> "$GITHUB_OUTPUT"
            fi
          else
            echo "req_id=none" >> "$GITHUB_OUTPUT"
            echo "has_tests=false" >> "$GITHUB_OUTPUT"
          fi

  run-feature-e2e:
    name: Run in-scope E2E
    needs: detect-req
    if: needs.detect-req.outputs.has_tests == 'true'
    runs-on: {{RUNNER}}
    env:
      DEVAUDIT_BASE_URL_VAR: ${{ vars.DEVAUDIT_BASE_URL }}
      DEVAUDIT_API_KEY: ${{ secrets.DEVAUDIT_API_KEY }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx playwright install --with-deps
      - name: Run in-scope E2E
        run: |
          REQ_ID="${{ needs.detect-req.outputs.req_id }}"
          npx playwright test --grep "$REQ_ID"
      - name: Upload feature E2E evidence (stage 2, origin=feature)
        if: always()
        run: |
          REQ_ID="${{ needs.detect-req.outputs.req_id }}"
          CONFIG_URL=""
          if [ -f sdlc-config.json ]; then
            CONFIG_URL=$(jq -r '.devaudit.base_url // empty' sdlc-config.json 2>/dev/null || true)
          fi
          BASE="${CONFIG_URL:-$DEVAUDIT_BASE_URL_VAR}"
          if [ -z "$BASE" ] || [ -z "$DEVAUDIT_API_KEY" ]; then
            echo "::warning::DevAudit not configured — skipping feature E2E upload."
            exit 0
          fi
          export DEVAUDIT_BASE_URL="${BASE%/}"
          if [ -d playwright-report ]; then
            zip -qr playwright-report.zip playwright-report/ 2>/dev/null || true
          fi
          if [ -f playwright-report.zip ]; then
            bash scripts/upload-evidence.sh \
              {{PROJECT_SLUG}} "$REQ_ID" test_report playwright-report.zip \
              --category test_report --release "$REQ_ID" --create-release-if-missing \
              --environment uat --sdlc-stage 2 \
              --git-sha "${{ github.event.pull_request.head.sha }}" \
              --ci-run-id "${{ github.run_id }}" --branch "${{ github.head_ref }}" \
              --meta-key "origin=feature" \
              || echo "::warning::feature E2E report upload failed"
          fi
```

> **Note for the implementer:** `{{RUNNER}}`, `{{PROJECT_SLUG}}` are template
> placeholders the CLI substitutes — leave them literally as written. Do NOT invent
> other `{{...}}` tokens; only those two are guaranteed available to this workflow.

### T6b — Register the new template in the CLI (REQUIRED — without this it is never rendered)

**File:** `cli/src/update/ci-templates.ts` (real source — edit it).

Find the `CI_TEMPLATES` array (near line 7-21):
```
const CI_TEMPLATES = [
  'ci.yml.template',
  'ci-status-fallback.yml.template',
  'compliance-validation.yml.template',
  'check-release-approval.yml.template',
  'post-deploy-prod.yml.template',
  'compliance-evidence.yml.template',
  'close-out-release.yml.template',
```
Add `'feature-e2e.yml.template',` to the array (anywhere inside it is fine, e.g. after
`'compliance-evidence.yml.template',`):
```
  'compliance-evidence.yml.template',
  'feature-e2e.yml.template',
  'close-out-release.yml.template',
```
> Confirmed: this `CI_TEMPLATES` list is the single registry the installer/updater
> iterates (`syncCiTemplates`, same file) to render every workflow. No test asserts an
> exact count, so adding an entry is safe. The renderer substitutes `{{PROJECT_SLUG}}`
> and `{{RUNNER}}` automatically.

---

## T7 — Add a uploader test for the new flag

**File:** `scripts/upload-evidence.test.sh` — add a case mirroring the existing
style: run `run_uploader <proj> REQ-001 screenshot <tmp.png> --sdlc-stage 9` and
assert exit code != 0 with stderr containing `--sdlc-stage must be an integer`.
Also assert `--sdlc-stage 3` on a stub file still exits 0 (skipped). Increment
PASS/FAIL via the existing `ok`/`no` helpers.

---

## Verification (run all; all must pass)

```
# 1. Uploader: syntax + tests
bash -n scripts/upload-evidence.sh
bash scripts/upload-evidence.test.sh

# 2. New template file exists + stage flags are present everywhere
test -f sdlc/files/ci/feature-e2e.yml.template && echo "OK feature-e2e template"
grep -n "sdlc-stage" scripts/upload-evidence.sh sdlc/files/ci/*.template

# 3. CLI registry includes the new template + builds + tests pass
grep -n "feature-e2e.yml.template" cli/src/update/ci-templates.ts
npm --prefix cli run build
npm --prefix cli test
```
Expect: `bash -n` clean; uploader tests green; `--sdlc-stage` present in the uploader
and in `ci.yml`, `compliance-evidence.yml`, `post-deploy-prod.yml`, and
`feature-e2e.yml` templates; `feature-e2e.yml.template` present in `CI_TEMPLATES`; CLI
build + tests pass. (YAML templates contain `{{...}}` placeholders so they are not
valid YAML until rendered — do not run a YAML linter on them.)

---

## Stage mapping (reference — already encoded by the tasks)

| Source | Stage |
|--------|-------|
| `ci.yml` gate evidence + per-AC evidenceShot screenshots | **2** |
| `compliance-evidence.yml` committed docs (RTM, plans, srs/adr/risk, test-exec-summary, tickets, audit-log) | **3** |
| `compliance-evidence.yml` E2E report — PR-to-develop | **2** |
| `compliance-evidence.yml` E2E report — push-to-main | **5** |
| `feature-e2e.yml` feature-branch run | **2** (origin=feature) |
| `post-deploy-prod.yml` smoke + ticket | **5** |

---

## Appendix A — PORTAL REPO spec (hand to portal team; not implemented here)

1. **Ingest:** accept multipart field `sdlcStage` (string `"1"`-`"5"`) on
   `POST /api/evidence/upload`; store on the evidence row; default `unspecified`
   when absent. Unknown/invalid values dropped silently (match existing
   `changeType`/`gateStatus` behaviour) — never 400.
2. **Filename validator:** apply the `REQ-XXX-AC<n>-<slug>.png` rule ONLY when
   `evidenceType=screenshot`. Exempt `test_report` / `e2e_result` (validate by
   extension: `.zip` / `.html` / `.json`).
3. **Bundle render:** when `test_report` evidence is a `.zip`, unpack/serve the
   Playwright report so screenshots/traces display.
4. **Display:** on the release-detail page, group each REQ's evidence by stage
   1-5.
5. **Stage-aware completeness matrix:** per-REQ × per-stage cell = present /
   expected-but-missing (blocks) / not-yet-reached (grey, never blocks). Expected
   stages derive from `release.status`: draft→1-3, uat_review→1-4, released→1-5.
6. **AC-proof vs run-context:** only REQ-tagged AC evidence (a passing
   `[REQ][AC]` test + its evidenceShot) counts toward completeness. A report
   bundle is "run context" and must NOT turn a REQ green (preserves #169/#170).
7. **Pre-merge guard:** evidence with metadata `origin=feature` (stage 2 from
   `feature-e2e.yml`) must NOT count as release/UAT evidence — display only.
```
