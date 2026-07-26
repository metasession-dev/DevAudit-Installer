#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/project/scripts" "$WORK/project/compliance/pending-releases"
cp "$ROOT/sdlc/files/_common/scripts/derive-release-version.sh" "$WORK/project/scripts/"
cp "$ROOT/sdlc/files/_common/scripts/report-test-execution.sh" "$WORK/project/scripts/"
cp "$ROOT/sdlc/files/_common/scripts/close-out-release.sh" "$WORK/project/scripts/"
cp "$ROOT/sdlc/files/_common/scripts/markdown-table.sh" "$WORK/project/scripts/"

cat > "$WORK/project/compliance/RTM.md" <<'MARKDOWN'
# Requirements Traceability Matrix

| Status | Meaning |
| --- | --- |
| RELEASED | Closed approval envelope |

| REQ-ID | Issue | Risk | Evidence | Status | Owner |
| --- | --- | --- | --- | --- | --- |
| REQ-777 | #777 | MEDIUM | compliance/evidence/REQ-777/ | TESTED - PENDING SIGN-OFF | QA |
MARKDOWN

cat > "$WORK/project/compliance/pending-releases/RELEASE-TICKET-REQ-777.md" <<'MARKDOWN'
# Release ticket REQ-777

**Status:** TESTED - PENDING SIGN-OFF
**DevAudit Release:** REQ-777
MARKDOWN

cat > "$WORK/project/sdlc-config.json" <<'JSON'
{"project_slug":"release-pipeline-fixture"}
JSON

(
  cd "$WORK/project"
  git init -q
  git config user.name "Release Pipeline Fixture"
  git config user.email "fixture@example.invalid"
  git add .
  git commit -q -m "feat: [REQ-777] exercise release pipeline" -m "Ref: REQ-777"
)

node "$ROOT/tests/release-pipeline-e2e/mock-portal.mjs" \
  "$WORK/port" "$WORK/requests.jsonl" &
SERVER_PID=$!
for _ in $(seq 1 50); do
  [ -s "$WORK/port" ] && break
  sleep 0.1
done
[ -s "$WORK/port" ] || { echo "mock portal did not start" >&2; exit 1; }

BASE_URL="http://127.0.0.1:$(cat "$WORK/port")"
(
  cd "$WORK/project"
  RELEASE="$(bash scripts/derive-release-version.sh)"
  [ "$RELEASE" = "REQ-777" ]

  COMMON_ARGS=(
    --project-slug release-pipeline-fixture
    --release "$RELEASE"
    --sdlc-stage 2
    --environment ci
    --suite-kind quality_gate
    --iteration-key REQ-777:iteration:1
    --iteration-ordinal 1
    --idempotency-key github:fixture/repo:quality-gates:777:attempt:1:stage:2:REQ-777
    --commit-sha "$(git rev-parse HEAD)"
  )
  DEVAUDIT_BASE_URL="$BASE_URL" DEVAUDIT_API_KEY=fixture-token \
    bash scripts/report-test-execution.sh start "${COMMON_ARGS[@]}"
  DEVAUDIT_BASE_URL="$BASE_URL" DEVAUDIT_API_KEY=fixture-token \
    bash scripts/report-test-execution.sh complete "${COMMON_ARGS[@]}" --outcome passed

  DEVAUDIT_BASE_URL="$BASE_URL" DEVAUDIT_API_KEY=fixture-token \
    bash scripts/close-out-release.sh "$RELEASE" --release-pr 777

  test -f compliance/approved-releases/RELEASE-TICKET-REQ-777.md
  grep -qE '^\*\*Status:\*\* RELEASED' \
    compliance/approved-releases/RELEASE-TICKET-REQ-777.md
  STATUS="$(source scripts/markdown-table.sh; \
    markdown_table_cell compliance/RTM.md REQ-777 Status REQ-ID/ID Status)"
  [ "$STATUS" = "RELEASED" ]
)

[ "$(jq -r 'select(.url | contains("versionPrefix=REQ-777")) | .url' \
  "$WORK/requests.jsonl" | wc -l)" -eq 3 ]
[ "$(jq -r 'select(.method == "POST") | (.body | fromjson) | .iterationOrdinal' \
  "$WORK/requests.jsonl" | sort -u)" = "1" ]
[ "$(jq -r 'select(.method == "POST") | (.body | fromjson) | .outcome' \
  "$WORK/requests.jsonl" | paste -sd, -)" = "running,passed" ]

echo "release pipeline E2E fixture passed"
