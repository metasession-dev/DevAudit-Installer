#!/usr/bin/env bash
# derive-release-version.sh — Pick the release version for CI uploads from
# the latest commit's REQ tag, falling back to a bare date.
#
# Usage:
#   VERSION=$(./scripts/derive-release-version.sh)
#
# Priority:
#   1. REQ tag in commit subject:     "[REQ-037] feat(kitchen): ..." -> REQ-037
#   2. Ref in commit body:            "Ref: REQ-037"                 -> REQ-037
#   3. Bracketed tag in commit body:   merge commit whose body is the PR title
#                                      "... [REQ-037] ..."           -> REQ-037
#   4. Pending release ticket on disk: exactly one
#                                      compliance/pending-releases/RELEASE-TICKET-REQ-XXX.md
#                                                                    -> REQ-XXX
#   4-bis. RTM.md IN PROGRESS row:    exactly one tracked REQ marked
#                                      IN PROGRESS in compliance/RTM.md
#                                                                    -> REQ-XXX
#   4-ter. Close-out marker:           commit body contains
#                                      "Release-Closeout: REQ-XXX"
#                                      (devaudit#284 — suppresses false
#                                      housekeeping stubs from release
#                                      reconciliation merges)
#                                                                    -> empty/skip
#   5. Fallback:                      bare date                      -> v2026.05.17
#
# Step 4 (DevAudit-Installer#92) handles `chore:` / `docs:` / `ci:`
# commits (e.g. a `devaudit update` sync) landing on the integration
# branch between feature merge and release-PR open. Such a commit has
# no REQ tag in its message → steps 1-3 fall through. The release
# ticket on disk is a stronger explicit-operator-state signal than the
# bare date — when exactly one ticket is open, attribute to it.
# Multiple open tickets stays ambiguous → bare-date fallback.
#
# Note (DevAudit-Installer#220): `devaudit update` syncs now include
# `[skip ci]` in their commit message, so they no longer trigger CI
# at all. The bare-date fallback (step 5) is therefore reached only by
# human-authored housekeeping commits — the intended use case. Skipped
# housekeeping changes are bundled into the next REQ release via
# `generate-bundled-changes.sh` (run by the register-release CI job).
#
# Step 4-bis (DevAudit-Installer#95) is the zero-ceremony equivalent:
# RTM.md is the file the operator already maintains as the source of
# truth for release state. When step 4 finds no ticket and exactly one
# RTM row is IN PROGRESS, attribute to it. RTM_PATH defaults to
# compliance/RTM.md and is overridable via env.
#
# The id is taken from a bracketed [REQ-XXX] tag (subject or body) or the
# `Ref:` line — NOT from unbracketed prose (e.g. "target close: REQ-002" must
# not win over "Ref: REQ-001"). Step 3 exists because a "Merge pull request"
# commit carries the PR title (with its [REQ-XXX] tag) in the body, not the
# subject — without it, PR-merged work falls through to the date fallback and
# fragments onto a phantom date release. Output: single line on stdout.
#
# This ties a release record (project_id, version) to the feature the
# commits belong to, so all CI uploads for one REQ converge on one
# release container — fixing the fragmentation described in DevAudit #310.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/derive-release-version.sh

set -euo pipefail

SUBJECT=$(git log -1 --format='%s' 2>/dev/null || echo '')
BODY=$(git log -1 --format='%b' 2>/dev/null || echo '')

# 1. Subject: [REQ-XXX] — the bracketed tag only, not other REQ mentions.
if echo "$SUBJECT" | grep -qE '\[REQ-[0-9]+\]'; then
  echo "$SUBJECT" | grep -oE '\[REQ-[0-9]+\]' | head -1 | grep -oE 'REQ-[0-9]+'
  exit 0
fi

# 2. Body: the id on the `Ref:` line only (case-insensitive on "Ref"/"REQ").
# Scoping to the Ref: line prevents a prose mention earlier in the body
# (e.g. "target close: REQ-002") from being picked over the real ref.
if echo "$BODY" | grep -qiE 'Ref:[[:space:]]*REQ-[0-9]+'; then
  echo "$BODY" | grep -ioE 'Ref:[[:space:]]*REQ-[0-9]+' | head -1 | grep -oiE 'REQ-[0-9]+' | tr '[:lower:]' '[:upper:]'
  exit 0
fi

# 3. Body: a bracketed [REQ-XXX] anywhere in the body. Catches a merge commit
# whose body is the PR title — e.g. subject "Merge pull request #7 from …",
# body "chore(deps): [REQ-002] …". Bracketed-only, so an unbracketed prose
# mention ("target close: REQ-002") still cannot win over a real Ref: above.
if echo "$BODY" | grep -qE '\[REQ-[0-9]+\]'; then
  echo "$BODY" | grep -oE '\[REQ-[0-9]+\]' | head -1 | grep -oE 'REQ-[0-9]+'
  exit 0
fi

# 4. Pending release ticket on disk: when exactly one
# `compliance/pending-releases/RELEASE-TICKET-REQ-*.md` is present, the
# operator's explicit state says THIS is the in-flight release. Use it.
# Zero or multiple → ambiguous, fall through to the bare date.
# DevAudit-Installer#92.
if [ -d compliance/pending-releases ]; then
  # NUL-delimited count so filenames with spaces don't trip us up.
  TICKET_COUNT=$(find compliance/pending-releases -maxdepth 1 -type f \
    -name 'RELEASE-TICKET-REQ-*.md' -print0 2>/dev/null \
    | tr -cd '\0' | wc -c)
  if [ "$TICKET_COUNT" = "1" ]; then
    find compliance/pending-releases -maxdepth 1 -type f \
      -name 'RELEASE-TICKET-REQ-*.md' -print 2>/dev/null \
      | head -1 | xargs -n1 basename \
      | sed -E 's/^RELEASE-TICKET-(REQ-[0-9]+)\.md$/\1/'
    exit 0
  fi
fi

# 4-bis. RTM.md IN PROGRESS row: when exactly one REQ row in
# compliance/RTM.md (or $RTM_PATH) is marked IN PROGRESS, attribute the
# in-flight release to it. Reads the file the operator already
# maintains so chore/docs/ci sync commits don't need a manually-dropped
# pending-tickets file. Same exactly-one guard as step 4 — zero or
# multiple IN PROGRESS rows → ambiguous, fall through.
# DevAudit-Installer#95.
RTM_PATH="${RTM_PATH:-compliance/RTM.md}"
if [ -f "$RTM_PATH" ]; then
  # Match REQ rows whose status column starts with `IN PROGRESS`.
  # `\|[[:space:]]+IN PROGRESS` requires a pipe followed by whitespace,
  # so legend rows (`| \`IN PROGRESS\``) and prose mentions don't match.
  # Variable padding between REQ-ID and Status (Issue/Risk/Evidence
  # columns) is fine — only the leading REQ-XXX and the status-cell
  # marker matter.
  IN_PROGRESS_REQS=$(sed 's/\\|/  /g' "$RTM_PATH" 2>/dev/null \
    | grep -E '\|[[:space:]]+IN PROGRESS' \
    | grep -oE '^\|[[:space:]]*REQ-[0-9]+' \
    | grep -oE 'REQ-[0-9]+' | sort -u || true)
  if [ -n "$IN_PROGRESS_REQS" ]; then
    IN_PROGRESS_COUNT=$(echo "$IN_PROGRESS_REQS" | grep -c .)
    if [ "$IN_PROGRESS_COUNT" = "1" ]; then
      echo "$IN_PROGRESS_REQS"
      exit 0
    fi
  fi
fi

# 4-ter. Close-out marker suppression (devaudit#284).
# A push that is solely the result of completing a tracked release's
# reconciliation/close-out path must not derive a bare-date housekeeping
# release. The close-out workflow (devaudit#281) emits a structured
# `Release-Closeout: REQ-XXX` marker in the merge commit body. When
# present, emit no version. Workflow callers translate the empty result
# to an explicit `skip` sentinel so reconciliation pushes neither create
# housekeeping releases nor attach new evidence to an already released REQ.
if echo "$BODY" | grep -qE '^Release-Closeout:[[:space:]]*REQ-[0-9]{3,}'; then
  exit 0
fi

# 5. Fallback: bare date in UTC
echo "v$(date -u +%Y.%m.%d)"
