#!/usr/bin/env bash
#
# render-bump-issue-body.sh — generate the body of a consumer-bump
# GitHub issue from a DevAudit-Installer release tag.
#
# Called from .github/workflows/release.yml after the GitHub Release is
# created, before the per-consumer `gh issue create` loop. Output is a
# self-contained markdown body matching the template in
# .claude/plans/synchronous-swimming-gosling.md.
#
# Inputs:
#   $1  — the release tag (e.g. v0.1.46). Required.
#   $CONSUMER_NAME — the consumer's short_name (e.g. "WGB"). Optional;
#                    defaults to the consumer's repo slug.
#
# Output: markdown on stdout. No newline at EOF (caller pipes to gh).

set -euo pipefail

TAG="${1:?usage: render-bump-issue-body.sh <tag>}"
# Note: don't use `${CONSUMER_NAME:-{{x}}}` style — bash parses the
# `}}` as closing the default-expansion early. Fall back via plain
# conditional.
CONSUMER="${CONSUMER_NAME:-your project}"
INSTALLER_REPO="metasession-dev/DevAudit-Installer"

# Pull release notes from the GitHub Release. If it doesn't exist (e.g.
# release.yml hasn't created it yet — race) fall back to a stub.
NOTES=$(gh release view "$TAG" --repo "$INSTALLER_REPO" --json body --jq '.body' 2>/dev/null \
  || echo "_Release notes unavailable at issue-file time. See <https://github.com/$INSTALLER_REPO/releases/tag/$TAG>._")

# Compute target-action dates per priority tier. The auto-filer doesn't
# pick the priority — it stays unlabelled (default low) and the operator
# promotes if needed. All three dates appear in the body so the operator
# (or the drift cron) can grep whichever applies.
TODAY=$(date -u +%Y-%m-%d)
HIGH_TARGET=$(date -u -d "$TODAY + 1 day" +%Y-%m-%d)
MEDIUM_TARGET=$(date -u -d "$TODAY + 7 days" +%Y-%m-%d)
LOW_TARGET=$(date -u -d "$TODAY + 30 days" +%Y-%m-%d)

cat <<EOF
## What

Bump SDLC sync to **devaudit ${TAG}**.

- Release notes: <https://github.com/${INSTALLER_REPO}/releases/tag/${TAG}>
- npm: \`@metasession.co/devaudit-cli@${TAG#v}\`

## Why this matters for ${CONSUMER}

${NOTES}

## Operator action

- [ ] Run \`devaudit update\` from the project root with \`DEVAUDIT_INSTALLER_ROOT\` set to a local clone of DevAudit-Installer
- [ ] Review the diff; CI should pass without further config
- [ ] Any release-specific operator action listed above (env var changes, secret deletes, migrations)
- [ ] Merge the resulting \`chore: devaudit update to ${TAG}\` PR

## Target action by priority

If this bump is **routine** (no operator-actionable bug fix / no security fix / no new feature you need): target action by **${LOW_TARGET}** (30 days).

If you (or the bot) promote this to \`priority:medium\` (release brings a feature you want to pick up promptly): target action by **${MEDIUM_TARGET}** (7 days).

If you (or the bot) promote this to \`priority:high\` (release fixes a bug actively hitting this project, or carries a security advisory): target action by **${HIGH_TARGET}** (24 hours).

The \`devaudit-version-drift.yml\` workflow runs daily on \`develop\` and adds an \`overdue\` label to this issue if the matching target date passes without action.

## How to drive

\`\`\`
Skill(name: "sdlc-implementer", args: "implement issue #N under the SDLC")
\`\`\`

Phase 0 will classify this as \`chore\` (housekeeping path) and drive the
Lightweight flow: branch off develop, \`devaudit update\`, run gates
locally, open PR, prompt for review, merge.

---
🤖 Filed automatically by DevAudit-Installer's release.yml on ${TODAY}.
Re-trigger filing manually with \`gh workflow run release.yml --ref ${TAG}\`.
EOF
