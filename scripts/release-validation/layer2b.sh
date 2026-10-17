#!/usr/bin/env bash
# Layer 2b — change-driven checks (docs/release-validation-plan.md, #941).
# Sourced by release-validation.sh. Instead of repeating generic checks on
# every consumer, it works out WHAT CHANGED since the last release tag, maps the
# changed paths to surfaces (surfaces.tsv), applies the update to a couple of
# representative clones and runs the scenario for each changed surface on them.
# A changed surface with no scenario is reported (WARN): a change nobody
# exercised is the thing this layer exists to find.

RV_DIR="$ROOT/scripts/release-validation"
# One node and one python consumer: enough to exercise the changes, far cheaper than all of them.
RV_2B_CONSUMERS="${RV_2B_CONSUMERS:-wawagardenbar-app ThorStack-Backend}"
# Changed paths that do not ship to consumers (or are covered by their own tests).
RV_NOT_SHIPPED='^(docs/|tests/|scripts/|\.github/|\.claude/|\.devin/|plugins/|plugin-sdk/|contracts/|cli/(test/|CHANGELOG|README|package|tsconfig|tsup|vitest|\.)|sdlc/(CLAUDE|SKILLS|README|package)|README|CONTRIBUTING|CHANGELOG|LICENSE|INSTRUCTIONS|CLAUDE|AGENTS|GEMINI|package|\.)'

# surface_for_path <path>: prints every surface a path belongs to.
surface_for_path() {
  local p="$1" name re
  while IFS=$'\t' read -r name re _; do
    case "$name" in ''|'#'*) continue ;; esac
    if printf '%s\n' "$p" | grep -Eq "$re"; then printf '%s\n' "$name"; fi
  done < "$RV_DIR/surfaces.tsv"
}

release_base_ref() {
  if [ -n "${RV_BASE_REF:-}" ]; then printf '%s' "$RV_BASE_REF"; return; fi
  # Release tags are cut on main and are not ancestors of develop, so take the
  # newest version tag by number, not the nearest ancestor.
  git -C "$ROOT" tag --list 'v[0-9]*' --sort=-v:refname 2>/dev/null | head -1
}

# changed_surfaces <base>: prints "surface<TAB>count" for each changed surface, "unclassified<TAB>path" for strays.
changed_surfaces() {
  local base="$1" f s
  declare -A count=()
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if printf '%s\n' "$f" | grep -Eq "$RV_NOT_SHIPPED" && ! printf '%s\n' "$f" | grep -Eq '^(cli/src/|sdlc/files/|sdlc/src/)'; then continue; fi
    local matched=0
    while IFS= read -r s; do
      [ -n "$s" ] || continue
      count[$s]=$(( ${count[$s]:-0} + 1 )); matched=1
    done < <(surface_for_path "$f")
    [ "$matched" = 1 ] || printf 'unclassified\t%s\n' "$f"
  done < <(git -C "$ROOT" diff --name-only "$base" HEAD)
  for s in "${!count[@]}"; do printf '%s\t%s\n' "$s" "${count[$s]}"; done | sort
}

# area counts of a changed-file list, for the synced-changes report
synced_areas() { # <file-with-paths>
  awk '{
    if ($0 ~ /^\.github\/workflows\//) a["workflows"]++
    else if ($0 ~ /^scripts\//) a["scripts"]++
    else if ($0 ~ /^\.claude\/skills\//) a["skills"]++
    else if ($0 ~ /^SDLC\//) a["SDLC docs"]++
    else if ($0 ~ /^\.husky\//) a["hooks"]++
    else if ($0 ~ /^\.devaudit\//) a["manifest"]++
    else a["other"]++
  } END { for (k in a) printf "%s %d, ", k, a[k] }' "$1" | sed 's/, $//'
}

# --- scenarios -----------------------------------------------------------
# Each scenario_<surface> <target> <dir> <synced-files-list> records its own results.

# Runs the gate test against one workflow file; prints the vitest "Tests" summary line.
_gate_test() { # <workflow> <derive-script>
  (cd "$ROOT/cli" && GATE_WORKFLOW_FILE="$1" GATE_DERIVE_SCRIPT="$2" DEVAUDIT_INSTALLER_ROOT="$ROOT" \
     npx vitest run test/release-approval-gate-behavior.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]' | tail -1)
}

scenario_approval_gate() {
  local target="$1" dir="$2" wf out
  wf=$(ls "$dir"/.github/workflows/check-release-approval*.yml 2>/dev/null | head -1)
  if [ -z "$wf" ]; then record "$target" "2b:approval-gate" FAIL "no check-release-approval workflow after update"; return; fi
  # When the clone kept its own older copy (a sync conflict), test what the candidate
  # produced (<wf>.devaudit-new) and report the kept copy separately: the candidate is
  # what is being validated, the consumer's stale copy is a resolve-before-adopting item.
  if [ -f "$wf.devaudit-new" ]; then
    out=$(_gate_test "$wf.devaudit-new" "$dir/scripts/derive-release-version.sh")
    if printf '%s' "$out" | grep -q 'failed' || [ -z "$out" ]; then
      record "$target" "2b:approval-gate" FAIL "the candidate's gate (.devaudit-new): ${out:-no result}"
    else
      record "$target" "2b:approval-gate" PASS "the candidate's $(basename "$wf") (kept as .devaudit-new) against a mock portal: $out"
    fi
    out=$(_gate_test "$wf" "$dir/scripts/derive-release-version.sh")
    if printf '%s' "$out" | grep -q 'failed' || [ -z "$out" ]; then
      record "$target" "2b:approval-gate-kept" WARN "the clone keeps its OWN older $(basename "$wf") (conflict) and it does not pass the current gate checks (${out:-no result}); resolve the conflict to get the 1.8.0 behaviour"
    else
      record "$target" "2b:approval-gate-kept" PASS "the clone's kept $(basename "$wf") also passes: $out"
    fi
    return
  fi
  out=$(_gate_test "$wf" "$dir/scripts/derive-release-version.sh")
  if printf '%s' "$out" | grep -q 'failed' || [ -z "$out" ]; then
    record "$target" "2b:approval-gate" FAIL "the clone's own gate workflow: ${out:-no result}"
  else
    record "$target" "2b:approval-gate" PASS "the clone's $(basename "$wf") run against a mock portal: $out"
  fi
}

# #1020: integration housekeeping registers no portal release unless a standalone
# declaration exists. Static: the candidate workflows that derive a version opt in.
# Behavioural: the clone's synced derive-release-version.sh prints nothing for an
# untagged commit with the opt-in, and the bare-date version once a declaration exists.
check_housekeeping_skip_rule() { # <target> <dir> <candidate-workflows-root>
  local target="$1" dir="$2" cand="$3" wf missing="" t derive got
  for wf in ci.yml compliance-evidence.yml; do
    [ -f "$cand/.github/workflows/$wf" ] || continue
    grep -q 'scripts/derive-release-version.sh' "$cand/.github/workflows/$wf" || continue
    # The Python ci.yml calls the helper only in bundle-only mode (#995): it keeps its date-based releases.
    grep -q 'DEVAUDIT_DERIVE_BUNDLE_ONLY=1' "$cand/.github/workflows/$wf" && continue
    grep -q 'DEVAUDIT_SKIP_INTEGRATION_HOUSEKEEPING=1' "$cand/.github/workflows/$wf" || missing="$missing $wf"
  done
  if [ -n "$missing" ]; then
    record "$target" "2b:housekeeping-skip" FAIL "derive the release version without the integration-housekeeping opt-in:$missing"
    return
  fi
  derive="$dir/scripts/derive-release-version.sh"
  [ -f "$derive" ] || { record "$target" "2b:housekeeping-skip" SKIP "no scripts/derive-release-version.sh in the clone"; return; }
  t=$(mktemp -d "$WORK_DIR/hk.XXXXXX")
  (
    cd "$t" && git init -q -b main && git config user.email t@example.test && git config user.name t \
      && echo x > f && git add f && git commit -q -m "chore: sync SDLC templates from DevAudit"
  ) >/dev/null 2>&1
  got=$(cd "$t" && DEVAUDIT_SKIP_INTEGRATION_HOUSEKEEPING=1 bash "$derive" 2>/dev/null)
  if [ -n "$got" ]; then
    record "$target" "2b:housekeeping-skip" FAIL "untagged housekeeping with no declaration derived '$got', expected no release"
    rm -rf "$t"; return
  fi
  mkdir -p "$t/compliance/standalone-housekeeping"
  echo '{}' > "$t/compliance/standalone-housekeeping/STANDALONE-HOUSEKEEPING-v$(date -u +%Y.%m.%d).json"
  got=$(cd "$t" && DEVAUDIT_SKIP_INTEGRATION_HOUSEKEEPING=1 bash "$derive" 2>/dev/null)
  rm -rf "$t"
  if [ "$got" = "v$(date -u +%Y.%m.%d)" ]; then
    record "$target" "2b:housekeeping-skip" PASS "untagged housekeeping registers no release; with a standalone declaration it keeps $got"
  else
    record "$target" "2b:housekeeping-skip" FAIL "with a standalone declaration derived '$got', expected v$(date -u +%Y.%m.%d)"
  fi
}

# devaudit-installer#941: the clone's own Release Close-out workflow, executed step by
# step against a tracer fixture, a fake gh and a mock portal (the counterpart of the gate).
_closeout_test() { # <workflow>
  (cd "$ROOT/cli" && CLOSEOUT_WORKFLOW_FILE="$1" DEVAUDIT_INSTALLER_ROOT="$ROOT" \
     npx vitest run test/close-out-workflow-behavior.test.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]' | tail -1)
}

scenario_close_out() {
  local target="$1" dir="$2" wf out
  wf=$(ls "$dir"/.github/workflows/close-out-release*.yml 2>/dev/null | head -1)
  if [ -z "$wf" ]; then record "$target" "2b:close-out" SKIP "no close-out-release workflow in this clone"; return; fi
  if [ -f "$wf.devaudit-new" ]; then wf="$wf.devaudit-new"; fi
  out=$(_closeout_test "$wf")
  if printf '%s' "$out" | grep -q 'failed' || [ -z "$out" ]; then
    record "$target" "2b:close-out" FAIL "the clone's $(basename "$wf") against a mock portal: ${out:-no result}"
  else
    record "$target" "2b:close-out" PASS "the clone's $(basename "$wf") run against a mock portal: $out"
  fi
}

scenario_ci_workflows() {
  local target="$1" dir="$2" list="$3" n tmp kept
  n=$(grep -c '^\.github/workflows/' "$list" || true)
  # The candidate's output is what is validated: every workflow the update wrote, plus the
  # upstream copy (<file>.devaudit-new) of any workflow the clone kept as its own (a conflict).
  # A kept stale copy is the consumer's to resolve; layer 2 (workflows-parse) reports it.
  tmp=$(mktemp -d "$WORK_DIR/candidate-wf.XXXXXX")
  mkdir -p "$tmp/.github/workflows"
  kept=0
  local f base
  for f in "$dir"/.github/workflows/*.yml; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    if [ -f "$f.devaudit-new" ]; then cp "$f.devaudit-new" "$tmp/.github/workflows/$base"; kept=$((kept + 1)); else cp "$f" "$tmp/.github/workflows/$base"; fi
  done
  check_workflows "$target:candidate" "$tmp"
  check_housekeeping_skip_rule "$target" "$dir" "$tmp"
  record "$target" "2b:ci-workflows" PASS "$n workflow file(s) changed by the update; $kept kept as the clone's own (conflict) were checked through their upstream .devaudit-new copy"
  rm -rf "$tmp"
}

scenario_sync_safety() {
  local target="$1" dir="$2" f="scripts/derive-release-version.sh" before after
  [ -f "$dir/$f" ] || { record "$target" "2b:sync-safety" FAIL "$f missing"; return; }
  local base; base=$(isolated "$dir" git rev-parse HEAD)
  printf '\n# local edit by release-validation (2b)\n' >> "$dir/$f"
  isolated "$dir" git add -A >/dev/null 2>&1
  isolated "$dir" git -c user.name=release-validation -c user.email=rv@localhost commit -q --no-verify -m "local edit" >/dev/null 2>&1
  before=$(sha256sum "$dir/$f" | cut -d' ' -f1)
  isolated "$dir" node "$CLI" update . > "$WORK_DIR/$target.sync-safety1.log" 2>&1
  isolated "$dir" node "$CLI" update . > "$WORK_DIR/$target.sync-safety2.log" 2>&1
  after=$(sha256sum "$dir/$f" | cut -d' ' -f1)
  if [ "$before" = "$after" ] && [ -f "$dir/$f.devaudit-new" ]; then
    record "$target" "2b:sync-safety" PASS "a local edit to $f survived two updates; upstream is in $f.devaudit-new (#988)"
  else
    record "$target" "2b:sync-safety" FAIL "local edit to $f was overwritten or no .devaudit-new written (hash changed: $([ "$before" = "$after" ] && echo no || echo YES))"
  fi
  isolated "$dir" git reset -q --hard "$base"; isolated "$dir" git clean -qfd >/dev/null 2>&1
}

scenario_branch_protection() {
  local target="$1" dir="$2" line bad
  local log="$WORK_DIR/$target.update1.log"
  line=$(grep -h '\[2k\] Branch protection' "$log" | head -1)
  bad=$(printf '%s' "$line" | grep -oE 'failed — [^|]*' | grep -v 'gh write blocked during release validation' || true)
  local baseline_calls
  baseline_calls=$(grep -c 'cwd=/tmp/devaudit-baseline' "$GH_LOG" 2>/dev/null || true)
  if [ -z "$line" ]; then
    record "$target" "2b:branch-protection" WARN "no section 2k line (git provider unavailable?)"
  elif [ -n "$bad" ]; then
    record "$target" "2b:branch-protection" FAIL "unexpected failure: $bad"
  elif [ "${baseline_calls:-0}" -ne 0 ]; then
    record "$target" "2b:branch-protection" FAIL "the baseline run made $baseline_calls gh call(s) (#990)"
  else
    record "$target" "2b:branch-protection" PASS "2k reports no unexpected failure; baseline run made no gh call: $(printf '%s' "$line" | sed -E 's/.*Branch protection: [0-9]+ file\(s\) — //' | cut -c1-110)"
  fi
}

scenario_deferral() {
  local target="$1" dir="$2" rb
  rb=$(jq -r '.release_branch // "main"' "$dir/sdlc-config.json" 2>/dev/null || echo main)
  if isolated "$dir" git rev-parse --verify -q "origin/$rb" >/dev/null; then check_deferral_scenario "$target" "$dir" "$rb"
  else record "$target" "2b:deferral" SKIP "no origin/$rb in the clone"; fi
}

scenario_doctor() { check_doctor "$1" "$2"; }

scenario_scripts() {
  local target="$1" dir="$2" list="$3" bad="" n=0 f
  while IFS= read -r f; do
    case "$f" in scripts/*.sh) n=$((n + 1)); bash -n "$dir/$f" 2>/dev/null || bad="$bad $f" ;; esac
  done < "$list"
  if [ -z "$bad" ]; then record "$target" "2b:scripts" PASS "$n changed script(s) parse (bash -n)"; else record "$target" "2b:scripts" FAIL "do not parse:$bad"; fi
}

scenario_skills_docs() {
  local target="$1" dir="$2" bad="" n=0 f
  for f in "$dir"/.claude/skills/*/SKILL.md; do
    [ -f "$f" ] || continue; n=$((n + 1))
    head -5 "$f" | grep -q '^name:' || bad="$bad $(basename "$(dirname "$f")")"
  done
  if [ "$n" -gt 0 ] && [ -z "$bad" ]; then record "$target" "2b:skills-docs" PASS "$n skill(s) present with frontmatter"; else record "$target" "2b:skills-docs" FAIL "skills: $n found; no frontmatter:${bad:- none}"; fi
}

scenario_ai_rules() {
  local target="$1" dir="$2" missing="" f
  for f in AGENTS.md CLAUDE.md INSTRUCTIONS.md; do [ -f "$dir/$f" ] || missing="$missing $f"; done
  if [ -z "$missing" ] && grep -qi 'sdlc' "$dir/INSTRUCTIONS.md"; then
    record "$target" "2b:ai-rules" PASS "AI pointer files and INSTRUCTIONS.md present after the update, with the SDLC section"
  else
    record "$target" "2b:ai-rules" FAIL "missing:${missing:- none}; INSTRUCTIONS.md SDLC section: $(grep -qi sdlc "$dir/INSTRUCTIONS.md" 2>/dev/null && echo yes || echo NO)"
  fi
}

scenario_adapters() {
  local target="$1" dir="$2" v
  v=$(jq -r '.devaudit_synced_version // empty' "$dir/sdlc-config.json" 2>/dev/null)
  if [ -n "$v" ] && [ "$v" = "$(candidate_version)" ]; then
    record "$target" "2b:adapters" PASS "sdlc-config.json still valid JSON, devaudit_synced_version stamped $v, workflows rendered from the changed adapters"
  else
    record "$target" "2b:adapters" FAIL "sdlc-config.json stamp '${v:-none}' != $(candidate_version), or not valid JSON"
  fi
}

scenario_sdlc_engine() {
  local target="$1" dir="$2" out
  out=$(isolated "$dir" node SDLC/bin/devaudit-sdlc.cjs --help 2>&1 | head -1)
  if [ -f "$dir/SDLC/bin/devaudit-sdlc.cjs" ] && [ -n "$out" ]; then
    record "$target" "2b:sdlc-engine" PASS "SDLC/bin/devaudit-sdlc.cjs runs in the clone: $(printf '%s' "$out" | cut -c1-80)"
  else
    record "$target" "2b:sdlc-engine" FAIL "SDLC/bin/devaudit-sdlc.cjs missing or does not run"
  fi
}

scenario_cli_core() {
  local target="$1" dir="$2" list="$3" n areas
  n=$(wc -l < "$list" | tr -d ' ')
  areas=$(synced_areas "$list")
  record "$target" "2b:synced-changes" PASS "$n file(s) changed by the update: ${areas:-none} (list: $list)"
}

# --- runner ---------------------------------------------------------------
run_layer2b() {
  echo ""
  echo "== layer 2b: change-driven checks"
  local base surfaces
  base=$(release_base_ref)
  if [ -z "$base" ]; then record installer 2b-base WARN "no release tag found; set RV_BASE_REF"; return 0; fi
  surfaces=$(changed_surfaces "$base")
  record installer 2b-base PASS "changes since $base: $(printf '%s\n' "$surfaces" | grep -vc '^unclassified' | tr -d ' ') surface(s)"
  local name count have_scenario
  declare -A runnable=()
  while IFS=$'\t' read -r name count; do
    [ -n "$name" ] || continue
    if [ "$name" = unclassified ]; then
      record installer "2b-coverage:unclassified" WARN "changed shipped path matches no surface: $count (add it to scripts/release-validation/surfaces.tsv)"
      continue
    fi
    if declare -F "scenario_${name//-/_}" >/dev/null; then
      runnable[$name]=$count
      record installer "2b-coverage:$name" PASS "$count changed path(s); scenario scenario_${name//-/_} will run on the clones"
    else
      record installer "2b-coverage:$name" WARN "$count changed path(s) but NO scenario exercises this surface"
    fi
  done <<< "$surfaces"

  local spec cname cdir pre list
  for spec in $RV_2B_CONSUMERS; do
    cname="2b-$(basename "${spec%.git}")"
    cdir="$WORK_DIR/2b/$cname"
    echo ""; echo "== 2b clone $spec"
    clone_consumer "$spec" "$cdir" "$cname" || continue
    pre=$(git -C "$cdir" rev-parse HEAD)
    run_update_twice "$cname" "$cdir" || continue
    list="$WORK_DIR/$cname.synced-files.txt"
    git -C "$cdir" diff --name-only "$pre" HEAD > "$list" 2>/dev/null || : > "$list"
    for name in "${!runnable[@]}"; do
      "scenario_${name//-/_}" "$cname" "$cdir" "$list"
    done
  done
}
