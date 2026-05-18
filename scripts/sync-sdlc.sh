#!/usr/bin/env bash
# sync-sdlc.sh — Tag DevAudit and propagate SDLC templates to consuming projects.
#
# Usage:
#   ./scripts/sync-sdlc.sh <version> <project-path> [project-path ...]
#
# Examples:
#   ./scripts/sync-sdlc.sh v1.23.0 ../wawagardenbar-app
#   ./scripts/sync-sdlc.sh v1.23.0 ../wawagardenbar-app ../META-AGENT
#
# What it does:
#   1. Tags DevAudit main as sdlc-<version> and pushes the tag
#   2. For each project: reads sdlc-config.json, resolves stack + host adapters,
#      syncs _common/ docs + stacks/<stack>/ (hooks, scripts) + hosts/<host>/
#      (deploy hooks) + ci/ templates with token substitution
#   3. Reports what was synced — does NOT auto-commit (review the diff first)

set -euo pipefail

# --- Resolve DevAudit root (script's parent directory) ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SDLC_FILES="$INSTALLER_ROOT/sdlc/files"

# --- Parse arguments ---
if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <version> <project-path> [project-path ...]"
  echo ""
  echo "Example: $0 v1.23.0 ../wawagardenbar-app"
  exit 1
fi

VERSION="$1"
TAG_NAME="sdlc-${VERSION}"
shift
PROJECT_PATHS=("$@")

echo "=== DevAudit SDLC Sync ==="
echo "Version: ${VERSION}"
echo "Tag: ${TAG_NAME}"
echo "Projects: ${PROJECT_PATHS[*]}"
echo ""

# --- Step 1: Tag DevAudit ---
echo "--- Step 1: Tagging DevAudit ---"

cd "$INSTALLER_ROOT"

if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  echo "Tag ${TAG_NAME} already exists — skipping tag creation"
else
  git tag "$TAG_NAME"
  echo "Created tag: ${TAG_NAME}"
  git push origin "$TAG_NAME"
  echo "Pushed tag to origin"
fi
echo ""

# --- Step 2: Sync to each project ---
for PROJECT_PATH in "${PROJECT_PATHS[@]}"; do
  PROJECT_PATH=$(echo "$PROJECT_PATH" | xargs) # trim whitespace

  if [ ! -d "$PROJECT_PATH" ]; then
    echo "ERROR: Project path not found: ${PROJECT_PATH}"
    continue
  fi

  PROJECT_NAME=$(basename "$PROJECT_PATH")
  echo "--- Syncing to: ${PROJECT_NAME} (${PROJECT_PATH}) ---"

  CONFIG_FILE="$PROJECT_PATH/sdlc-config.json"

  # --- Resolve stack + host adapters ---
  STACK="node"
  HOST="railway"
  DEPRECATED_DEFAULTS=0
  if [ -f "$CONFIG_FILE" ]; then
    CFG_STACK=$(jq -r '.stack // empty' "$CONFIG_FILE")
    CFG_HOST=$(jq -r '.host // empty' "$CONFIG_FILE")
    if [ -n "$CFG_STACK" ]; then
      STACK="$CFG_STACK"
    else
      DEPRECATED_DEFAULTS=1
    fi
    if [ -n "$CFG_HOST" ]; then
      HOST="$CFG_HOST"
    else
      DEPRECATED_DEFAULTS=1
    fi
  else
    DEPRECATED_DEFAULTS=1
  fi

  STACK_DIR="$SDLC_FILES/stacks/$STACK"
  HOST_DIR="$SDLC_FILES/hosts/$HOST"
  STACK_ADAPTER="$STACK_DIR/adapter.json"
  HOST_ADAPTER="$HOST_DIR/adapter.json"

  if [ ! -f "$STACK_ADAPTER" ]; then
    echo "  ERROR: stack adapter not found: stacks/${STACK}/adapter.json"
    echo "  Available stacks: $(ls "$SDLC_FILES/stacks" 2>/dev/null | tr '\n' ' ')"
    continue
  fi
  if [ ! -f "$HOST_ADAPTER" ]; then
    echo "  ERROR: host adapter not found: hosts/${HOST}/adapter.json"
    echo "  Available hosts: $(ls "$SDLC_FILES/hosts" 2>/dev/null | tr '\n' ' ')"
    continue
  fi

  echo "  Stack: ${STACK} | Host: ${HOST}"
  if [ "$DEPRECATED_DEFAULTS" -eq 1 ]; then
    echo "  DEPRECATED: stack/host keys missing from sdlc-config.json — defaulted to node+railway."
    echo "  Add \"stack\": \"${STACK}\", \"host\": \"${HOST}\" to sdlc-config.json. Future versions will refuse without them."
  fi

  SYNCED=0

  # --- 2a. _common/ stage docs + test policies ---
  if [ -d "$PROJECT_PATH/SDLC" ]; then
    SDLC_TARGET="$PROJECT_PATH/SDLC"
  else
    SDLC_TARGET="$PROJECT_PATH/SDLC"
    mkdir -p "$SDLC_TARGET"
    echo "  Created SDLC/ directory"
  fi

  for MD_FILE in "$SDLC_FILES/_common"/*.md; do
    [ -f "$MD_FILE" ] || continue
    FILENAME=$(basename "$MD_FILE")
    cp "$MD_FILE" "$SDLC_TARGET/$FILENAME"
    SYNCED=$((SYNCED + 1))
  done
  echo "  _common docs: synced to SDLC/"

  # --- 2b. AI rule files (single source of truth pattern) ---
  SDLC_SOURCE="$INSTALLER_ROOT/sdlc/ai-rules/INSTRUCTIONS-SDLC.md"

  if [ -f "$SDLC_SOURCE" ]; then
    cat > "$PROJECT_PATH/.cursorrules" << 'POINTER_EOF'
# Cursor Rules

All project rules, architectural standards, and development workflows are consolidated in:
👉 **[INSTRUCTIONS.md](./INSTRUCTIONS.md)**

Please refer to `INSTRUCTIONS.md` as the **Single Source of Truth** for all development standards in this repository.
POINTER_EOF
    SYNCED=$((SYNCED + 1))

    cat > "$PROJECT_PATH/.windsurfrules" << 'POINTER_EOF'
# Windsurf Rules

All project rules, architectural standards, and development workflows are consolidated in:
👉 **[INSTRUCTIONS.md](./INSTRUCTIONS.md)**

Please refer to `INSTRUCTIONS.md` as the **Single Source of Truth** for all development standards in this repository.
POINTER_EOF
    SYNCED=$((SYNCED + 1))

    cat > "$PROJECT_PATH/GEMINI.md" << 'POINTER_EOF'
# GEMINI.md

This file provides guidance to Gemini CLI when working in this repository.

## Context

**Project Standards:** See **[./INSTRUCTIONS.md](./INSTRUCTIONS.md)** for project rules, architecture, and development standards.

Please adhere to the instructions in `INSTRUCTIONS.md` as the **Single Source of Truth**.
POINTER_EOF
    SYNCED=$((SYNCED + 1))

    CLAUDE_TARGET="$PROJECT_PATH/CLAUDE.md"
    if [ -f "$CLAUDE_TARGET" ]; then
      if grep -q "## SDLC Compliance Process (MANDATORY)" "$CLAUDE_TARGET"; then
        sed '/## SDLC Compliance Process (MANDATORY)/,$d' "$CLAUDE_TARGET" > "${CLAUDE_TARGET}.tmp"
      elif grep -q "## Project Standards" "$CLAUDE_TARGET"; then
        cp "$CLAUDE_TARGET" "${CLAUDE_TARGET}.tmp"
      else
        cp "$CLAUDE_TARGET" "${CLAUDE_TARGET}.tmp"
      fi
      if ! grep -q "INSTRUCTIONS.md" "${CLAUDE_TARGET}.tmp"; then
        cat >> "${CLAUDE_TARGET}.tmp" << 'CLAUDE_POINTER_EOF'

## Project Standards

All project rules, architectural standards, and development workflows are consolidated in:
👉 **[INSTRUCTIONS.md](./INSTRUCTIONS.md)**

Please refer to `INSTRUCTIONS.md` as the **Single Source of Truth** for:
- Tech Stack & Architecture
- Code Style & Formatting
- Security & Compliance
- SDLC Development Process & Quality Gates
CLAUDE_POINTER_EOF
      fi
      mv "${CLAUDE_TARGET}.tmp" "$CLAUDE_TARGET"
    else
      cat > "$CLAUDE_TARGET" << 'CLAUDE_NEW_EOF'
# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Standards

All project rules, architectural standards, and development workflows are consolidated in:
👉 **[INSTRUCTIONS.md](./INSTRUCTIONS.md)**

Please refer to `INSTRUCTIONS.md` as the **Single Source of Truth** for:
- Tech Stack & Architecture
- Code Style & Formatting
- Security & Compliance
- SDLC Development Process & Quality Gates
CLAUDE_NEW_EOF
    fi
    SYNCED=$((SYNCED + 1))

    INSTRUCTIONS_TARGET="$PROJECT_PATH/INSTRUCTIONS.md"
    SDLC_CONTENT=$(cat "$SDLC_SOURCE")
    if [ -f "$INSTRUCTIONS_TARGET" ]; then
      if grep -q "## SDLC Compliance Process (MANDATORY)" "$INSTRUCTIONS_TARGET"; then
        sed '/## SDLC Compliance Process (MANDATORY)/,$d' "$INSTRUCTIONS_TARGET" > "${INSTRUCTIONS_TARGET}.tmp"
        sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "${INSTRUCTIONS_TARGET}.tmp"
        echo "" >> "${INSTRUCTIONS_TARGET}.tmp"
        echo "$SDLC_CONTENT" >> "${INSTRUCTIONS_TARGET}.tmp"
        mv "${INSTRUCTIONS_TARGET}.tmp" "$INSTRUCTIONS_TARGET"
      else
        echo "" >> "$INSTRUCTIONS_TARGET"
        echo "$SDLC_CONTENT" >> "$INSTRUCTIONS_TARGET"
      fi
    else
      echo "# Project Instructions & Standards (Single Source of Truth)" > "$INSTRUCTIONS_TARGET"
      echo "" >> "$INSTRUCTIONS_TARGET"
      echo "This document serves as the primary reference for all development in this repository." >> "$INSTRUCTIONS_TARGET"
      echo "" >> "$INSTRUCTIONS_TARGET"
      echo "$SDLC_CONTENT" >> "$INSTRUCTIONS_TARGET"
    fi
    SYNCED=$((SYNCED + 1))
    echo "  AI rule pointers + INSTRUCTIONS.md: synced"
  fi

  # --- 2c. Stack hooks (e.g. husky for node) ---
  STACK_HOOK_DIR=$(jq -r '.hook_install_dir // ""' "$STACK_ADAPTER")
  if [ -n "$STACK_HOOK_DIR" ] && [ -d "$PROJECT_PATH/$STACK_HOOK_DIR" ] && [ -d "$STACK_DIR/hooks" ]; then
    while IFS= read -r HOOK; do
      [ -z "$HOOK" ] && continue
      if [ -f "$STACK_DIR/hooks/$HOOK" ]; then
        cp "$STACK_DIR/hooks/$HOOK" "$PROJECT_PATH/$STACK_HOOK_DIR/$HOOK"
        chmod +x "$PROJECT_PATH/$STACK_HOOK_DIR/$HOOK"
        SYNCED=$((SYNCED + 1))
      fi
    done < <(jq -r '.hooks[]?' "$STACK_ADAPTER")
    echo "  ${STACK} hooks: synced to ${STACK_HOOK_DIR}/"

    while IFS= read -r CFG; do
      [ -z "$CFG" ] && continue
      if [ -f "$STACK_DIR/hooks/$CFG" ]; then
        cp "$STACK_DIR/hooks/$CFG" "$PROJECT_PATH/$CFG"
        SYNCED=$((SYNCED + 1))
        echo "  ${CFG}: synced"
      fi
    done < <(jq -r '.hook_config_files[]?' "$STACK_ADAPTER")
  elif [ -n "$STACK_HOOK_DIR" ]; then
    echo "  ${STACK} hooks: SKIPPED (${STACK_HOOK_DIR}/ not found — bootstrap hook framework first)"
  fi

  # --- 2c-ii. Ensure stack dev dependencies are installed (node only for now) ---
  if [ "$STACK" = "node" ] && [ -f "$PROJECT_PATH/package.json" ]; then
    DEPS_RAW=$(jq -r '.required_dev_dependencies[]?' "$STACK_ADAPTER" | tr '\n' ' ')
    MISSING_DEPS=""
    for DEP in $DEPS_RAW; do
      if ! node -e "const p=require('$PROJECT_PATH/package.json'); process.exit(p.devDependencies?.['$DEP'] ? 0 : 1)" 2>/dev/null; then
        MISSING_DEPS="$MISSING_DEPS $DEP"
      fi
    done
    if [ -n "$MISSING_DEPS" ]; then
      echo "  ${STACK} deps: installing$MISSING_DEPS"
      # Surface install errors instead of hiding them with 2>/dev/null.
      # Common failure mode: peer-dep conflicts (e.g. react@19 vs
      # @testing-library/react@14). Retry with --legacy-peer-deps to
      # match the resolution mode many existing lockfiles were generated
      # under. If that also fails, abort the sync — silently swallowing
      # the failure leaves the consumer with broken hooks (see #313).
      if ! (cd "$PROJECT_PATH" && npm install --save-dev $MISSING_DEPS); then
        echo "  Initial install failed (likely peer-dep conflict). Retrying with --legacy-peer-deps..."
        if ! (cd "$PROJECT_PATH" && npm install --save-dev --legacy-peer-deps $MISSING_DEPS); then
          echo "  ERROR: failed to install ${STACK} deps — fix manually: npm install --save-dev$MISSING_DEPS"
          exit 1
        fi
      fi
    else
      echo "  ${STACK} deps: all present"
    fi
  fi

  # --- 2d. Scripts: _common universal + stack-specific + upload-evidence.sh ---
  if [ -d "$PROJECT_PATH/scripts" ]; then
    for COMMON_SCRIPT in "$SDLC_FILES/_common/scripts"/*.sh; do
      [ -f "$COMMON_SCRIPT" ] || continue
      # Skip *.test.sh — that's a test harness for the script, not for consumers
      BASENAME=$(basename "$COMMON_SCRIPT")
      case "$BASENAME" in
        *.test.sh) continue ;;
      esac
      cp "$COMMON_SCRIPT" "$PROJECT_PATH/scripts/$BASENAME"
      chmod +x "$PROJECT_PATH/scripts/$BASENAME"
      SYNCED=$((SYNCED + 1))
    done
    echo "  _common scripts: synced to scripts/"

    if [ -d "$STACK_DIR/scripts" ]; then
      while IFS= read -r STACK_SCRIPT; do
        [ -z "$STACK_SCRIPT" ] && continue
        if [ -f "$STACK_DIR/scripts/$STACK_SCRIPT" ]; then
          cp "$STACK_DIR/scripts/$STACK_SCRIPT" "$PROJECT_PATH/scripts/$STACK_SCRIPT"
          chmod +x "$PROJECT_PATH/scripts/$STACK_SCRIPT"
          SYNCED=$((SYNCED + 1))
        fi
      done < <(jq -r '.stack_scripts[]?' "$STACK_ADAPTER")
      echo "  ${STACK} scripts: synced to scripts/"
    fi

    if [ -f "$INSTALLER_ROOT/scripts/upload-evidence.sh" ]; then
      cp "$INSTALLER_ROOT/scripts/upload-evidence.sh" "$PROJECT_PATH/scripts/upload-evidence.sh"
      chmod +x "$PROJECT_PATH/scripts/upload-evidence.sh"
      SYNCED=$((SYNCED + 1))
      echo "  upload-evidence.sh: synced"
    fi
  else
    echo "  Scripts: SKIPPED (scripts/ not found)"
  fi

  # --- 2e. GitHub issue templates (universal) ---
  ISSUE_TMPL_SRC="$SDLC_FILES/_common/github/ISSUE_TEMPLATE"
  ISSUE_TMPL_DST="$PROJECT_PATH/.github/ISSUE_TEMPLATE"
  if [ -d "$ISSUE_TMPL_SRC" ]; then
    mkdir -p "$ISSUE_TMPL_DST"
    for TMPL in "$ISSUE_TMPL_SRC"/*.yml; do
      [ -f "$TMPL" ] || continue
      cp "$TMPL" "$ISSUE_TMPL_DST/$(basename "$TMPL")"
      SYNCED=$((SYNCED + 1))
    done
    echo "  Issue templates: synced to .github/ISSUE_TEMPLATE/"
  fi

  # --- 2e-ii. SDLC skills (Claude Code Skills format) ---
  # Skills live under sdlc/files/_common/skills/<name>/ (universal) and
  # sdlc/files/stacks/<stack>/skills/<name>/ (stack-specific). Each is a
  # directory with SKILL.md + optional references/ assets/ scripts/.
  # They sync to the consumer's .claude/skills/<name>/ where Claude Code
  # auto-discovers them.
  SKILL_DST="$PROJECT_PATH/.claude/skills"
  COMMON_SKILLS_SRC="$SDLC_FILES/_common/skills"
  STACK_SKILLS_SRC="$STACK_DIR/skills"
  SKILLS_SYNCED=0
  for SRC_DIR in "$COMMON_SKILLS_SRC" "$STACK_SKILLS_SRC"; do
    [ -d "$SRC_DIR" ] || continue
    for SKILL_PATH in "$SRC_DIR"/*/; do
      [ -d "$SKILL_PATH" ] || continue
      SKILL_NAME=$(basename "$SKILL_PATH")
      case "$SKILL_NAME" in _*) continue ;; esac  # skip _schema/, _shared/, etc.
      mkdir -p "$SKILL_DST/$SKILL_NAME"
      # rsync-style copy: -a preserves perms, --delete removes files no longer
      # in the source so stale skill artifacts don't accumulate.
      if command -v rsync >/dev/null 2>&1; then
        rsync -a --delete "$SKILL_PATH" "$SKILL_DST/$SKILL_NAME/"
      else
        rm -rf "$SKILL_DST/$SKILL_NAME"
        mkdir -p "$SKILL_DST/$SKILL_NAME"
        cp -r "$SKILL_PATH"/. "$SKILL_DST/$SKILL_NAME/"
      fi
      SKILLS_SYNCED=$((SKILLS_SYNCED + 1))
      SYNCED=$((SYNCED + 1))
    done
  done
  if [ "$SKILLS_SYNCED" -gt 0 ]; then
    echo "  Claude Code skills: ${SKILLS_SYNCED} synced to .claude/skills/"
  fi

  # --- 2e-iii. E2E evidence helper (node stack only) ---
  # The e2e-test-engineer skill prescribes an evidenceShot() helper for
  # per-AC screenshot evidence (DevAudit #308). Emit the canonical helper
  # from the skill's references/ into the consumer's e2e/helpers/ so tests
  # can import it as `./helpers/evidence`. Python-stack projects don't use
  # Playwright, so this is gated on the node stack.
  if [ "$STACK" = "node" ]; then
    EVIDENCE_HELPER_SRC="$SDLC_FILES/_common/skills/e2e-test-engineer/references/evidence.ts"
    EVIDENCE_HELPER_DST="$PROJECT_PATH/e2e/helpers/evidence.ts"
    if [ -f "$EVIDENCE_HELPER_SRC" ]; then
      mkdir -p "$(dirname "$EVIDENCE_HELPER_DST")"
      cp "$EVIDENCE_HELPER_SRC" "$EVIDENCE_HELPER_DST"
      SYNCED=$((SYNCED + 1))
      echo "  E2E evidence helper: synced to e2e/helpers/evidence.ts"
    fi
  fi

  # --- 2f. Generate CI workflows from templates + sdlc-config.json ---
  if [ -f "$CONFIG_FILE" ] && [ -d "$PROJECT_PATH/.github/workflows" ]; then
    echo "  CI workflows: generating from sdlc-config.json"

    PROJECT_SLUG_VAL=$(jq -r '.project_slug' "$CONFIG_FILE")
    PROD_URL_SECRET=$(jq -r '.production_url_secret' "$CONFIG_FILE")
    NODE_VER=$(jq -r '.node_version // ""' "$CONFIG_FILE")
    PYTHON_VER=$(jq -r '.python_version // ""' "$CONFIG_FILE")
    # `working_directory` lets monorepo / subdir Python projects run gates from
    # a non-root pyproject.toml location. Default `.` (repo root) is a no-op
    # for projects whose pyproject.toml is at root. WORKING_DIR_PREFIX is the
    # path prefix applied to upload-artifact / upload-evidence file paths so
    # they resolve to where gates wrote them.
    WORKING_DIRECTORY=$(jq -r '.working_directory // "."' "$CONFIG_FILE")
    if [ "$WORKING_DIRECTORY" = "." ] || [ -z "$WORKING_DIRECTORY" ]; then
      WORKING_DIR_PREFIX=""
    else
      WORKING_DIR_PREFIX="${WORKING_DIRECTORY%/}/"
    fi
    RUNNER_VAL=$(jq -r '.runner' "$CONFIG_FILE")
    SOURCE_DIRS_VAL=$(jq -r '.source_dirs' "$CONFIG_FILE")
    SAST_BASELINE_VAL=$(jq -r '.sast_baseline' "$CONFIG_FILE")
    ACCEPTED_RISKS_VAL=$(jq -r '.accepted_dep_risks' "$CONFIG_FILE")
    DB_SERVICE=$(jq -r '.database_service' "$CONFIG_FILE")
    DB_IMAGE=$(jq -r '.database_image' "$CONFIG_FILE")
    DB_PORT=$(jq -r '.database_port' "$CONFIG_FILE")
    E2E_PROJECT_VAL=$(jq -r '.e2e_project' "$CONFIG_FILE")
    E2E_START_VAL=$(jq -r '.e2e_start_command' "$CONFIG_FILE")

    PATHS_IGNORE=""
    PATHS_COUNT=$(jq '.paths_ignore | length' "$CONFIG_FILE")
    for i in $(seq 0 $((PATHS_COUNT - 1))); do
      PATH_VAL=$(jq -r ".paths_ignore[$i]" "$CONFIG_FILE")
      PATHS_IGNORE="${PATHS_IGNORE}      - '${PATH_VAL}'\n"
    done

    DB_ENV=""
    for KEY in $(jq -r '.database_env | keys[]' "$CONFIG_FILE" 2>/dev/null); do
      VAL=$(jq -r ".database_env.\"$KEY\"" "$CONFIG_FILE")
      DB_ENV="${DB_ENV}      ${KEY}: ${VAL}\n"
    done

    APP_ENV=""
    for KEY in $(jq -r '.app_env | keys[]' "$CONFIG_FILE" 2>/dev/null); do
      VAL=$(jq -r ".app_env.\"$KEY\"" "$CONFIG_FILE")
      APP_ENV="${APP_ENV}      ${KEY}: ${VAL}\n"
    done

    BUILD_ENV=""
    for KEY in $(jq -r '.build_env | keys[]' "$CONFIG_FILE" 2>/dev/null); do
      VAL=$(jq -r ".build_env.\"$KEY\"" "$CONFIG_FILE")
      BUILD_ENV="${BUILD_ENV}          ${KEY}: ${VAL}\n"
    done

    DB_URI_STEP=""
    if [ "$DB_SERVICE" = "mongodb" ]; then
      DB_URI_STEP="      - name: Set database URI from dynamic port\n        run: |\n          DB_PORT=\"\${{ job.services.${DB_SERVICE}.ports['${DB_PORT}'] }}\"\n          echo \"MONGODB_WAWAGARDENBAR_APP_URI=mongodb://localhost:\${DB_PORT}\" >> \"\$GITHUB_ENV\"\n          echo \"Database on port: \${DB_PORT}\""
    fi

    if [ -f "$PROJECT_PATH/.github/workflows/test-on-pr.yml" ]; then
      rm "$PROJECT_PATH/.github/workflows/test-on-pr.yml"
      echo "  CI workflow: removed old test-on-pr.yml (renamed to ci.yml)"
    fi
    if [ -f "$PROJECT_PATH/.github/workflows/check-uat-approval.yml" ]; then
      rm "$PROJECT_PATH/.github/workflows/check-uat-approval.yml"
      echo "  CI workflow: removed old check-uat-approval.yml (renamed to check-release-approval.yml in v1.22.0)"
    fi

    for TMPL in ci.yml.template ci-status-fallback.yml.template compliance-validation.yml.template check-release-approval.yml.template post-deploy-prod.yml.template compliance-evidence.yml.template; do
      # Stack-specific CI templates live under ci/<stack>/ and override the
      # default ci/<template> for that stack. Currently only ci.yml is per-stack;
      # the other four are stack-agnostic.
      STACK_TMPL_PATH="$SDLC_FILES/ci/$STACK/$TMPL"
      DEFAULT_TMPL_PATH="$SDLC_FILES/ci/$TMPL"
      if [ -f "$STACK_TMPL_PATH" ]; then
        TMPL_PATH="$STACK_TMPL_PATH"
        TMPL_SOURCE="ci/${STACK}/"
      elif [ -f "$DEFAULT_TMPL_PATH" ]; then
        TMPL_PATH="$DEFAULT_TMPL_PATH"
        TMPL_SOURCE="ci/"
      else
        continue
      fi
      OUTPUT_NAME="${TMPL%.template}"
      OUTPUT_PATH="$PROJECT_PATH/.github/workflows/$OUTPUT_NAME"

      cp "$TMPL_PATH" "$OUTPUT_PATH"
      sed -i "s|{{PROJECT_SLUG}}|${PROJECT_SLUG_VAL}|g" "$OUTPUT_PATH"
      sed -i "s|{{PRODUCTION_URL_SECRET}}|${PROD_URL_SECRET}|g" "$OUTPUT_PATH"
      sed -i "s|{{NODE_VERSION}}|${NODE_VER}|g" "$OUTPUT_PATH"
      sed -i "s|{{PYTHON_VERSION}}|${PYTHON_VER}|g" "$OUTPUT_PATH"
      sed -i "s|{{WORKING_DIRECTORY}}|${WORKING_DIRECTORY}|g" "$OUTPUT_PATH"
      sed -i "s|{{WORKING_DIR_PREFIX}}|${WORKING_DIR_PREFIX}|g" "$OUTPUT_PATH"
      sed -i "s|{{RUNNER}}|${RUNNER_VAL}|g" "$OUTPUT_PATH"
      sed -i "s|{{SOURCE_DIRS}}|${SOURCE_DIRS_VAL}|g" "$OUTPUT_PATH"
      sed -i "s|{{SAST_BASELINE}}|${SAST_BASELINE_VAL}|g" "$OUTPUT_PATH"
      sed -i "s|{{ACCEPTED_DEP_RISKS}}|${ACCEPTED_RISKS_VAL}|g" "$OUTPUT_PATH"
      sed -i "s|{{DATABASE_SERVICE}}|${DB_SERVICE}|g" "$OUTPUT_PATH"
      sed -i "s|{{DATABASE_IMAGE}}|${DB_IMAGE}|g" "$OUTPUT_PATH"
      sed -i "s|{{DATABASE_PORT}}|${DB_PORT}|g" "$OUTPUT_PATH"
      sed -i "s|{{E2E_PROJECT}}|${E2E_PROJECT_VAL}|g" "$OUTPUT_PATH"
      sed -i "s|{{E2E_START_COMMAND}}|${E2E_START_VAL}|g" "$OUTPUT_PATH"

      replace_block() {
        local file="$1" token="$2" content="$3"
        local tmp="${file}.tmp"
        awk -v token="$token" -v content="$content" '{
          if (index($0, token) > 0) {
            print content
          } else {
            print
          }
        }' "$file" > "$tmp" && mv "$tmp" "$file"
      }
      replace_block "$OUTPUT_PATH" "{{PATHS_IGNORE}}" "$(echo -e "$PATHS_IGNORE")"
      replace_block "$OUTPUT_PATH" "{{DATABASE_ENV}}" "$(echo -e "$DB_ENV")"
      replace_block "$OUTPUT_PATH" "{{APP_ENV}}" "$(echo -e "$APP_ENV")"
      replace_block "$OUTPUT_PATH" "{{BUILD_ENV}}" "$(echo -e "$BUILD_ENV")"
      replace_block "$OUTPUT_PATH" "{{DATABASE_URI_STEP}}" "$(echo -e "$DB_URI_STEP")"

      if [ -z "$DB_SERVICE" ] || [ "$DB_SERVICE" = "" ]; then
        sed -i '/^    services:/,/^$/d' "$OUTPUT_PATH"
      fi

      SYNCED=$((SYNCED + 1))
      echo "  CI workflow: generated $OUTPUT_NAME (from ${TMPL_SOURCE})"
    done
  elif [ ! -f "$CONFIG_FILE" ]; then
    echo "  CI workflows: SKIPPED (no sdlc-config.json — create one from sdlc-config.example.json)"
  fi

  echo "  Total: ${SYNCED} files synced"

  # --- Post-sync validation ---
  echo ""
  echo "  --- Validation ---"
  WARNINGS=0

  if [ -d "$PROJECT_PATH/.github/workflows" ]; then
    for WF in "$PROJECT_PATH"/.github/workflows/*.yml; do
      [ -f "$WF" ] || continue
      WF_NAME=$(basename "$WF")
      if grep -q "push:" "$WF" && ! grep -q "pull_request:" "$WF"; then
        DEAD=$(grep -c "event_name.*pull_request" "$WF" 2>/dev/null) || DEAD=0
        if [ "${DEAD:-0}" -gt 0 ] 2>/dev/null; then
          echo "  WARNING: ${WF_NAME} has ${DEAD} dead 'event_name == pull_request' condition(s) (push-only trigger)"
          WARNINGS=$((WARNINGS + 1))
        fi
      fi
    done
  fi

  if [ -d "$PROJECT_PATH/.github/workflows" ]; then
    for WF in "$PROJECT_PATH"/.github/workflows/*.yml; do
      [ -f "$WF" ] || continue
      WF_NAME=$(basename "$WF")
      if grep -q "require.*package.json.*version" "$WF" 2>/dev/null; then
        echo "  WARNING: ${WF_NAME} uses package.json for version (should be date-based)"
        WARNINGS=$((WARNINGS + 1))
      fi
    done
  fi

  for DOC in Test_Policy.md Test_Strategy.md Test_Architecture.md; do
    if [ ! -f "$PROJECT_PATH/SDLC/$DOC" ] && [ -d "$PROJECT_PATH/SDLC" ]; then
      echo "  WARNING: Missing Tier 1 doc: SDLC/$DOC"
      WARNINGS=$((WARNINGS + 1))
    fi
  done

  if [ -d "$PROJECT_PATH/.github/workflows" ]; then
    for WF in "$PROJECT_PATH"/.github/workflows/*.yml; do
      [ -f "$WF" ] || continue
      WF_NAME=$(basename "$WF")
      if grep -q "raw.githubusercontent.com/metasession-dev/devaudit" "$WF" 2>/dev/null; then
        echo "  WARNING: ${WF_NAME} downloads from DevAudit at runtime (should use local scripts)"
        WARNINGS=$((WARNINGS + 1))
      fi
    done
  fi

  if [ "$WARNINGS" -eq 0 ]; then
    echo "  All validation checks passed"
  else
    echo "  ${WARNINGS} warning(s) — review before committing"
  fi

  echo ""
done

# --- Step 3: Summary ---
echo "=== Sync Complete ==="
echo "Tag: ${TAG_NAME}"
echo ""
echo "Next steps for each consuming project:"
echo "  1. cd into the project directory"
echo "  2. Review the diff: git diff"
echo "  3. Commit: git add -A && git commit -m 'chore: sync SDLC templates ${TAG_NAME} from DevAudit'"
echo "  4. Push to develop"
echo ""
echo "Do NOT auto-commit — review the changes first."
echo ""
echo "v1.23.0 migration: add \"stack\": \"node\" and \"host\": \"railway\" (or your chosen adapters) to sdlc-config.json."
echo "Available stacks: $(ls "$SDLC_FILES/stacks" 2>/dev/null | tr '\n' ' ')"
echo "Available hosts:  $(ls "$SDLC_FILES/hosts"  2>/dev/null | tr '\n' ' ')"
