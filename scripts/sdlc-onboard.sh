#!/usr/bin/env bash
# sdlc-onboard.sh — One-shot onboarding of a consumer project to the Metasession SDLC framework.
#
# Usage:
#   META_COMPLY_USER_TOKEN=mctok_xxx... ./scripts/sdlc-onboard.sh <project-path>
#
# Example:
#   META_COMPLY_USER_TOKEN=mctok_abc123... ./scripts/sdlc-onboard.sh ../META-AGENT
#
# What it does (in order):
#   1. Validates the PAT against DevAudit and identifies the calling user.
#   2. Detects stack (python / node) and host (railway by default) from the
#      consumer's filesystem.
#   3. Prompts for the small handful of values the wizard can't infer
#      (project slug, runtime version, source dirs, working directory,
#      production URL secret name).
#   4. Writes sdlc-config.json into the consumer directory.
#   5. Creates the project in DevAudit (idempotent — skips if already
#      exists for this user).
#   6. Issues a project-scoped API key, named "Onboarding-issued".
#   7. Sets repo secrets via `gh secret set`:
#         META_COMPLY_API_KEY (the just-issued key)
#         META_COMPLY_USER_TOKEN (the PAT passed in)
#         <production_url_secret> (prompted)
#   8. Sets repo variable META_COMPLY_BASE_URL via `gh variable set`.
#   9. Bootstraps the stack's hook framework (pre-commit install / husky init).
#  10. Configures branch protection on main with the right required checks.
#  11. Runs sync-sdlc.sh against the consumer to populate all framework
#      files.
#  12. Reports what was done; the consumer's working tree is left dirty
#      so the operator can review the diff before committing.
#
# Requirements on the operator's machine:
#   - bash, jq, curl, gh (GitHub CLI)
#   - gh authenticated against the consumer's GitHub repo with admin scope
#   - The DevAudit user account already exists; the PAT was issued via
#     https://devaudit.metasession.co/settings/tokens
#
# This script is idempotent. Running it twice on the same consumer:
#   - Re-creates / re-overwrites sdlc-config.json (so wizard answers are
#     re-applied)
#   - Skips DevAudit project creation (project lookup returns existing)
#   - Skips API key issuance if a key named "Onboarding-issued" already
#     exists
#   - Overwrites GH secrets/variables (gh secret set does this by default)
#   - Re-runs hook framework install (idempotent at the framework level)
#   - Re-applies branch protection (idempotent at the GH API level)
#   - Re-runs sync (idempotent — same output for same input)

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# 0. Args + environment validation
# ──────────────────────────────────────────────────────────────────────

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <project-path>" >&2
  echo "" >&2
  echo "Environment:" >&2
  echo "  META_COMPLY_USER_TOKEN  Required. PAT issued at /settings/tokens." >&2
  echo "  META_COMPLY_BASE_URL    Optional. Defaults to https://devaudit.metasession.co." >&2
  exit 1
fi

PROJECT_PATH="$1"
if [ ! -d "$PROJECT_PATH" ]; then
  echo "ERROR: Project path not found: $PROJECT_PATH" >&2
  exit 1
fi
PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"
PROJECT_NAME="$(basename "$PROJECT_PATH")"

: "${META_COMPLY_USER_TOKEN:?META_COMPLY_USER_TOKEN must be set (issue at https://devaudit.metasession.co/settings/tokens)}"
BASE_URL="${META_COMPLY_BASE_URL:-https://devaudit.metasession.co}"
BASE_URL="${BASE_URL%/}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

for cmd in jq curl gh; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd not found in PATH" >&2
    exit 1
  fi
done

# Helper — pretty section header
section() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
step()    { printf '  \033[1;34m▸\033[0m %s\n' "$*"; }
ok()      { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()    { printf '  \033[33m⚠\033[0m %s\n' "$*"; }

cat << BANNER
══════════════════════════════════════════════════════════════
  Metasession SDLC Onboarding
  Consumer:  $PROJECT_NAME
  Path:      $PROJECT_PATH
  DevAudit:  $BASE_URL
══════════════════════════════════════════════════════════════
BANNER

# ──────────────────────────────────────────────────────────────────────
# 1. Authenticate
# ──────────────────────────────────────────────────────────────────────

section "1/11 · Authenticate with DevAudit"
# /api/auth/session returns the resolved user under PAT auth.
# (Routes that accept PAT include /api/projects — listing projects
# succeeds when the token is valid and returns 401 otherwise.)
PROBE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Meta-Comply-Token: $META_COMPLY_USER_TOKEN" \
  "${BASE_URL}/api/projects")
case "$PROBE" in
  2*) ok "PAT accepted; DevAudit reachable at $BASE_URL" ;;
  401|403)
    echo "  ✗ PAT rejected (HTTP $PROBE)." >&2
    echo "    Issue a fresh token at ${BASE_URL}/settings/tokens and retry." >&2
    exit 1
    ;;
  *)
    echo "  ✗ Unexpected HTTP $PROBE talking to DevAudit." >&2
    exit 1
    ;;
esac

# ──────────────────────────────────────────────────────────────────────
# 2. Detect stack / host
# ──────────────────────────────────────────────────────────────────────

section "2/11 · Detect stack and host"

DETECTED_STACK=""
DETECTED_WORKING_DIRECTORY="."
if [ -f "$PROJECT_PATH/pyproject.toml" ]; then
  DETECTED_STACK="python"
elif find "$PROJECT_PATH" -mindepth 2 -maxdepth 3 -name pyproject.toml -not -path "*/node_modules/*" 2>/dev/null | head -1 | grep -q pyproject.toml; then
  DETECTED_STACK="python"
  CANDIDATE=$(find "$PROJECT_PATH" -mindepth 2 -maxdepth 3 -name pyproject.toml -not -path "*/node_modules/*" 2>/dev/null | head -1)
  DETECTED_WORKING_DIRECTORY="$(dirname "$CANDIDATE" | sed "s|^$PROJECT_PATH/||")"
elif [ -f "$PROJECT_PATH/package.json" ]; then
  DETECTED_STACK="node"
fi

if [ -z "$DETECTED_STACK" ]; then
  echo "  ✗ Could not detect stack — no pyproject.toml / package.json found at expected locations." >&2
  echo "    Specify --stack manually (not yet supported; create one of those files first)." >&2
  exit 1
fi

ok "Stack:                $DETECTED_STACK"
ok "Working directory:    $DETECTED_WORKING_DIRECTORY"
ok "Host (default):       railway"

# ──────────────────────────────────────────────────────────────────────
# 3. Prompt for the remaining values
# ──────────────────────────────────────────────────────────────────────

section "3/11 · Configure"

prompt() {
  local label="$1" default="$2" varname="$3" value
  if [ -n "$default" ]; then
    read -r -p "  $label [$default]: " value || true
    value="${value:-$default}"
  else
    read -r -p "  $label: " value || true
  fi
  printf -v "$varname" '%s' "$value"
}

DEFAULT_SLUG="$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"
prompt "Project slug"                 "$DEFAULT_SLUG"                                 PROJECT_SLUG_VAL

if [ "$DETECTED_STACK" = "python" ]; then
  prompt "Python version"             "3.11"                                          RUNTIME_VERSION
  prompt "Source dirs (space-sep)"    "src/ tests/"                                   SOURCE_DIRS_VAL
elif [ "$DETECTED_STACK" = "node" ]; then
  prompt "Node version"               "20"                                            RUNTIME_VERSION
  prompt "Source dirs (space-sep)"    "app/ lib/"                                     SOURCE_DIRS_VAL
fi

if [ "$DETECTED_WORKING_DIRECTORY" = "." ]; then
  prompt "Working directory (blank = root)"    ""                                     WORKING_DIRECTORY
  [ -z "$WORKING_DIRECTORY" ] && WORKING_DIRECTORY="."
else
  prompt "Working directory"          "$DETECTED_WORKING_DIRECTORY"                   WORKING_DIRECTORY
fi

PROD_URL_SECRET_DEFAULT="$(echo "$PROJECT_SLUG_VAL" | tr '[:lower:]-' '[:upper:]_')_PROD_URL"
prompt "Production URL secret name"   "$PROD_URL_SECRET_DEFAULT"                      PROD_URL_SECRET_NAME
prompt "Production URL (https://...)" ""                                              PROD_URL_VALUE

# ──────────────────────────────────────────────────────────────────────
# 4. Write sdlc-config.json
# ──────────────────────────────────────────────────────────────────────

section "4/11 · Write sdlc-config.json"

if [ "$DETECTED_STACK" = "python" ]; then
  RUNTIME_KEY="python_version"
  PATHS_IGNORE='["SDLC/**", "compliance/**", "*.md", ".cursorrules", ".windsurfrules", "sdlc-config.json"]'
else
  RUNTIME_KEY="node_version"
  PATHS_IGNORE='["SDLC/**", "compliance/**", "*.md", ".cursorrules", ".windsurfrules", "sdlc-config.json", "scripts/upload-evidence.sh", "scripts/validate-compliance-artifacts.sh", "scripts/validate-commits.sh", "scripts/check-requirement-jsdoc.sh"]'
fi

jq -n \
  --arg stack          "$DETECTED_STACK" \
  --arg host           "railway" \
  --arg slug           "$PROJECT_SLUG_VAL" \
  --arg prod_url_secret "$PROD_URL_SECRET_NAME" \
  --arg runtime_key    "$RUNTIME_KEY" \
  --arg runtime_value  "$RUNTIME_VERSION" \
  --arg working_dir    "$WORKING_DIRECTORY" \
  --arg source_dirs    "$SOURCE_DIRS_VAL" \
  --arg base_url       "$BASE_URL" \
  --argjson paths_ignore "$PATHS_IGNORE" \
'{
  stack: $stack,
  host: $host,
  project_slug: $slug,
  production_url_secret: $prod_url_secret,
  ($runtime_key): $runtime_value,
  runner: "ubuntu-latest",
  working_directory: $working_dir,
  source_dirs: $source_dirs,
  sast_baseline: 0,
  accepted_dep_risks: "",
  database_service: "",
  database_image: "",
  database_port: "",
  database_env: {},
  app_env: {},
  build_env: {},
  e2e_project: "",
  e2e_start_command: "",
  paths_ignore: $paths_ignore,
  devaudit: {
    base_url: $base_url,
    project_slug: $slug,
    api_key_secret: "META_COMPLY_API_KEY"
  },
  uat: { enabled: false, url: "", required_risk_classes: ["payment", "destructive_migration", "realtime"] },
  approval: { mode: "dual_actor", auto_low_risk_threshold: "LOW" },
  production_review: { enabled: true, terminal_status: "prod_review" }
}' > "$PROJECT_PATH/sdlc-config.json"

ok "Written to $PROJECT_PATH/sdlc-config.json"

# ──────────────────────────────────────────────────────────────────────
# 5. Create / find DevAudit project
# ──────────────────────────────────────────────────────────────────────

section "5/11 · Create / find DevAudit project"

EXISTING=$(curl -s \
  -H "X-Meta-Comply-Token: $META_COMPLY_USER_TOKEN" \
  "${BASE_URL}/api/projects" | jq -r --arg slug "$PROJECT_SLUG_VAL" '[.[] | select(.slug == $slug)] | first // empty')

if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
  PROJECT_ID=$(echo "$EXISTING" | jq -r '.id')
  ok "Project '$PROJECT_SLUG_VAL' already exists (id ${PROJECT_ID:0:8}…) — skipping creation"
else
  CREATE_BODY=$(jq -n \
    --arg name "$PROJECT_SLUG_VAL" \
    --arg slug "$PROJECT_SLUG_VAL" \
    '{name: $name, slug: $slug}')
  CREATE_RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "X-Meta-Comply-Token: $META_COMPLY_USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$CREATE_BODY" \
    "${BASE_URL}/api/projects")
  CODE=$(echo "$CREATE_RESP" | tail -1)
  BODY=$(echo "$CREATE_RESP" | sed '$d')
  if [ "$CODE" != "201" ]; then
    echo "  ✗ Project creation failed (HTTP $CODE): $(echo "$BODY" | jq -r '.error // .')" >&2
    exit 1
  fi
  PROJECT_ID=$(echo "$BODY" | jq -r '.id')
  ok "Project '$PROJECT_SLUG_VAL' created (id ${PROJECT_ID:0:8}…)"
fi

# ──────────────────────────────────────────────────────────────────────
# 6. Issue project API key
# ──────────────────────────────────────────────────────────────────────

section "6/11 · Issue project API key"

EXISTING_KEY=$(curl -s \
  -H "X-Meta-Comply-Token: $META_COMPLY_USER_TOKEN" \
  "${BASE_URL}/api/projects/${PROJECT_ID}/api-keys" \
  | jq -r '[.[] | select(.name == "Onboarding-issued" and .revoked_at == null)] | first // empty')

if [ -n "$EXISTING_KEY" ] && [ "$EXISTING_KEY" != "null" ]; then
  warn "An 'Onboarding-issued' API key already exists and won't be re-issued automatically."
  warn "Either revoke it in the DevAudit portal and re-run, OR set META_COMPLY_API_KEY manually."
  PLAIN_API_KEY=""
else
  KEY_RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "X-Meta-Comply-Token: $META_COMPLY_USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Onboarding-issued","role":"uploader"}' \
    "${BASE_URL}/api/projects/${PROJECT_ID}/api-keys")
  KEY_CODE=$(echo "$KEY_RESP" | tail -1)
  KEY_BODY=$(echo "$KEY_RESP" | sed '$d')
  if [ "$KEY_CODE" != "201" ]; then
    echo "  ✗ API key issuance failed (HTTP $KEY_CODE): $(echo "$KEY_BODY" | jq -r '.error // .')" >&2
    exit 1
  fi
  PLAIN_API_KEY=$(echo "$KEY_BODY" | jq -r '.plainTextKey')
  ok "API key issued (will be stored as repo secret META_COMPLY_API_KEY)"
fi

# ──────────────────────────────────────────────────────────────────────
# 7. Set GH secrets + variables
# ──────────────────────────────────────────────────────────────────────

section "7/11 · Set GitHub repo secrets and variables"

cd "$PROJECT_PATH"

if [ -n "$PLAIN_API_KEY" ]; then
  echo -n "$PLAIN_API_KEY" | gh secret set META_COMPLY_API_KEY 2>&1 | sed 's/^/    /'
  ok "META_COMPLY_API_KEY (secret)"
else
  warn "Skipping META_COMPLY_API_KEY — set it manually after revoking the stale key."
fi

echo -n "$META_COMPLY_USER_TOKEN" | gh secret set META_COMPLY_USER_TOKEN 2>&1 | sed 's/^/    /'
ok "META_COMPLY_USER_TOKEN (secret)"

if [ -n "$PROD_URL_VALUE" ]; then
  echo -n "$PROD_URL_VALUE" | gh secret set "$PROD_URL_SECRET_NAME" 2>&1 | sed 's/^/    /'
  ok "$PROD_URL_SECRET_NAME (secret)"
else
  warn "$PROD_URL_SECRET_NAME not set — provide the production URL when you have one (post-deploy-prod.yml needs it)."
fi

gh variable set META_COMPLY_BASE_URL --body "$BASE_URL" 2>&1 | sed 's/^/    /'
ok "META_COMPLY_BASE_URL (variable) = $BASE_URL"

cd "$INSTALLER_ROOT"

# ──────────────────────────────────────────────────────────────────────
# 8. Bootstrap hook framework
# ──────────────────────────────────────────────────────────────────────

section "8/11 · Bootstrap hook framework"

cd "$PROJECT_PATH"
if [ "$DETECTED_STACK" = "python" ]; then
  if ! command -v pre-commit >/dev/null 2>&1; then
    warn "pre-commit not on PATH. Run \`pip install pre-commit\` then \`pre-commit install\` manually."
  else
    pre-commit install 2>&1 | sed 's/^/    /' || warn "pre-commit install failed; run manually"
    pre-commit install --hook-type commit-msg 2>&1 | sed 's/^/    /' || warn "commit-msg install failed; run manually"
    ok "pre-commit hooks installed"
  fi
elif [ "$DETECTED_STACK" = "node" ]; then
  if [ ! -d "$PROJECT_PATH/.husky" ]; then
    if command -v npx >/dev/null 2>&1; then
      npx husky init 2>&1 | sed 's/^/    /' || warn "husky init failed; run manually"
      ok ".husky/ bootstrapped"
    else
      warn "npx not on PATH. Run \`npx husky init\` manually."
    fi
  else
    ok ".husky/ already exists"
  fi
fi
cd "$INSTALLER_ROOT"

# ──────────────────────────────────────────────────────────────────────
# 9. Configure branch protection
# ──────────────────────────────────────────────────────────────────────

section "9/11 · Configure branch protection on main"

cd "$PROJECT_PATH"
GH_REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "")
if [ -z "$GH_REPO" ]; then
  warn "Could not resolve GitHub repo from $PROJECT_PATH — branch protection not configured."
  warn "Run \`gh api PUT /repos/<owner>/<repo>/branches/main/protection -F...\` after merging the onboarding PR."
else
  REQUIRED_CHECKS='["Compliance Validation","DevAudit Release Approval","Quality Gates"]'
  BP_BODY=$(jq -n --argjson checks "$REQUIRED_CHECKS" '{
    required_status_checks: { strict: false, contexts: $checks },
    enforce_admins: false,
    required_pull_request_reviews: { dismiss_stale_reviews: true, required_approving_review_count: 0 },
    restrictions: null
  }')
  if gh api -X PUT "/repos/${GH_REPO}/branches/main/protection" --input - <<< "$BP_BODY" >/dev/null 2>&1; then
    ok "Branch protection on main: required checks $REQUIRED_CHECKS"
    warn "Required approving reviews set to 0 — raise to 1+ once your team has multiple admins."
  else
    warn "Branch protection API call failed (likely a permission issue on this repo). Configure manually in repo settings."
  fi
fi
cd "$INSTALLER_ROOT"

# ──────────────────────────────────────────────────────────────────────
# 10. Run sync-sdlc.sh
# ──────────────────────────────────────────────────────────────────────

section "10/11 · Sync SDLC templates"

# Use the existing sync — same script the maintainer uses for ongoing
# template updates. Onboarding is just the first sync.
"$SCRIPT_DIR/sync-sdlc.sh" v1.23.x "$PROJECT_PATH" 2>&1 | sed 's/^/    /' || {
  echo "  ✗ Sync failed — see output above." >&2
  exit 1
}
ok "Templates synced"

# ──────────────────────────────────────────────────────────────────────
# 11. Final report
# ──────────────────────────────────────────────────────────────────────

section "11/11 · Done"

cat << REPORT

  $PROJECT_NAME is onboarded.

  Next steps:
    cd $PROJECT_PATH
    git status                # review the diff
    git checkout -b feat/sdlc-onboarding
    git add -A
    git commit -m "feat: onboard $PROJECT_SLUG_VAL to Metasession SDLC"
    git push -u origin feat/sdlc-onboarding
    gh pr create --base main

  After the PR merges:
    - Push a compliance/ doc to develop so compliance-evidence.yml
      registers the first release in DevAudit.
    - Then walk REQ-001 through SDLC/0-project-setup.md → SDLC/5-deploy-main.md.

REPORT
