#!/usr/bin/env bash
# close-out-release.sh — Reconcile the local compliance tree after a release
# is marked `released` on the DevAudit portal.
#
# For the governing requirement it: flips the release ticket Status -> RELEASED
# (backlinks the release PR + records the sign-off), flips the matching
# compliance/RTM.md row -> RELEASED, and moves the ticket from
# compliance/pending-releases/ to compliance/approved-releases/.
#
# If the release carries a bundle manifest, explicit predecessor members are
# reconciled too: their release tickets move to compliance/superseded-releases/,
# ticket status flips to SUPERSEDED, the successor + reason are recorded, and
# tracked REQ rows in compliance/RTM.md flip to SUPERSEDED. This keeps absorbed
# predecessor releases from looking abandoned after the successor approval
# envelope closes.
#
# The script stages the changes but does NOT commit — the caller (the close-out
# workflow, or a human) commits/opens the PR.
#
# Usage:
#   ./scripts/close-out-release.sh <REQ-ID> [--release-pr <url-or-number>]
#
# Example:
#   ./scripts/close-out-release.sh REQ-046 --release-pr 138
#
# Optional environment (portal safety check — recommended in CI):
#   DEVAUDIT_API_KEY  + DEVAUDIT_BASE_URL  — when both are set, the script
#     confirms the portal reports the release as `released` before flipping
#     anything, refusing otherwise (prevents local "RELEASED" while the portal
#     is still at prod_review). When unset, it warns and proceeds (manual mode).
#
# Idempotent: if the ticket is already in approved-releases/ with Status
# RELEASED (and the RTM row already RELEASED), it exits 0 as a no-op.

set -euo pipefail

REQ_ID="${1:-}"
RELEASE_PR=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --release-pr) RELEASE_PR="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if ! printf '%s' "$REQ_ID" | grep -qE '^REQ-[0-9]{3,}$'; then
  echo "Usage: $0 <REQ-ID> [--release-pr <url-or-number>]   (REQ-ID like REQ-046)" >&2
  exit 2
fi

PENDING="compliance/pending-releases/RELEASE-TICKET-${REQ_ID}.md"
APPROVED_DIR="compliance/approved-releases"
SUPERSEDED_DIR="compliance/superseded-releases"
APPROVED="${APPROVED_DIR}/RELEASE-TICKET-${REQ_ID}.md"
RTM="compliance/RTM.md"
TODAY="$(date +%Y-%m-%d)"

find_bundle_manifest_file() {
  local req_id="$1"
  local candidate=""
  for candidate in \
    "compliance/pending-releases/BUNDLED-CHANGES-${req_id}.json" \
    "compliance/approved-releases/BUNDLED-CHANGES-${req_id}.json" \
    "compliance/superseded-releases/BUNDLED-CHANGES-${req_id}.json"; do
    if [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

find_release_ticket_file() {
  local version="$1"
  local candidate=""
  for candidate in \
    "compliance/pending-releases/RELEASE-TICKET-${version}.md" \
    "compliance/approved-releases/RELEASE-TICKET-${version}.md" \
    "compliance/superseded-releases/RELEASE-TICKET-${version}.md"; do
    if [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

update_rtm_status() {
  local req_id="$1"
  local target_status="$2"
  local tmp_file
  tmp_file="$(mktemp)"
  if [ -f "$RTM" ] && grep -qE "^\| ${req_id} " "$RTM"; then
    awk -v req="$req_id" -v target_status="$target_status" '
      BEGIN { FS="|"; OFS="|"; statuscol=0 }
      /\\\|/ { gsub(/\\\|/, "\001", $0) }
      {
        cand=0; idseen=0
        for (i=1; i<=NF; i++) {
          c=$i; gsub(/^[[:space:]]+|[[:space:]]+$/, "", c)
          if (c=="Status") cand=i
          if (c=="ID" || c=="REQ-ID" || c=="REQ ID" || c ~ /^Requirement/) idseen=1
        }
        if (cand>0 && idseen) statuscol=cand
      }
      $0 ~ ("^\\| " req " ") && statuscol>0 {
        cell=$statuscol
        note=""
        if (match(cell, /\(/)) note=substr(cell, RSTART)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", note)
        $statuscol = (note != "" ? " " target_status " " note " " : " " target_status " ")
        gsub(/\001/, "\\|", $0)
        print; next
      }
      { gsub(/\001/, "\\|", $0); print }
    ' "$RTM" > "$tmp_file" && mv "$tmp_file" "$RTM"
    git add "$RTM" 2>/dev/null || true
    echo "RTM row ${req_id} -> ${target_status}."
  else
    rm -f "$tmp_file"
  fi
}

mark_ticket_superseded() {
  local version="$1"
  local reason="$2"
  local relationship="$3"
  local source_path target_path tmp_file
  source_path="$(find_release_ticket_file "$version" 2>/dev/null || true)"
  [ -n "$source_path" ] || return 0

  mkdir -p "$SUPERSEDED_DIR"
  target_path="${SUPERSEDED_DIR}/RELEASE-TICKET-${version}.md"
  if [ "$source_path" != "$target_path" ]; then
    git mv "$source_path" "$target_path" 2>/dev/null || mv "$source_path" "$target_path"
    echo "Moved predecessor ticket -> ${target_path}"
  fi

  tmp_file="$(mktemp)"
  awk \
    -v successor="$REQ_ID" \
    -v superseded_on="$TODAY" \
    -v superseded_reason="$reason" \
    -v superseded_relationship="$relationship" '
      BEGIN {
        status_done=0
        successor_seen=0
        reason_seen=0
        relationship_seen=0
        date_seen=0
      }
      /^\*\*Status:\*\*/ && status_done==0 {
        print "**Status:** SUPERSEDED"
        status_done=1
        next
      }
      /^\*\*Superseded by:\*\*/ {
        print "**Superseded by:** " successor
        successor_seen=1
        next
      }
      /^\*\*Supersession reason:\*\*/ {
        print "**Supersession reason:** " superseded_reason
        reason_seen=1
        next
      }
      /^\*\*Supersession relationship:\*\*/ {
        print "**Supersession relationship:** " superseded_relationship
        relationship_seen=1
        next
      }
      /^\*\*Superseded on:\*\*/ {
        print "**Superseded on:** " superseded_on
        date_seen=1
        next
      }
      { print }
      /^\*\*DevAudit Release:\*\*/ {
        if (!successor_seen) print "**Superseded by:** " successor
        if (!reason_seen) print "**Supersession reason:** " superseded_reason
        if (!relationship_seen) print "**Supersession relationship:** " superseded_relationship
        if (!date_seen) print "**Superseded on:** " superseded_on
      }
    ' "$target_path" > "$tmp_file"
  mv "$tmp_file" "$target_path"
  git add "$target_path" 2>/dev/null || true
  echo "Ticket ${version} -> SUPERSEDED."

  if printf '%s' "$version" | grep -qE '^REQ-[0-9]{3,}$'; then
    update_rtm_status "$version" "SUPERSEDED"
  fi
}

# ── Optional portal safety check ─────────────────────────────────────────────
if [ -n "${DEVAUDIT_API_KEY:-}" ] && [ -n "${DEVAUDIT_BASE_URL:-}" ]; then
  BASE="${DEVAUDIT_BASE_URL%/}"
  SLUG="$(jq -r '.devaudit.project_slug // .project_slug // empty' sdlc-config.json 2>/dev/null || true)"
  STATUS="$(curl -s -H "Authorization: Bearer ${DEVAUDIT_API_KEY}" \
    "${BASE}/api/ci/releases/resolve?projectSlug=${SLUG}&versionPrefix=${REQ_ID}" 2>/dev/null \
    | jq -r '.latest.status // empty' 2>/dev/null || true)"
  if [ -n "$STATUS" ] && [ "$STATUS" != "released" ]; then
    echo "::error::Portal reports ${REQ_ID} as '${STATUS}', not 'released'. Refusing to close out." >&2
    exit 1
  fi
  [ "$STATUS" = "released" ] && echo "Portal confirms ${REQ_ID} is released."
else
  echo "::warning::DEVAUDIT_API_KEY/DEVAUDIT_BASE_URL not set — skipping portal status check (manual mode)."
fi

# ── Idempotency ──────────────────────────────────────────────────────────────
if [ ! -f "$PENDING" ] && [ -f "$APPROVED" ]; then
  if grep -qE '^\*\*Status:\*\*[[:space:]]*RELEASED' "$APPROVED"; then
    echo "${REQ_ID} already closed out (ticket in approved-releases/, Status RELEASED) — no-op."
    exit 0
  fi
fi
if [ ! -f "$PENDING" ] && [ ! -f "$APPROVED" ]; then
  echo "::error::No RELEASE-TICKET-${REQ_ID}.md in pending-releases/ or approved-releases/." >&2
  exit 1
fi

# ── Move ticket pending -> approved (if still pending) ───────────────────────
mkdir -p "$APPROVED_DIR"
mkdir -p "$SUPERSEDED_DIR"
if [ -f "$PENDING" ]; then
  git mv "$PENDING" "$APPROVED" 2>/dev/null || mv "$PENDING" "$APPROVED"
  echo "Moved ticket -> ${APPROVED}"
fi

# ── Flip ticket Status + backlink + sign-off (edit AFTER the move, then stage —
#    avoids leaving content edits unstaged behind a rename) ────────────────────
TMP="$(mktemp)"
SIGN_OFF="**Sign-off (dual-actor):** UAT approved + Production approved on the DevAudit portal (\`released\`); post-deploy production smoke evidence captured. Closed out ${TODAY}."
PR_LINE=""
if [ -n "$RELEASE_PR" ]; then
  case "$RELEASE_PR" in
    http*) PR_LINE="**Release PR:** ${RELEASE_PR}" ;;
    *)     PR_LINE="**Release PR:** #${RELEASE_PR}" ;;
  esac
fi
awk -v signoff="$SIGN_OFF" -v prline="$PR_LINE" '
  BEGIN { status_done=0; signoff_added=0 }
  # Flip the first Status line.
  /^\*\*Status:\*\*/ && status_done==0 { print "**Status:** RELEASED"; status_done=1; next }
  # Replace a placeholder Release PR line if present and a PR was supplied.
  /^\*\*Release PR:\*\*/ && prline!="" { print prline; next }
  { print }
  # After the DevAudit Release line, append the sign-off (once) if not already present.
  /^\*\*DevAudit Release:\*\*/ && signoff_added==0 {
    print signoff; signoff_added=1
  }
' "$APPROVED" > "$TMP"
# Only add a Release PR line if there was no existing one to replace.
if [ -n "$PR_LINE" ] && ! grep -qE '^\*\*Release PR:\*\*' "$TMP"; then
  awk -v prline="$PR_LINE" '
    /^\*\*DevAudit Release:\*\*/ { print prline }
    { print }
  ' "$TMP" > "${TMP}.2" && mv "${TMP}.2" "$TMP"
fi
mv "$TMP" "$APPROVED"
git add "$APPROVED" 2>/dev/null || true
echo "Ticket Status -> RELEASED."

update_rtm_status "$REQ_ID" "RELEASED" || true
if ! grep -qE "^\| ${REQ_ID} " "$RTM" 2>/dev/null; then
  echo "::warning::No RTM row for ${REQ_ID} in ${RTM} — skipped RTM flip."
fi

# ── Reconcile explicit predecessors from the bundle manifest ──────────────────
BUNDLE_MANIFEST="$(find_bundle_manifest_file "$REQ_ID" 2>/dev/null || true)"
if [ -n "$BUNDLE_MANIFEST" ] && command -v jq >/dev/null 2>&1; then
  while IFS=$'\t' read -r member_version member_reason member_relationship; do
    [ -n "$member_version" ] || continue
    mark_ticket_superseded "$member_version" "$member_reason" "$member_relationship"
  done < <(
    jq -r --arg successor "$REQ_ID" '
      (.members // [])
      | map(select((.relationship // "") == "superseded" or (.relationship // "") == "absorbed"))
      | .[]
      | [
          (.version // ""),
          (.reason // ("Absorbed into successor release " + $successor + ".")),
          (.relationship // "superseded")
        ]
      | @tsv
    ' "$BUNDLE_MANIFEST" 2>/dev/null || true
  )
fi

echo "Close-out staged for ${REQ_ID}. Commit + open a PR to develop to land it."
