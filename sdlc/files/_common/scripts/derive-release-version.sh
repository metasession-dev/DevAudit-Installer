#!/usr/bin/env bash
# derive-release-version.sh — Pick the release version for CI uploads from
# the latest commit's REQ tag, falling back to a bare date.
#
# Usage:
#   VERSION=$(./scripts/derive-release-version.sh)
#
# Priority:
#   0. Declared-bundle manifest:      exactly one
#                                      compliance/pending-releases/BUNDLED-CHANGES-REQ-XXX.md
#                                      carrying a "Co-Tracked Bundle Members"
#                                      section (devaudit-installer#736)
#                                                                    -> REQ-XXX
#   1. REQ tag in commit subject:     "[REQ-037] feat(kitchen): ..." -> REQ-037
#   2. Ref in commit body:            "Ref: REQ-037"                 -> REQ-037
#   3. Bracketed tag in commit body:   merge commit whose body is the PR title
#                                      "... [REQ-037] ..."           -> REQ-037
#   3-bis. Merge-range scan:          HEAD is a two-parent merge commit and
#                                      exactly one distinct REQ tag appears
#                                      across the commits it merged in
#                                                                    -> REQ-XXX
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
# A pending ticket or RTM row is not commit ownership. In particular, an
# independent main hotfix must not become part of an active UAT REQ merely
# because its mandatory back-merge lands while that REQ is the only pending
# ticket. The optional fallback below is disabled by default and may be used
# only for an explicitly reviewed integration exception.
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
# Step 3-bis (DevAudit-Installer#581): steps 1-3 only ever look at the tip
# commit. A standard GitHub "Merge pull request" commit whose own
# subject/body carry no bracketed tag or Ref: line — but whose *underlying*,
# commitlint-enforced commits do — fell all the way through to the bare-date
# fallback even though every commit in the merge was properly tagged
# (wawagardenbar-app REQ-095, PR #606: subject had no brackets, body's only
# "REQ-095" mention was unbracketed prose). When HEAD has exactly two
# parents, scan every commit reachable from the second parent but not the
# first (the commits this merge actually introduced) for a bracketed tag or
# Ref: line. Exactly one distinct REQ across that range wins; zero or
# multiple (a bundled/mixed merge) is ambiguous and falls through unchanged,
# same guard discipline as steps 4/4-bis.
#
# This ties a release record (project_id, version) to the feature the
# commits belong to, so all CI uploads for one REQ converge on one
# release container — fixing the fragmentation described in DevAudit #310.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/derive-release-version.sh

set -euo pipefail

# 0. Declared-bundle manifest (devaudit-installer#736) — takes priority over
# steps 1-3 below. A shared bundle branch's individual commits are each
# tagged with their own REQ, so step 1's "first bracketed tag wins" would
# silently misattribute the release to whichever REQ happened to tag the
# tip commit, dropping the other bundled REQ(s)' provenance. When exactly
# one compliance/pending-releases/BUNDLED-CHANGES-*.md file exists AND it
# was authored as a declared bundle (carries the "Co-Tracked Bundle
# Members" section generate-bundled-changes.sh's --declared-bundle mode
# writes, as opposed to a retroactive predecessor/housekeeping-absorption-
# only bundle with no such section), its filename's REQ-XXX is the
# authoritative bundle version. Zero or more than one such file is
# ambiguous and falls through to steps 1-5 unchanged, same guard discipline
# as steps 4/4-bis.
if [ -d compliance/pending-releases ]; then
  DECLARED_BUNDLE_FILES=()
  while IFS= read -r -d '' f; do
    DECLARED_BUNDLE_FILES+=("$f")
  done < <(find compliance/pending-releases -maxdepth 1 -name 'BUNDLED-CHANGES-REQ-*.md' -print0 2>/dev/null)
  if [ "${#DECLARED_BUNDLE_FILES[@]}" -eq 1 ] && grep -q 'Co-Tracked Bundle Members' "${DECLARED_BUNDLE_FILES[0]}" 2>/dev/null; then
    basename_no_ext="$(basename "${DECLARED_BUNDLE_FILES[0]}" .md)"
    echo "${basename_no_ext#BUNDLED-CHANGES-}"
    exit 0
  fi
fi

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

# 3-bis. Merge-range scan (DevAudit-Installer#581): if HEAD is a standard
# two-parent merge commit, scan the commits it merged in (second parent,
# excluding anything already reachable from the first) for a bracketed
# [REQ-XXX] tag or a Ref: REQ-XXX line, same bracketed-only/Ref-line
# discipline as steps 1-3. A single-parent HEAD (no merge, e.g. a squash or
# fast-forward push) has nothing to scan here and falls through unchanged.
#
# Per-commit, not range-wide (devaudit#772): a close-out reconciliation
# commit's own body carries both a `Release-Closeout: REQ-XXX` suppression
# marker AND a `Ref: REQ-XXX` trailer (the trailer is the traceability
# convention every commit gets; the marker is what step 4-ter uses to
# suppress it). Scanning the range's bodies concatenated together let that
# commit's own Ref: win here before step 4-ter ever ran on it, defeating
# its own suppression. Any commit in the range that carries a
# Release-Closeout marker is excluded from this scan entirely, so its
# Ref:/[REQ-XXX] mentions can't resolve a version 4-ter would have
# suppressed.
PARENTS=$(git log -1 --format='%P' 2>/dev/null || echo '')
if [ "$(echo "$PARENTS" | wc -w)" = "2" ]; then
  FIRST_PARENT=$(echo "$PARENTS" | awk '{print $1}')
  SECOND_PARENT=$(echo "$PARENTS" | awk '{print $2}')
  RANGE_REQS=$(git log "${FIRST_PARENT}..${SECOND_PARENT}" --format='%H' 2>/dev/null \
    | while IFS= read -r RANGE_SHA; do
        RANGE_BODY=$(git log -1 --format='%B' "$RANGE_SHA" 2>/dev/null || echo '')
        if echo "$RANGE_BODY" | grep -qE '^Release-Closeout:[[:space:]]*REQ-[0-9]{3,}'; then
          continue
        fi
        echo "$RANGE_BODY" | grep -ioE '(\[REQ-[0-9]+\]|Ref:[[:space:]]*REQ-[0-9]+)'
      done \
    | grep -oiE 'REQ-[0-9]+' | tr '[:lower:]' '[:upper:]' | sort -u || true)
  RANGE_REQ_COUNT=$(echo "$RANGE_REQS" | grep -c . || true)
  if [ "$RANGE_REQ_COUNT" = "1" ]; then
    echo "$RANGE_REQS"
    exit 0
  fi
  if [ "$RANGE_REQ_COUNT" -gt 1 ] 2>/dev/null; then
    echo "::warning::Merge range ${FIRST_PARENT:0:7}..${SECOND_PARENT:0:7} carries multiple distinct REQ tags ($(echo "$RANGE_REQS" | tr '\n' ' ')); refusing to guess which owns this release, falling through to disk/date fallback." >&2
  fi
  # No REQ resolved from the range once close-out commits are excluded
  # (devaudit#772): if the range contains a Release-Closeout marker at
  # all, this merge is entirely accounted for by an already-closed-out
  # REQ (a "sync main + reconcile" merge whose only introduced commit is
  # the reconciliation commit itself) — suppress here rather than
  # falling through to steps 4/4-bis/5, which know nothing of this range
  # and would derive a spurious housekeeping stub. Step 4-ter below only
  # ever sees HEAD's own body, which a standard "Merge pull request"
  # commit doesn't carry the marker on — this is the range-scan
  # equivalent of that suppression.
  if [ "$RANGE_REQ_COUNT" = "0" ]; then
    if git log "${FIRST_PARENT}..${SECOND_PARENT}" --pretty=%B 2>/dev/null \
      | grep -qE '^Release-Closeout:[[:space:]]*REQ-[0-9]{3,}'; then
      exit 0
    fi
  fi
fi

# 4. Pending release ticket on disk: when exactly one
# `compliance/pending-releases/RELEASE-TICKET-REQ-*.md` is present, the
# operator's explicit state says THIS is the in-flight release. Use it.
# Zero or multiple → ambiguous, fall through to the bare date.
# DevAudit-Installer#92.
#
# The candidate is computed regardless of the enable flag (devaudit#581,
# Option B) so a resolvable-but-disabled candidate is a visible warning, not
# a silent bare-date resolution — the flag gates whether it's *used*, not
# whether its existence is surfaced.
if [ -d compliance/pending-releases ]; then
  # NUL-delimited count so filenames with spaces don't trip us up.
  TICKET_COUNT=$(find compliance/pending-releases -maxdepth 1 -type f \
    -name 'RELEASE-TICKET-REQ-*.md' -print0 2>/dev/null \
    | tr -cd '\0' | wc -c)
  if [ "$TICKET_COUNT" = "1" ]; then
    TICKET_CANDIDATE=$(find compliance/pending-releases -maxdepth 1 -type f \
      -name 'RELEASE-TICKET-REQ-*.md' -print 2>/dev/null \
      | head -1 | xargs -n1 basename \
      | sed -E 's/^RELEASE-TICKET-(REQ-[0-9]+)\.md$/\1/')
    if [ "${DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK:-0}" = "1" ]; then
      echo "$TICKET_CANDIDATE"
      exit 0
    else
      echo "::warning::Exactly one pending release ticket (${TICKET_CANDIDATE}) exists but DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK is not set to 1 — falling through to the bare-date fallback instead of attributing this run to it. Set DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK=1 to enable this fallback." >&2
    fi
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
      if [ "${DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK:-0}" = "1" ]; then
        echo "$IN_PROGRESS_REQS"
        exit 0
      else
        echo "::warning::Exactly one RTM row (${IN_PROGRESS_REQS}) is IN PROGRESS but DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK is not set to 1 — falling through to the bare-date fallback instead of attributing this run to it. Set DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK=1 to enable this fallback." >&2
      fi
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
