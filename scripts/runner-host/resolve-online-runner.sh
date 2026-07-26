#!/usr/bin/env bash
set -euo pipefail

ORG="${1:?GitHub organization is required}"
LABEL="${2:?unique runner label is required}"
TOKEN="${ORG_RUNNER_READ_TOKEN:-${GH_TOKEN:-}}"

if [ -z "$TOKEN" ]; then
  echo "::error::ORG_RUNNER_READ_TOKEN is required to inspect organization runners." >&2
  exit 2
fi

RUNNERS="$(GH_TOKEN="$TOKEN" gh api --paginate "/orgs/${ORG}/actions/runners")"
MATCHES="$(jq --arg target "$LABEL" '
  [.runners[] |
    select(any(.labels[]?; .name == $target)) |
    {id, name, status, busy, labels: [.labels[].name]}]
' <<<"$RUNNERS")"

COUNT="$(jq 'length' <<<"$MATCHES")"
if [ "$COUNT" -ne 1 ]; then
  echo "::error::Expected exactly one organization runner with unique label '${LABEL}', found ${COUNT}." >&2
  exit 1
fi
if [ "$(jq -r '.[0].status' <<<"$MATCHES")" != "online" ]; then
  echo "::error::Selected runner ${LABEL} is offline." >&2
  echo "Update CI_RUNNER_LABEL in repository variables or rerun workflow_dispatch with another runner_label." >&2
  exit 1
fi

jq -r '.[0] | "runner_name=\(.name)\nrunner_label='"$LABEL"'\nbusy=\(.busy)"' <<<"$MATCHES"
