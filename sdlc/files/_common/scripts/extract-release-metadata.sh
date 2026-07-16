#!/usr/bin/env bash
# extract-release-metadata.sh — Extract canonical tracked-release metadata.
#
# DevAudit-Installer#285 — Provides one shared extraction source of truth for
# tracked-release title and summary, usable from both CI workflow paths
# (ci.yml.template and compliance-evidence.yml.template).
#
# Usage:
#   source scripts/extract-release-metadata.sh
#   extract_release_metadata "REQ-089"
#
# Sets the following shell variables:
#   RELEASE_TITLE      — canonical human title (empty if none found)
#   RELEASE_SUMMARY    — reviewer-facing summary from ## Summary section (empty if none)
#
# Title fallback chain (normative per #285):
#   1. **Requirement:** line in RELEASE-TICKET-REQ-XXX.md → human part after "REQ-XXX —"
#   2. GitHub issue title from RTM row (best-effort, requires gh CLI)
#   3. Normalised ticket H1 only if no better source exists
#   4. Empty rather than garbage
#
# Summary rules:
#   - Capture content between ## Summary and the next ## heading
#   - Trim boilerplate / empty placeholders
#   - Empty if section absent or still a stub

set -euo pipefail

find_bundled_changes_file() {
  local req_id="$1"
  local candidate=""
  for candidate in \
    "compliance/pending-releases/BUNDLED-CHANGES-${req_id}.md" \
    "compliance/approved-releases/BUNDLED-CHANGES-${req_id}.md" \
    "compliance/superseded-releases/BUNDLED-CHANGES-${req_id}.md"; do
    if [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

find_bundled_manifest_file() {
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

extract_release_metadata() {
  local req_id="$1"
  RELEASE_TITLE=""
  RELEASE_SUMMARY=""

  local ticket_file=""
  for FILE in \
    "compliance/pending-releases/RELEASE-TICKET-${req_id}.md" \
    "compliance/approved-releases/RELEASE-TICKET-${req_id}.md"; do
    if [ -f "$FILE" ]; then
      ticket_file="$FILE"
      break
    fi
  done

  # --- Title extraction ---
  # 1. Try **Requirement:** REQ-XXX — <human title>
  if [ -n "$ticket_file" ]; then
    local req_line
    req_line=$(grep -m1 '^\*\*Requirement:\*\*' "$ticket_file" 2>/dev/null || true)
    if [ -n "$req_line" ]; then
      # Extract the human part after "REQ-XXX —"
      # Format: **Requirement:** REQ-089 — Some human title here
      RELEASE_TITLE=$(printf '%s' "$req_line" \
        | sed -E 's/^\*\*Requirement:\*\*[[:space:]]*//' \
        | sed -E 's/^REQ-[0-9]+[[:space:]]*[—–:-][[:space:]]*//' \
        | sed -E 's/[[:space:]]*$//')
    fi
  fi

  # 2. Fallback: GitHub issue title from RTM row
  if [ -z "$RELEASE_TITLE" ]; then
    local rtm_row
    rtm_row=$(grep -m1 "| ${req_id} " compliance/RTM.md 2>/dev/null || true)
    if [ -n "$rtm_row" ] && command -v gh >/dev/null 2>&1; then
      # Try to extract issue number from RTM row if present
      local issue_num
      issue_num=$(printf '%s' "$rtm_row" | grep -oE '#[0-9]+' | head -1 | tr -d '#' || true)
      if [ -n "$issue_num" ]; then
        RELEASE_TITLE=$(gh issue view "$issue_num" --json title --jq '.title' 2>/dev/null || true)
      fi
    fi
  fi

  # 3. Fallback: normalised ticket H1 (least preferred)
  if [ -z "$RELEASE_TITLE" ] && [ -n "$ticket_file" ]; then
    local h1_line
    h1_line=$(grep -m1 '^# ' "$ticket_file" 2>/dev/null || true)
    if [ -n "$h1_line" ]; then
      # Strip the leading "# " and any "Release Ticket — REQ-XXX" prefix
      RELEASE_TITLE=$(printf '%s' "$h1_line" \
        | sed -E 's/^# *//' \
        | sed -E 's/^Release Ticket[[:space:]]*[—:-][[:space:]]*//' \
        | sed -E 's/^REQ-[0-9]+[[:space:]]*[—:-][[:space:]]*//' \
        | sed -E 's/[[:space:]]*$//')
    fi
  fi

  # 4. If still empty, leave empty rather than inventing garbage

  # --- Summary extraction ---
  # Capture content between ## Summary and the next ## heading
  local summary_raw
  summary_raw=""
  if [ -n "$ticket_file" ]; then
    summary_raw=$(awk '
      /^## Summary/ { found=1; next }
      /^## / { if (found) exit }
      found { print }
    ' "$ticket_file" 2>/dev/null || true)
  fi

  if [ -n "$summary_raw" ]; then
    # Trim leading/trailing blank lines and trailing whitespace per line
    RELEASE_SUMMARY=$(printf '%s' "$summary_raw" \
      | sed -E 's/[[:space:]]+$//' \
      | awk 'NF { p=1 } p { print }' \
      | awk '{ lines[NR]=$0 } END { for (i=NR; i>=1; i--) { if (lines[i] ~ /[^[:space:]]/) { last=i; break } } for (i=1; i<=last; i++) print lines[i] }')
  fi

  # If summary is just placeholder/stub text, clear it
  if [ -n "$RELEASE_SUMMARY" ]; then
    local summary_lower
    summary_lower=$(printf '%s' "$RELEASE_SUMMARY" | tr '[:upper:]' '[:lower:]')
    case "$summary_lower" in
      *"placeholder"*|*"todo"*|*"tbd"*|*"to be completed"*|*"stub"*)
        RELEASE_SUMMARY=""
        ;;
    esac
  fi

  # If the tracked release has a generated bundled-changes artefact,
  # surface that fact in the release summary so the portal release row and
  # workflow metadata don't rely on the GitHub PR body as the only bundle
  # narrative. DevAudit-Installer#344.
  local bundled_file=""
  bundled_file=$(find_bundled_changes_file "$req_id" 2>/dev/null || true)
  if [ -n "$bundled_file" ]; then
    local bundled_note
    local bundled_manifest=""
    local manifest_hash=""
    bundled_manifest=$(find_bundled_manifest_file "$req_id" 2>/dev/null || true)
    if [ -n "$bundled_manifest" ] && command -v jq >/dev/null 2>&1; then
      manifest_hash=$(jq -r '.manifestHash // empty' "$bundled_manifest" 2>/dev/null || true)
    fi
    bundled_note="Bundled release context: see \`${bundled_file}\`."
    if [ -n "$bundled_manifest" ]; then
      bundled_note="${bundled_note} Manifest: \`${bundled_manifest}\`."
    fi
    if [ -n "$manifest_hash" ]; then
      bundled_note="${bundled_note} Hash: \`${manifest_hash}\`."
    fi
    if [ -n "$RELEASE_SUMMARY" ]; then
      case "$RELEASE_SUMMARY" in
        *"Bundled release context:"*) ;;
        *)
          RELEASE_SUMMARY="${RELEASE_SUMMARY}

${bundled_note}"
          ;;
      esac
    else
      RELEASE_SUMMARY="$bundled_note"
    fi
  fi
}
