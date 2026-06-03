#!/usr/bin/env bash
# @requirement REQ-007 - CLI upload script for CI pipelines
# @requirement REQ-020 - Extended with release/environment/category flags
# @requirement REQ-XXX - #224: posts to META-COMPLY's API instead of Supabase
#
# Usage:
#   ./scripts/upload-evidence.sh <project-slug> <requirement-id> <evidence-type> <file-or-directory>
#
# Optional flags:
#   --git-sha <sha>             Git commit SHA
#   --ci-run-id <id>            CI run identifier
#   --branch <branch>           Git branch name
#   --release <version>         Release version (e.g. v1.0.0). The route
#                               resolves it to a release UUID server-side.
#   --create-release-if-missing Auto-create the release as 'draft' if absent
#   --environment <env>         Environment: uat or production
#   --category <cat>            Evidence category: ci_pipeline, local_dev,
#                               planning, test_report, security_scan,
#                               release_artifact
#   --release-title <text>      Human title for the release row (e.g. the
#                               release-ticket H1). Forwarded as
#                               `releaseTitle`; the portal no-clobbers
#                               existing non-null values.
#   --change-type <type>        Conventional-commit prefix (feat / fix /
#                               refactor / perf / chore / docs / ci /
#                               build / test / compliance / revert) for
#                               the release row. Unknown values are
#                               silently dropped server-side.
#   --gate-status <status>      `passed` / `failed` / `skipped`. Lets the
#                               portal distinguish a gate that ran-and-
#                               failed from one that never ran. Forwarded
#                               as `gateStatus`; unknown values are
#                               silently dropped server-side.
#                               DevAudit-Installer#96.
#
# Required environment variables:
#   DEVAUDIT_BASE_URL  e.g. https://meta-comply-production.up.railway.app
#   DEVAUDIT_API_KEY   project-scoped API key (uploader role); format `mc_…`.
#                         Issue from: Project Settings → API Keys in
#                         META-COMPLY's web UI.
#
# Examples:
#   ./scripts/upload-evidence.sh meta-ats REQ-001 screenshot \
#       compliance/evidence/REQ-001/screenshots/
#   ./scripts/upload-evidence.sh meta-ats _compliance-docs compliance_document \
#       compliance/RTM.md --git-sha abc123
#   ./scripts/upload-evidence.sh meta-ats REQ-001 e2e_result \
#       playwright-report/ --release v1.0.0 --environment uat \
#       --category ci_pipeline --create-release-if-missing

set -euo pipefail

# --- Parse arguments ---
if [ "$#" -lt 4 ]; then
  echo "Usage: $0 <project-slug> <requirement-id> <evidence-type> <file-or-directory> [flags…]"
  exit 1
fi

PROJECT_SLUG="$1"
REQUIREMENT_ID="$2"
EVIDENCE_TYPE="$3"
FILE_PATH="$4"
shift 4

GIT_SHA=""
CI_RUN_ID=""
BRANCH=""
RELEASE_VERSION=""
CREATE_RELEASE_IF_MISSING=false
ENVIRONMENT=""
EVIDENCE_CATEGORY=""
RELEASE_TITLE=""
CHANGE_TYPE=""
GATE_STATUS=""
# Repeatable `--meta-key key=value` accumulator. Each pair gets merged
# into the metadata JSON sent to the portal. Used by the screenshot
# upload loop to pass `origin=feature|regression` from the per-PNG
# sidecar JSON written by the evidenceShot helper.
META_KEYS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --git-sha) GIT_SHA="$2"; shift 2 ;;
    --ci-run-id) CI_RUN_ID="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --release) RELEASE_VERSION="$2"; shift 2 ;;
    --create-release-if-missing) CREATE_RELEASE_IF_MISSING=true; shift ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --category) EVIDENCE_CATEGORY="$2"; shift 2 ;;
    # Descriptive title + conventional-commit change type passed through to
    # the portal's findOrCreateRelease no-clobber backfill. Both optional;
    # unknown change-type values are dropped server-side, not 400'd.
    --release-title) RELEASE_TITLE="$2"; shift 2 ;;
    --change-type) CHANGE_TYPE="$2"; shift 2 ;;
    # passed/failed/skipped — surfaces failed gates on the portal so
    # ran-and-failed != never-ran. Unknown values dropped server-side.
    # DevAudit-Installer#96.
    --gate-status) GATE_STATUS="$2"; shift 2 ;;
    # --meta-key key=value (repeatable). Merged into the metadata JSON
    # before posting. Validates the `key=value` shape; rejects bare
    # keys without `=`.
    --meta-key)
      if [[ "$2" != *=* ]]; then
        echo "Error: --meta-key requires key=value (got: $2)"
        exit 1
      fi
      META_KEYS+=("$2")
      shift 2
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -n "$ENVIRONMENT" ] && [ -z "$RELEASE_VERSION" ]; then
  echo "Error: --environment requires --release (evidence without a release is orphaned)"
  exit 1
fi
if [ -n "$RELEASE_VERSION" ] && [ -z "$EVIDENCE_CATEGORY" ]; then
  echo "Error: --category is required when --release is specified (gate validation)"
  exit 1
fi

if [ -z "${DEVAUDIT_BASE_URL:-}" ]; then
  echo "Error: DEVAUDIT_BASE_URL environment variable is required"
  exit 1
fi
if [ -z "${DEVAUDIT_API_KEY:-}" ]; then
  echo "Error: DEVAUDIT_API_KEY environment variable is required (issue from"
  echo "       Project Settings → API Keys in META-COMPLY)"
  exit 1
fi

# Strip any trailing slash so we don't double-up later.
DEVAUDIT_BASE_URL="${DEVAUDIT_BASE_URL%/}"

# --- Build metadata JSON ---
# Assemble entries first; only emit `{ ... }` if at least one field is
# set. Each entry is a `"key":"value"` JSON pair with the value
# json-escaped (quotes + backslashes).
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}
META_ENTRIES=()
[ -n "$GIT_SHA" ] && META_ENTRIES+=("\"gitSha\":\"$(json_escape "$GIT_SHA")\"")
[ -n "$CI_RUN_ID" ] && META_ENTRIES+=("\"ciRunId\":\"$(json_escape "$CI_RUN_ID")\"")
[ -n "$BRANCH" ] && META_ENTRIES+=("\"branch\":\"$(json_escape "$BRANCH")\"")
for KV in "${META_KEYS[@]}"; do
  KEY="${KV%%=*}"
  VAL="${KV#*=}"
  META_ENTRIES+=("\"$(json_escape "$KEY")\":\"$(json_escape "$VAL")\"")
done
if [ "${#META_ENTRIES[@]}" -gt 0 ]; then
  IFS=','
  METADATA="{${META_ENTRIES[*]}}"
  unset IFS
else
  METADATA="{}"
fi

# --- Collect files ---
FILES=()
if [ -d "$FILE_PATH" ]; then
  while IFS= read -r -d '' f; do
    FILES+=("$f")
  done < <(find "$FILE_PATH" -type f -print0)
else
  FILES=("$FILE_PATH")
fi
if [ ${#FILES[@]} -eq 0 ]; then
  echo "Error: No files found at $FILE_PATH"
  exit 1
fi

# --- Upload each file via /api/evidence/upload ---
#
# Retry-on-429 / 5xx: consumer CI workflows fire 8-12 sequential uploads per
# requirement (test-scope, test-plan, implementation-plan, security-summary,
# test-execution-summary, ai-prompts, ai-use-note, uat-checklist, gates/*.json).
# That cadence trips DevAudit's per-IP rate limiter, marking otherwise-green
# CI runs as failed. Retry transiently with exponential backoff (1s → 16s),
# honouring Retry-After if the portal supplies it. Auth/validation errors
# (4xx other than 429) still fail fast — they won't fix themselves.
#
# Issue: devaudit#263.
SUCCEEDED=0
FAILED=0
TOTAL_SIZE=0
UPLOAD_URL="${DEVAUDIT_BASE_URL}/api/evidence/upload"
MAX_ATTEMPTS=${UPLOAD_MAX_ATTEMPTS:-5}
INITIAL_BACKOFF_SECONDS=${UPLOAD_INITIAL_BACKOFF_SECONDS:-1}

for FILE in "${FILES[@]}"; do
  FILENAME=$(basename "$FILE")
  FILE_SIZE=$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE")
  echo -n "Uploading ${FILENAME}... "
  CURL_ARGS=(
    -X POST "$UPLOAD_URL"
    -H "Authorization: Bearer ${DEVAUDIT_API_KEY}"
    -F "file=@${FILE}"
    -F "projectSlug=${PROJECT_SLUG}"
    -F "requirementId=${REQUIREMENT_ID}"
    -F "evidenceType=${EVIDENCE_TYPE}"
    -F "metadata=${METADATA}"
  )
  [ -n "$RELEASE_VERSION" ] && CURL_ARGS+=(-F "releaseVersion=${RELEASE_VERSION}")
  if [ "$CREATE_RELEASE_IF_MISSING" = true ]; then
    CURL_ARGS+=(-F "createReleaseIfMissing=true")
  fi
  [ -n "$BRANCH" ] && CURL_ARGS+=(-F "releaseBranch=${BRANCH}")
  [ -n "$ENVIRONMENT" ] && CURL_ARGS+=(-F "environment=${ENVIRONMENT}")
  [ -n "$EVIDENCE_CATEGORY" ] && CURL_ARGS+=(-F "evidenceCategory=${EVIDENCE_CATEGORY}")
  [ -n "$RELEASE_TITLE" ] && CURL_ARGS+=(-F "releaseTitle=${RELEASE_TITLE}")
  [ -n "$CHANGE_TYPE" ] && CURL_ARGS+=(-F "changeType=${CHANGE_TYPE}")
  [ -n "$GATE_STATUS" ] && CURL_ARGS+=(-F "gateStatus=${GATE_STATUS}")

  ATTEMPT=1
  BACKOFF=$INITIAL_BACKOFF_SECONDS
  HTTP_CODE=0
  RESP_BODY_FILE=""
  while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
    [ -n "$RESP_BODY_FILE" ] && rm -f "$RESP_BODY_FILE"
    RESP_BODY_FILE=$(mktemp)
    RESP_HEADERS_FILE=$(mktemp)
    HTTP_CODE=$(curl -s -o "$RESP_BODY_FILE" -D "$RESP_HEADERS_FILE" -w "%{http_code}" "${CURL_ARGS[@]}")
    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
      rm -f "$RESP_HEADERS_FILE"
      break
    fi
    # Decide whether the failure is retriable (429 or 5xx).
    if [ "$HTTP_CODE" = "429" ] || { [ "$HTTP_CODE" -ge 500 ] && [ "$HTTP_CODE" -lt 600 ]; }; then
      if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
        # Honour Retry-After (seconds) if the portal supplied it; otherwise back off.
        WAIT_SECONDS=$BACKOFF
        RETRY_AFTER=$(grep -i '^retry-after:' "$RESP_HEADERS_FILE" 2>/dev/null | head -1 | sed 's/^[Rr]etry-[Aa]fter:[[:space:]]*//' | tr -d '\r')
        if [[ "$RETRY_AFTER" =~ ^[0-9]+$ ]] && [ "$RETRY_AFTER" -gt 0 ]; then
          WAIT_SECONDS=$RETRY_AFTER
        fi
        echo -n "(HTTP ${HTTP_CODE}, retry in ${WAIT_SECONDS}s) "
        rm -f "$RESP_HEADERS_FILE"
        sleep "$WAIT_SECONDS"
        ATTEMPT=$((ATTEMPT + 1))
        BACKOFF=$((BACKOFF * 2))
        continue
      fi
    fi
    rm -f "$RESP_HEADERS_FILE"
    break
  done

  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    rm -f "$RESP_BODY_FILE"
    if [ "$ATTEMPT" -gt 1 ]; then
      echo "OK (${FILE_SIZE} bytes, attempt ${ATTEMPT}/${MAX_ATTEMPTS})"
    else
      echo "OK (${FILE_SIZE} bytes)"
    fi
    SUCCEEDED=$((SUCCEEDED + 1))
    TOTAL_SIZE=$((TOTAL_SIZE + FILE_SIZE))
  else
    echo "FAILED (HTTP ${HTTP_CODE} after ${ATTEMPT} attempt(s))"
    echo "  Response: $(head -c 500 "$RESP_BODY_FILE")"
    rm -f "$RESP_BODY_FILE"
    FAILED=$((FAILED + 1))
  fi
done

# --- Summary ---
echo ""
echo "=== Upload Summary ==="
echo "Files: ${SUCCEEDED} succeeded, ${FAILED} failed (${#FILES[@]} total)"
echo "Total size: $((TOTAL_SIZE / 1024)) KB"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
