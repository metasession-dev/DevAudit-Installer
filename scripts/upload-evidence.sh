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
#   --sdlc-stage <1-5>          SDLC stage that produced this artefact:
#                               1 plan, 2 implement/test, 3 compile-evidence,
#                               4 submit-for-review, 5 deploy. Forwarded as
#                               `sdlcStage`; unknown to older portals (ignored
#                               server-side, no error).
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
SDLC_STAGE=""
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
    --sdlc-stage) SDLC_STAGE="$2"; shift 2 ;;
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
if [ -n "$SDLC_STAGE" ] && ! [[ "$SDLC_STAGE" =~ ^[1-5]$ ]]; then
  echo "Error: --sdlc-stage must be an integer 1-5 (got: $SDLC_STAGE)"
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

# --- Base-URL drift check (devaudit-installer#143) ---
# When the portal moves host (e.g. devaudit.metasession.co → devaudit.ai)
# Cloudflare / the origin replies 301/302 with a Location header pointing
# at the new host. Every consumer's CI that still uses the old base URL
# fails every upload until DEVAUDIT_BASE_URL is rotated. We don't want
# the failure mode to be a silent "evidence didn't upload" — surface the
# drift loudly at the top of the run so the operator knows to rotate the
# secret. (We still upload via `curl -L` so the run itself succeeds; the
# warning is the nudge to fix the secret, not a hard stop.)
probe_base_url_drift() {
  # `${var:-}` so `set -u` doesn't trip if curl isn't installed or the
  # network is offline. Probe with -I (HEAD); fall back to GET if HEAD
  # is rejected by the upstream proxy. 5s connect + 10s overall is
  # plenty for a redirect-only probe — we never read a body.
  local probe_url="${DEVAUDIT_BASE_URL}/api/health"
  local resp
  resp=$(curl -sI -o /dev/null --max-time 10 --connect-timeout 5 \
    -w "%{http_code} %{redirect_url}" "$probe_url" 2>/dev/null || true)
  local code="${resp%% *}"
  local redirect_url="${resp#* }"
  if [[ "$code" =~ ^30[1278]$ ]] && [ -n "$redirect_url" ] && [ "$redirect_url" != " " ]; then
    local old_host new_host
    old_host=$(printf '%s' "$DEVAUDIT_BASE_URL" | sed -E 's|^https?://([^/]+).*|\1|')
    new_host=$(printf '%s' "$redirect_url"      | sed -E 's|^https?://([^/]+).*|\1|')
    if [ -n "$new_host" ] && [ "$old_host" != "$new_host" ]; then
      echo "WARNING: DEVAUDIT_BASE_URL host '${old_host}' redirects to '${new_host}'."
      echo "         Rotate the DEVAUDIT_BASE_URL secret in your CI environment to"
      echo "         the new host to avoid silent breakage. (Uploads will still"
      echo "         succeed this run — curl follows the redirect — but the"
      echo "         underlying secret should be updated.)"
      echo "         Ref: https://github.com/metasession-dev/DevAudit-Installer/issues/143"
    fi
  fi
}
probe_base_url_drift

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
# devaudit#133 — central stub guard. Any file still carrying the
# DevAudit starter banner ("STARTER TEMPLATE — REPLACE BEFORE
# COMMITTING" / "...BEFORE GOING TO PRODUCTION" — both phrasings)
# is skipped before the upload attempt so unedited placeholders
# can't flip a clause to COVERED off a stub. The check is binary-
# safe (-a) so it doesn't choke on PNGs or other non-text files.
SKIPPED=0
TOTAL_SIZE=0
UPLOAD_URL="${DEVAUDIT_BASE_URL}/api/evidence/upload"
MAX_ATTEMPTS=${UPLOAD_MAX_ATTEMPTS:-5}
INITIAL_BACKOFF_SECONDS=${UPLOAD_INITIAL_BACKOFF_SECONDS:-1}
UPLOAD_CONNECT_TIMEOUT_SECONDS=${UPLOAD_CONNECT_TIMEOUT_SECONDS:-10}
UPLOAD_MAX_TIME_SECONDS=${UPLOAD_MAX_TIME_SECONDS:-120}
# DevAudit-Installer#189 — files above this size use the presigned R2 URL
# upload flow (3-step: request URL → PUT to R2 → notify portal) instead of
# the multipart POST. Avoids the portal's FormData body parser limit.
# 25MB = 26214400 bytes.
PRESIGNED_THRESHOLD_BYTES=${PRESIGNED_THRESHOLD:-26214400}
PRESIGNED_MAX_ATTEMPTS=${PRESIGNED_MAX_ATTEMPTS:-3}
PRESIGNED_UPLOAD_MAX_TIME_SECONDS=${PRESIGNED_UPLOAD_MAX_TIME_SECONDS:-300}

is_unedited_starter_stub() {
  # Match BOTH banner phrasings the SDLC has shipped (v0.1.36 changed
  # the wording from "...GOING TO PRODUCTION" to "...COMMITTING").
  # -a forces binary→text so we don't error on PNGs/PDFs; the regex
  # won't match either of those formats by accident.
  grep -aqE 'STARTER TEMPLATE.+REPLACE BEFORE' "$1"
}

# DevAudit-Installer#189 — Presigned R2 URL upload for large files (>25MB).
# 3-step flow: (1) request presigned URL from portal, (2) PUT file to R2,
# (3) notify portal that upload is complete. Each step retries on 429/5xx
# and connection errors. Returns 0 on success, 1 on failure.
upload_presigned() {
  local file="$1"
  local filename
  filename=$(basename "$file")
  local file_size
  file_size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file")

  # Derive a MIME type from the extension (best-effort).
  local mime_type="application/octet-stream"
  case "$filename" in
    *.zip)  mime_type="application/zip" ;;
    *.json) mime_type="application/json" ;;
    *.png)  mime_type="image/png" ;;
    *.pdf)  mime_type="application/pdf" ;;
    *.md)   mime_type="text/markdown" ;;
    *.html) mime_type="text/html" ;;
  esac

  local presign_url="${DEVAUDIT_BASE_URL}/api/evidence/upload-url"
  local complete_url="${DEVAUDIT_BASE_URL}/api/evidence/upload-complete"

  # --- Step 1: Request presigned upload URL ---
  local attempt backoff http_code curl_exit resp_body upload_url evidence_id
  attempt=1
  backoff=$INITIAL_BACKOFF_SECONDS
  upload_url=""
  evidence_id=""
  while [ "$attempt" -le "$PRESIGNED_MAX_ATTEMPTS" ]; do
    resp_body=$(mktemp)
    http_code=$(curl -s -o "$resp_body" -w "%{http_code}" \
      -X POST -L --max-redirs 3 \
      --connect-timeout "$UPLOAD_CONNECT_TIMEOUT_SECONDS" \
      --max-time "$UPLOAD_MAX_TIME_SECONDS" \
      "$presign_url" \
      -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{
        \"projectSlug\": \"${PROJECT_SLUG}\",
        \"requirementId\": \"${REQUIREMENT_ID}\",
        \"evidenceType\": \"${EVIDENCE_TYPE}\",
        \"fileName\": \"${filename}\",
        \"fileSizeBytes\": ${file_size},
        \"mimeType\": \"${mime_type}\",
        \"metadata\": ${METADATA},
        \"releaseVersion\": \"${RELEASE_VERSION}\",
        \"createReleaseIfMissing\": \"${CREATE_RELEASE_IF_MISSING}\",
        \"releaseBranch\": \"${BRANCH}\",
        \"environment\": \"${ENVIRONMENT}\",
        \"evidenceCategory\": \"${EVIDENCE_CATEGORY}\",
        \"sdlcStage\": \"${SDLC_STAGE}\"
      }") || curl_exit=$?
    curl_exit=${curl_exit:-0}
    if [ "$curl_exit" -eq 0 ] && [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
      upload_url=$(jq -r '.uploadUrl // empty' "$resp_body" 2>/dev/null || true)
      evidence_id=$(jq -r '.evidenceId // empty' "$resp_body" 2>/dev/null || true)
      rm -f "$resp_body"
      if [ -n "$upload_url" ] && [ -n "$evidence_id" ] && [ "$upload_url" != "null" ] && [ "$evidence_id" != "null" ]; then
        break
      fi
      # Portal responded 2xx but didn't return presigned URL fields —
      # presigned URL flow not configured. Fall back to multipart.
      echo -n "(portal did not return presigned URL, falling back to multipart) "
      return 255
    fi
    rm -f "$resp_body"
    if [ "$curl_exit" -ne 0 ] || [ "$http_code" = "429" ] || { [ "$http_code" -ge 500 ] && [ "$http_code" -lt 600 ]; }; then
      if [ "$attempt" -lt "$PRESIGNED_MAX_ATTEMPTS" ]; then
        echo -n "(step 1: HTTP ${http_code}, retry in ${backoff}s) "
        sleep "$backoff"
        attempt=$((attempt + 1))
        backoff=$((backoff * 2))
        continue
      fi
    fi
    # Non-retriable error (4xx other than 429).
    echo -n "(step 1 failed: HTTP ${http_code}) "
    return 1
  done

  if [ -z "$upload_url" ] || [ -z "$evidence_id" ]; then
    echo -n "(step 1: no presigned URL after ${attempt} attempts) "
    return 1
  fi

  # --- Step 2: Upload directly to R2 via presigned URL ---
  attempt=1
  backoff=$INITIAL_BACKOFF_SECONDS
  while [ "$attempt" -le "$PRESIGNED_MAX_ATTEMPTS" ]; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      -X PUT \
      -H "Content-Type: ${mime_type}" \
      --connect-timeout "$UPLOAD_CONNECT_TIMEOUT_SECONDS" \
      --max-time "$PRESIGNED_UPLOAD_MAX_TIME_SECONDS" \
      --data-binary @"$file" \
      "$upload_url") || curl_exit=$?
    curl_exit=${curl_exit:-0}
    if [ "$curl_exit" -eq 0 ] && [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
      break
    fi
    if [ "$curl_exit" -ne 0 ] || [ "$http_code" = "429" ] || { [ "$http_code" -ge 500 ] && [ "$http_code" -lt 600 ]; }; then
      if [ "$attempt" -lt "$PRESIGNED_MAX_ATTEMPTS" ]; then
        echo -n "(step 2: HTTP ${http_code}, retry in ${backoff}s) "
        sleep "$backoff"
        attempt=$((attempt + 1))
        backoff=$((backoff * 2))
        continue
      fi
    fi
    echo -n "(step 2 failed: HTTP ${http_code}) "
    return 1
  done

  # --- Step 3: Notify portal that upload is complete ---
  attempt=1
  backoff=$INITIAL_BACKOFF_SECONDS
  while [ "$attempt" -le "$PRESIGNED_MAX_ATTEMPTS" ]; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST -L --max-redirs 3 \
      --connect-timeout "$UPLOAD_CONNECT_TIMEOUT_SECONDS" \
      --max-time "$UPLOAD_MAX_TIME_SECONDS" \
      "$complete_url" \
      -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"evidenceId\": \"${evidence_id}\"}") || curl_exit=$?
    curl_exit=${curl_exit:-0}
    if [ "$curl_exit" -eq 0 ] && [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
      return 0
    fi
    if [ "$curl_exit" -ne 0 ] || [ "$http_code" = "429" ] || { [ "$http_code" -ge 500 ] && [ "$http_code" -lt 600 ]; }; then
      if [ "$attempt" -lt "$PRESIGNED_MAX_ATTEMPTS" ]; then
        echo -n "(step 3: HTTP ${http_code}, retry in ${backoff}s) "
        sleep "$backoff"
        attempt=$((attempt + 1))
        backoff=$((backoff * 2))
        continue
      fi
    fi
    echo -n "(step 3 failed: HTTP ${http_code}) "
    return 1
  done
  return 1
}

for FILE in "${FILES[@]}"; do
  FILENAME=$(basename "$FILE")
  if is_unedited_starter_stub "$FILE"; then
    echo "SKIPPED ${FILENAME} — unedited starter stub (replace the STARTER TEMPLATE banner to upload)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  FILE_SIZE=$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE")
  echo -n "Uploading ${FILENAME}... "

  # DevAudit-Installer#189 — large files use the presigned R2 URL flow
  # to bypass the portal's multipart body parser limit. If the portal
  # doesn't support presigned URLs (returns 255), fall back to multipart.
  if [ "$FILE_SIZE" -ge "$PRESIGNED_THRESHOLD_BYTES" ]; then
    PRESIGNED_RESULT=0
    upload_presigned "$FILE" || PRESIGNED_RESULT=$?
    if [ "$PRESIGNED_RESULT" -eq 0 ]; then
      echo "OK (${FILE_SIZE} bytes, presigned R2 upload)"
      SUCCEEDED=$((SUCCEEDED + 1))
      TOTAL_SIZE=$((TOTAL_SIZE + FILE_SIZE))
      continue
    elif [ "$PRESIGNED_RESULT" -ne 255 ]; then
      echo "FAILED (presigned upload after ${PRESIGNED_MAX_ATTEMPTS} attempts)"
      FAILED=$((FAILED + 1))
      continue
    fi
    # Result 255 — portal doesn't support presigned URLs, fall through
    # to the existing multipart flow.
  fi

  # `-L` follows 3xx redirects (devaudit-installer#143). The portal host
  # has moved before (devaudit.metasession.co → devaudit.ai); without -L
  # every consumer's CI silently fails on a stale base URL. `--max-redirs 3`
  # bounds the follow so a misconfigured redirect loop can't hang CI.
  CURL_ARGS=(
    -X POST -L --max-redirs 3
    --connect-timeout "$UPLOAD_CONNECT_TIMEOUT_SECONDS"
    --max-time "$UPLOAD_MAX_TIME_SECONDS"
    "$UPLOAD_URL"
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
  [ -n "$SDLC_STAGE" ] && CURL_ARGS+=(-F "sdlcStage=${SDLC_STAGE}")

  ATTEMPT=1
  BACKOFF=$INITIAL_BACKOFF_SECONDS
  HTTP_CODE=0
  RESP_BODY_FILE=""
  RESP_HEADERS_FILE=""
  LAST_CURL_ERROR=""
  while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
    [ -n "$RESP_BODY_FILE" ] && rm -f "$RESP_BODY_FILE"
    RESP_BODY_FILE=$(mktemp)
    RESP_HEADERS_FILE=$(mktemp)
    CURL_EXIT=0
    HTTP_CODE=$(curl -s -o "$RESP_BODY_FILE" -D "$RESP_HEADERS_FILE" -w "%{http_code}" "${CURL_ARGS[@]}") || CURL_EXIT=$?
    if [ "$CURL_EXIT" -ne 0 ]; then
      LAST_CURL_ERROR="curl exit ${CURL_EXIT}"
      if [ "$CURL_EXIT" -eq 28 ]; then
        LAST_CURL_ERROR="${LAST_CURL_ERROR} (timed out after ${UPLOAD_MAX_TIME_SECONDS}s)"
      fi
      if [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; then
        WAIT_SECONDS=$BACKOFF
        echo -n "(${LAST_CURL_ERROR}, retry in ${WAIT_SECONDS}s) "
        rm -f "$RESP_HEADERS_FILE"
        sleep "$WAIT_SECONDS"
        ATTEMPT=$((ATTEMPT + 1))
        BACKOFF=$((BACKOFF * 2))
        continue
      fi
      rm -f "$RESP_HEADERS_FILE"
      break
    fi
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
    if [ -n "$LAST_CURL_ERROR" ]; then
      echo "FAILED (${LAST_CURL_ERROR} after ${ATTEMPT} attempt(s))"
    else
      echo "FAILED (HTTP ${HTTP_CODE} after ${ATTEMPT} attempt(s))"
    fi
    if [ -s "$RESP_BODY_FILE" ]; then
      echo "  Response: $(head -c 500 "$RESP_BODY_FILE")"
    fi
    rm -f "$RESP_BODY_FILE"
    FAILED=$((FAILED + 1))
  fi
done

# --- Summary ---
echo ""
echo "=== Upload Summary ==="
echo "Files: ${SUCCEEDED} succeeded, ${FAILED} failed, ${SKIPPED} skipped (${#FILES[@]} total)"
echo "Total size: $((TOTAL_SIZE / 1024)) KB"
# Skipped stubs are intentional (devaudit#133) — they don't fail the
# run. Only true upload failures bump the exit code.
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
