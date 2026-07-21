#!/usr/bin/env bash
# generate-bundled-changes.sh
#
# Emits:
#   1. human-readable bundled-changes markdown on stdout
#   2. optional machine-readable bundle manifest JSON via --json-out
#
# Source of truth:
# - explicit predecessor release membership comes from release tickets
# - commit scanning contributes only non-release housekeeping work items
#
# Usage:
#   bash scripts/generate-bundled-changes.sh <since-ref> [<version>] [--json-out <path>]

set -euo pipefail

SINCE_REF="${1:-}"
VERSION="current release"
if [ "${2:-}" != "" ] && [[ "${2:-}" != --* ]]; then
  VERSION="$2"
  shift 2
else
  shift $(( $# > 0 ? 1 : 0 ))
fi

JSON_OUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --json-out) JSON_OUT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$SINCE_REF" ]; then
  echo "Usage: bash scripts/generate-bundled-changes.sh <since-ref> [<version>] [--json-out <path>]" >&2
  exit 1
fi

if ! git rev-parse --verify "$SINCE_REF" >/dev/null 2>&1; then
  echo "Error: ref '$SINCE_REF' not found in git history." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

HOUSEKEEPING_TYPES='^[0-9a-f]+[[:space:]]+(chore|docs|ci|build|test|revert|style|perf|refactor)(\([^)]+\))?!?:'
DATE_VERSION_RE='^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}([.][0-9]+)?$'

find_release_ticket() {
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

trim() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

extract_ticket_title() {
  local file="$1"
  local line=""
  line=$(grep -m1 '^\*\*Requirement:\*\*' "$file" 2>/dev/null || true)
  if [ -n "$line" ]; then
    printf '%s' "$line" \
      | sed -E 's/^\*\*Requirement:\*\*[[:space:]]*//' \
      | sed -E 's/^REQ-[0-9]+[[:space:]]*[—–:-][[:space:]]*//' \
      | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'
    return 0
  fi
  line=$(grep -m1 '^# ' "$file" 2>/dev/null || true)
  if [ -n "$line" ]; then
    printf '%s' "$line" \
      | sed -E 's/^# *//' \
      | sed -E 's/^Release Ticket[[:space:]]*[—:-][[:space:]]*//' \
      | sed -E 's/^REQ-[0-9]+[[:space:]]*[—:-][[:space:]]*//' \
      | sed -E 's/[[:space:]]*$//'
  fi
}

extract_ticket_summary() {
  local file="$1"
  awk '
    /^## Summary/ { found=1; next }
    /^## / { if (found) exit }
    found { print }
  ' "$file" 2>/dev/null \
    | sed -E 's/[[:space:]]+$//' \
    | awk 'NF { p=1 } p { print }' \
    | awk '{ lines[NR]=$0 } END { for (i=NR; i>=1; i--) { if (lines[i] ~ /[^[:space:]]/) { last=i; break } } for (i=1; i<=last; i++) print lines[i] }'
}

extract_ticket_pr() {
  local file="$1" line pr_num pr_url
  line=$(grep -m1 '^\*\*PR:\*\*' "$file" 2>/dev/null || true)
  pr_num=$(printf '%s' "$line" | grep -oE '#[0-9]+' | head -1 | tr -d '#' || true)
  pr_url=$(printf '%s' "$line" | grep -oE 'https://[^ )]+' | head -1 || true)
  printf '%s\t%s' "$pr_num" "$pr_url"
}

extract_explicit_predecessors() {
  local file="$1" line=""
  line=$(grep -m1 '^\- \*\*Absorbed predecessor releases:\*\*' "$file" 2>/dev/null || true)
  if [ -z "$line" ]; then
    return 0
  fi
  if printf '%s' "$line" | grep -qi '\bNone\b'; then
    return 0
  fi
  printf '%s' "$line" | grep -oE 'REQ-[0-9]+|v[0-9]{4}\.[0-9]{2}\.[0-9]{2}([.][0-9]+)?' || true
}

derive_commit_range() {
  local version="$1" file="$2"
  local from="" to="" sha=""
  if [[ "$version" =~ ^REQ-[0-9]+$ ]]; then
    while IFS= read -r sha; do
      [ -n "$sha" ] || continue
      [ -n "$from" ] || from="${sha:0:7}"
      to="${sha:0:7}"
    done < <(git log --reverse --format='%H' --grep "\\[${version}\\]\\|Ref: ${version}" 2>/dev/null || true)
  fi
  printf '%s\t%s' "$from" "$to"
}

CURRENT_TICKET="$(find_release_ticket "$VERSION" 2>/dev/null || true)"
if [ -z "$CURRENT_TICKET" ] && [ -d "compliance/pending-releases" ]; then
  echo "Error: release ticket for ${VERSION} not found; cannot build explicit bundle manifest." >&2
  exit 1
fi

mapfile -t CANDIDATE_RELEASES < <(
  if [ -d "compliance/pending-releases" ]; then
    for ticket in compliance/pending-releases/RELEASE-TICKET-*.md; do
      [ -f "$ticket" ] || continue
      version="${ticket##*/RELEASE-TICKET-}"
      version="${version%.md}"
      [ "$version" = "$VERSION" ] && continue
      printf '%s\n' "$version"
    done
  fi
)

mapfile -t EXPLICIT_PREDECESSORS < <(
  if [ -n "$CURRENT_TICKET" ]; then
    extract_explicit_predecessors "$CURRENT_TICKET"
  fi
)

declare -A EXPLICIT_SET=()
for version in "${EXPLICIT_PREDECESSORS[@]}"; do
  if [ "$version" = "$VERSION" ]; then
    echo "Error: bundle manifest cannot self-supersede ${VERSION}." >&2
    exit 1
  fi
  if [ -n "${EXPLICIT_SET[$version]:-}" ]; then
    echo "Error: duplicate explicit predecessor '${version}'." >&2
    exit 1
  fi
  EXPLICIT_SET["$version"]=1
  if [ -z "$(find_release_ticket "$version" 2>/dev/null || true)" ]; then
    echo "Error: explicit predecessor '${version}' has no release ticket on disk." >&2
    exit 1
  fi
done

if [ "${#CANDIDATE_RELEASES[@]}" -gt 0 ] && [ "${#EXPLICIT_PREDECESSORS[@]}" -eq 0 ]; then
  echo "Error: ambiguous predecessor ownership for ${VERSION}. Pending release tickets exist but the release ticket does not explicitly list absorbed predecessor releases." >&2
  printf 'Candidates: %s\n' "${CANDIDATE_RELEASES[*]}" >&2
  exit 1
fi

UNACCOUNTED=()
for version in "${CANDIDATE_RELEASES[@]}"; do
  if [ -z "${EXPLICIT_SET[$version]:-}" ]; then
    UNACCOUNTED+=("$version")
  fi
done
if [ "${#UNACCOUNTED[@]}" -gt 0 ]; then
  echo "Error: ambiguous predecessor ownership for ${VERSION}. The following pending releases are not explicitly listed in the release ticket bundle section:" >&2
  printf '  - %s\n' "${UNACCOUNTED[@]}" >&2
  exit 1
fi

MEMBERS='[]'
PREDECESSOR_LINES=()
for version in "${EXPLICIT_PREDECESSORS[@]}"; do
  ticket="$(find_release_ticket "$version")"
  title="$(extract_ticket_title "$ticket")"
  summary="$(extract_ticket_summary "$ticket")"
  pr_meta="$(extract_ticket_pr "$ticket")"
  pr_number="${pr_meta%%$'\t'*}"
  pr_url="${pr_meta#*$'\t'}"
  range_meta="$(derive_commit_range "$version" "$ticket")"
  commit_from="${range_meta%%$'\t'*}"
  commit_to="${range_meta#*$'\t'}"

  if [[ "$version" =~ $DATE_VERSION_RE ]]; then
    role="housekeeping"
    relationship="absorbed"
    reason="Explicit housekeeping release ticket carried forward into approval envelope ${VERSION}."
  else
    role="predecessor"
    relationship="superseded"
    reason="Explicit predecessor release absorbed into approval envelope ${VERSION}."
  fi

  MEMBERS="$(
    jq -c \
      --arg version "$version" \
      --arg role "$role" \
      --arg relationship "$relationship" \
      --arg reason "$reason" \
      --arg scopeSummary "$summary" \
      --arg commitFrom "$commit_from" \
      --arg commitTo "$commit_to" \
      --arg prNumber "$pr_number" \
      --arg prUrl "$pr_url" \
      --arg originalTitle "${title:-Release $version}" \
      '. + [{
        version: $version,
        role: $role,
        relationship: $relationship,
        reason: $reason,
        scopeSummary: (if $scopeSummary == "" then null else $scopeSummary end),
        commitFrom: (if $commitFrom == "" then null else $commitFrom end),
        commitTo: (if $commitTo == "" then null else $commitTo end),
        prNumber: (if $prNumber == "" then null else ($prNumber | tonumber) end),
        prUrl: (if $prUrl == "" then null else $prUrl end),
        originalTitle: $originalTitle,
        evidenceInheritancePolicy: {
          mode: "all_eligible",
          includeCycles: true,
          scopes: ["release", "stage", "cycle"],
          reason: $reason
        }
      }]' <<<"$MEMBERS"
  )"
  PREDECESSOR_LINES+=("- \`${version}\` (${role}/${relationship}) — ${title:-Untitled release ticket}")
done

# A tracked release only absorbs genuinely REQ-free housekeeping performed
# during its own implementation window. Do not recast earlier history, or a
# conventional commit explicitly owned by any REQ, as generic bundle work.
SCAN_FROM="$SINCE_REF"
if [[ "$VERSION" =~ ^REQ-[0-9]+$ ]]; then
  FIRST_REQ_SHA="$(git log --reverse --format='%H' --grep="\\[${VERSION}\\]\\|Ref: ${VERSION}" 2>/dev/null | head -1 || true)"
  if [ -n "$FIRST_REQ_SHA" ] && git rev-parse --verify "${FIRST_REQ_SHA}^" >/dev/null 2>&1; then
    SCAN_FROM="${FIRST_REQ_SHA}^"
  fi
fi
COMMITS="$(git log "$SCAN_FROM"..HEAD --format='%h%x09%s' 2>/dev/null || true)"
BUNDLED=""
while IFS=$'\t' read -r sha subject; do
  [ -n "$sha" ] || continue
  if ! printf '%s\t%s\n' "$sha" "$subject" | grep -Eq "$HOUSEKEEPING_TYPES"; then
    continue
  fi
  if git log -1 --format='%s%n%b' "$sha" | grep -Eq '\[REQ-[0-9]+\]|Ref:[[:space:]]*REQ-[0-9]+'; then
    continue
  fi
  BUNDLED+="${sha}"$'\t'"${subject}"$'\n'
done <<<"$COMMITS"
BUNDLED="${BUNDLED%$'\n'}"
NON_RELEASE_ITEMS='[]'
NON_RELEASE_LINES=()
if [ -n "$BUNDLED" ]; then
  while IFS=$'\t' read -r sha subject; do
    [ -n "$sha" ] || continue
    NON_RELEASE_ITEMS="$(
      jq -c \
        --arg kind "housekeeping_commit" \
        --arg title "$subject" \
        --arg reference "$sha" \
        '. + [{
          kind: $kind,
          title: $title,
          reference: $reference
        }]' <<<"$NON_RELEASE_ITEMS"
    )"
    NON_RELEASE_LINES+=("- \`${sha}\` ${subject}")
  done <<<"$BUNDLED"
fi

GENERATOR_VERSION="$(jq -r '.version' cli/package.json 2>/dev/null || echo '0.0.0')"
REPOSITORY_SLUG="$(git config --get remote.origin.url 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##' || true)"
GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
[ -n "$REPOSITORY_SLUG" ] || REPOSITORY_SLUG="${GITHUB_REPOSITORY:-local/unknown}"

MANIFEST_BASE="$(
  jq -c -n \
    --arg version "$VERSION" \
    --arg members "$MEMBERS" \
    --arg nonReleaseWorkItems "$NON_RELEASE_ITEMS" \
    --arg generatorVersion "$GENERATOR_VERSION" \
    --arg repository "$REPOSITORY_SLUG" \
    --arg generatedAt "$GENERATED_AT" \
    '{
      schemaVersion: 2,
      approvalRelease: { version: $version },
      coreRelease: { version: $version },
      members: ($members | fromjson),
      nonReleaseWorkItems: ($nonReleaseWorkItems | fromjson),
      generator: {
        name: "devaudit-installer",
        version: $generatorVersion,
        repository: (if $repository == "" then null else $repository end),
        generatedAt: $generatedAt
      }
    }'
)"

HASH_INPUT="$(jq -cS 'del(.generator.generatedAt)' <<<"$MANIFEST_BASE")"
MANIFEST_HASH="sha256:$(printf '%s' "$HASH_INPUT" | sha256sum | awk '{print $1}')"
MANIFEST_JSON="$(jq --arg manifestHash "$MANIFEST_HASH" '. + { manifestHash: $manifestHash }' <<<"$MANIFEST_BASE")"

if [ -n "$JSON_OUT" ]; then
  mkdir -p "$(dirname "$JSON_OUT")"
  jq -S . <<<"$MANIFEST_JSON" > "$JSON_OUT"
fi

echo "## Bundled Changes"
echo ""
echo "- **Core tracked release:** \`${VERSION}\`"
echo "- **Bundle manifest:** \`BUNDLED-CHANGES-${VERSION}.json\`"
echo "- **Manifest hash:** \`${MANIFEST_HASH}\`"
echo "- **Absorbed predecessor releases:** $(if [ "${#PREDECESSOR_LINES[@]}" -gt 0 ]; then printf '%s' "${EXPLICIT_PREDECESSORS[*]}"; else printf 'None'; fi)"
if [ "${#NON_RELEASE_LINES[@]}" -gt 0 ]; then
  echo "- **Absorbed non-release work:** housekeeping commits since \`${SINCE_REF}\`"
else
  echo "- **Absorbed non-release work:** None"
fi
echo "- **Why bundled here:** Explicit predecessor release tickets and non-release work are consolidated under approval envelope \`${VERSION}\`."
echo "- **Evidence impact:** Evidence ownership remains on the source releases; the bundle manifest provides lineage and inherited visibility only."
echo "- **Reviewer impact:** Approval scope includes the core tracked release plus the explicit predecessor releases and non-release work listed below."
echo "- **Security / risk impact:** No additional security/risk impact identified automatically; reviewer must confirm in the canonical release artifacts."
echo "- **Reference:** commit range \`${SCAN_FROM}..HEAD\`"
echo ""

echo "### Explicit Constituent Releases"
echo ""
if [ "${#PREDECESSOR_LINES[@]}" -gt 0 ]; then
  printf '%s\n' "${PREDECESSOR_LINES[@]}"
else
  echo "- None"
fi
echo ""

echo "### Absorbed Non-Release Work"
echo ""
if [ "${#NON_RELEASE_LINES[@]}" -gt 0 ]; then
  printf '%s\n' "${NON_RELEASE_LINES[@]}"
else
  echo "- None"
fi
echo ""
