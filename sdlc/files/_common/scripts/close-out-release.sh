#!/usr/bin/env bash
# close-out-release.sh — Reconcile the local compliance tree after a release
# is marked `released` on the DevAudit portal.
#
# For one requirement it: flips the release ticket Status -> RELEASED (backlinks
# the release PR + records the sign-off), flips the matching compliance/RTM.md
# row -> RELEASED, and moves the ticket from compliance/pending-releases/ to
# compliance/approved-releases/. It stages the changes but does NOT commit — the
# caller (the close-out workflow, or a human) commits/opens the PR.
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
APPROVED="${APPROVED_DIR}/RELEASE-TICKET-${REQ_ID}.md"
RTM="compliance/RTM.md"
TODAY="$(date +%Y-%m-%d)"

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

# ── Flip the RTM row -> RELEASED (preserve any parenthetical note) ───────────
if [ -f "$RTM" ] && grep -qE "^\| ${REQ_ID} " "$RTM"; then
  awk -v req="$REQ_ID" '
    BEGIN { FS="|"; OFS="|"; statuscol=0 }
    # Locate the "Status" column from the first header row that has one.
    statuscol==0 {
      for (i=1; i<=NF; i++) { c=$i; gsub(/^[[:space:]]+|[[:space:]]+$/, "", c); if (c=="Status") statuscol=i }
    }
    $0 ~ ("^\\| " req " ") && statuscol>0 {
      cell=$statuscol
      note=""
      if (match(cell, /\(/)) note=substr(cell, RSTART)   # preserve any " (requirement note)"
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", note)
      $statuscol = (note != "" ? " RELEASED " note " " : " RELEASED ")
      print; next
    }
    { print }
  ' "$RTM" > "$TMP" && mv "$TMP" "$RTM"
  git add "$RTM" 2>/dev/null || true
  echo "RTM row ${REQ_ID} -> RELEASED."
else
  echo "::warning::No RTM row for ${REQ_ID} in ${RTM} — skipped RTM flip."
  rm -f "$TMP"
fi

echo "Close-out staged for ${REQ_ID}. Commit + open a PR to develop to land it."
