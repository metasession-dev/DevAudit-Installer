# Branch Protection Setup

This repo uses GitFlow branch protection enforced via GitHub branch rules. The `Enforce GitFlow` workflow (`.github/workflows/branch-protection.yml`) provides CI-level enforcement, but GitHub branch protection rules are the authoritative gate.

## Required GitHub branch protection rules

An admin must configure these via **repo Settings → Branches → Branch protection rules** (or `gh api` with an admin token).

### `main` branch

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ |
| Required approving reviews | 1 |
| Dismiss stale pull request approvals when new commits are pushed | ✅ |
| Require status checks to pass before merging | ✅ |
| Require branches to be up to date before merging | ✅ |
| Required status checks | `Enforce GitFlow`, `Quality Gates` (or equivalent CI) |
| Enforce administrators | ✅ |
| Do not allow bypassing the above settings | ✅ |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

### `develop` branch

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ |
| Required approving reviews | 0 (or 1 for stricter review) |
| Require status checks to pass before merging | ✅ |
| Require branches to be up to date before merging | ✅ |
| Required status checks | `Enforce GitFlow`, `Quality Gates` (or equivalent CI) |
| Enforce administrators | ✅ |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

## Setting via gh api (requires admin token)

```bash
# main branch protection
gh api repos/metasession-dev/DevAudit-Installer/branches/main/protection \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "required_status_checks": {
    "strict": true,
    "contexts": ["Enforce GitFlow", "Quality Gates"]
  },
  "enforce_admins": true,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

# develop branch protection
gh api repos/metasession-dev/DevAudit-Installer/branches/develop/protection \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "required_status_checks": {
    "strict": true,
    "contexts": ["Enforce GitFlow", "Quality Gates"]
  },
  "enforce_admins": true,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

## Note

The current `gh` token (ostendo-io) does not have admin access on `metasession-dev/DevAudit-Installer`. An org owner or repo admin must run the above commands or configure the rules manually via the GitHub UI.
