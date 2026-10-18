#!/usr/bin/env bash
# release-validation.sh — pre-release validation gate for DevAudit-Installer
# (docs/release-validation-plan.md; devaudit-installer#941, #932, #917).
#
# Runs the candidate Installer (this checkout, built locally) against:
#   layer1            this repo's own automated checks + pack/install smoke
#   layer2b           change-driven: what changed since the last release tag is
#                     mapped to surfaces and exercised on two representative clones
#   consumer <name>   an ISOLATED clone of metasession-dev/<name> (or a path)
#   fixture <stack>   a fresh fixture repo (node | python) with no prior sync
#   all [names...]    layer1, every named consumer, both fixtures, layer2b
#
# SAFETY (consumer repos are read-only):
#   - every consumer is cloned into $WORK_DIR; the real checkout under
#     /srv/... is never touched;
#   - the clone's push URL is set to an invalid value, so nothing can be
#     pushed even by accident;
#   - a stub `gh` is first on PATH for every step run inside a clone: `update`
#     seeds GitHub issue labels (#970) through `gh label create`, which would
#     write to the REAL repo; the stub records the call and fails it;
#   - portal credentials (DEVAUDIT_*_TOKEN / *_API_KEY) are unset, so nothing
#     can reach the portal; doctor's portal checks skip gracefully;
#   - local commits made for the idempotency and deferral checks stay in the
#     throwaway clone.
#
# Output: one TSV line per check in $WORK_DIR/results.tsv and a markdown
# table in $WORK_DIR/results.md (paste it on the release PR / umbrella).
#
# Usage:
#   scripts/release-validation.sh all                 # every consumer in consumers.local
#   scripts/release-validation.sh all <name> [<name>...]
#   scripts/release-validation.sh consumer <name>
#   WORK_DIR=/tmp/rv scripts/release-validation.sh fixture python
#
# Env:
#   WORK_DIR        scratch dir (default: mktemp -d); kept for inspection
#   CONSUMER_REF    branch to validate (default: develop, else default branch)
#   GITHUB_OWNER    default metasession-dev
#   SKIP_BUILD=1    reuse an existing cli/dist build
#   SKIP_LAYER1_TESTS=1  layer1 skips the (slow) vitest/shell suites
#   RV_CONSUMERS_FILE    consumer list (default scripts/release-validation/consumers.local,
#                        gitignored: consumers are never named in this public repo, #1042).
#                        One "<repo-name> <node|python>" per line; '#' comments.
#
# Exit: 0 when no check FAILed (WARNs allowed); 1 otherwise; 2 usage error.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/cli/dist/index.js"
WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/devaudit-release-validation.XXXXXX")}"
GITHUB_OWNER="${GITHUB_OWNER:-metasession-dev}"
mkdir -p "$WORK_DIR"
WORK_DIR="$(cd "$WORK_DIR" && pwd)" # absolute, no '..': paths are matched against logs
RESULTS="$WORK_DIR/results.tsv"
touch "$RESULTS"

STUB_BIN="$WORK_DIR/stub-bin"
GH_LOG="$WORK_DIR/gh-stub.log"

# ---------------------------------------------------------------------------
# result helpers
# ---------------------------------------------------------------------------
record() { # <target> <check> <PASS|WARN|FAIL|SKIP> <detail>
  local detail="${4//$'\t'/ }"
  detail="${detail//$'\n'/ }"
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$detail" >> "$RESULTS"
  printf '  [%s] %-28s %s\n' "$3" "$2" "$detail"
}

die() { echo "release-validation: $*" >&2; exit 2; }

RV_CONSUMERS_FILE="${RV_CONSUMERS_FILE:-$ROOT/scripts/release-validation/consumers.local}"
# local_consumers [stack]: repo names from the local consumer list, optionally one stack only.
local_consumers() {
  [ -f "$RV_CONSUMERS_FILE" ] || return 0
  awk -v want="${1:-}" '!/^[[:space:]]*(#|$)/ { if (want == "" || $2 == want) print $1 }' "$RV_CONSUMERS_FILE"
}

# ---------------------------------------------------------------------------
# isolation: stub gh, no portal credentials, no push
# ---------------------------------------------------------------------------
make_stub_gh() {
  mkdir -p "$STUB_BIN"
  local real_gh
  real_gh="$(PATH="${PATH//$STUB_BIN:/}" command -v gh || true)"
  cat > "$STUB_BIN/gh" <<'GHSTUB'
#!/usr/bin/env bash
# release-validation stub: read-only gh calls pass through to the real gh
# (update needs repo metadata: verifyDefaultBranch reads the default branch);
# every other call is refused, so a validation run never writes to GitHub
# (label create #970, repo edit --default-branch, variable/secret set, api
# with a method or fields, pr/issue create, ...).
REAL_GH="__REAL_GH__"
GH_LOG="__GH_LOG__"
read_only=0
case "${1:-} ${2:-}" in
  "--version "*|"version "*|"auth status") read_only=1 ;;
  "repo view"|"label list"|"pr list"|"pr view"|"issue list"|"issue view"|"run list"|"run view"|"variable list"|"secret list") read_only=1 ;;
  "api "*)
    read_only=1
    for a in "$@"; do
      case "$a" in -X|-X*|--method|--method=*|-f|-f*|-F|-F*|--field|--field=*|--raw-field|--raw-field=*|--input|--input=*) read_only=0 ;; esac
    done ;;
esac
if [ "$read_only" = 1 ] && [ -n "$REAL_GH" ]; then
  echo "$(date -u +%FT%TZ) cwd=$PWD ALLOWED gh $*" >> "$GH_LOG"
  exec "$REAL_GH" "$@"
fi
echo "$(date -u +%FT%TZ) cwd=$PWD BLOCKED gh $*" >> "$GH_LOG"
echo "gh write blocked during release validation (stub): gh $*" >&2
exit 1
GHSTUB
  sed -i "s#__REAL_GH__#${real_gh}#; s#__GH_LOG__#${GH_LOG}#" "$STUB_BIN/gh"
  chmod +x "$STUB_BIN/gh"
}

# Run a command inside a clone with the isolation applied.
isolated() { # <dir> <cmd...>
  local dir="$1"; shift
  (
    cd "$dir" || exit 97
    env -u DEVAUDIT_USER_TOKEN -u DEVAUDIT_API_KEY -u DEVAUDIT_VIEWER_API_KEY \
        -u META_COMPLY_USER_TOKEN -u META_COMPLY_API_KEY -u GH_TOKEN -u GITHUB_TOKEN \
        PATH="$STUB_BIN:$PATH" \
        DEVAUDIT_INSTALLER_ROOT="$ROOT" \
        CI= \
        GIT_TERMINAL_PROMPT=0 \
        "$@"
  )
}

ensure_build() {
  if [ "${SKIP_BUILD:-0}" = "1" ] && [ -f "$CLI" ]; then return 0; fi
  echo "Building the candidate CLI ($ROOT/cli)..."
  ( cd "$ROOT/plugin-sdk" && npm ci --silent >/dev/null 2>&1 && npm run build --silent >/dev/null 2>&1 ) \
    || die "plugin-sdk build failed"
  ( cd "$ROOT/cli" && npm install --legacy-peer-deps --silent >/dev/null 2>&1 && npm run build --silent >/dev/null 2>&1 ) \
    || die "cli build failed"
}

candidate_version() { node -p "require('$ROOT/cli/package.json').version"; }

# ---------------------------------------------------------------------------
# workflow syntax: YAML parses, no unrendered {{TOKENS}}, every run: is bash -n clean
# ---------------------------------------------------------------------------
check_workflows() { # <target> <dir>
  local target="$1" dir="$2" out
  if [ ! -d "$dir/.github/workflows" ]; then
    record "$target" workflows-parse FAIL "no .github/workflows after update"
    return
  fi
  out=$(python3 -I - "$dir/.github/workflows" <<'PY' 2>&1
import glob, os, re, subprocess, sys
import yaml
bad = []
files = sorted(glob.glob(os.path.join(sys.argv[1], '*.yml')) + glob.glob(os.path.join(sys.argv[1], '*.yaml')))
for f in files:
    text = open(f, encoding='utf-8').read()
    name = os.path.basename(f)
    if re.search(r'\{\{[A-Z0-9_]+\}\}', text):
        bad.append(f'{name}: unrendered template token')
    try:
        doc = yaml.safe_load(text)
    except Exception as e:  # noqa: BLE001
        bad.append(f'{name}: YAML error {str(e).splitlines()[0]}')
        continue
    for job_id, job in (doc.get('jobs') or {}).items():
        for i, step in enumerate((job or {}).get('steps') or []):
            run = (step or {}).get('run')
            shell = (step or {}).get('shell') or (job or {}).get('defaults', {}).get('run', {}).get('shell', 'bash')
            if not run or 'bash' not in str(shell):
                continue
            # GitHub expressions are substituted before the shell sees them.
            script = re.sub(r'\$\{\{.*?\}\}', 'X', run, flags=re.S)
            p = subprocess.run(['bash', '-n'], input=script, text=True, capture_output=True)
            if p.returncode != 0:
                bad.append(f'{name}:{job_id}:step{i} bash -n: {p.stderr.strip().splitlines()[0]}')
print(f'{len(files)} workflow(s)')
for b in bad:
    print('BAD ' + b)
sys.exit(1 if bad else 0)
PY
)
  if [ $? -eq 0 ]; then
    record "$target" workflows-parse PASS "$(printf '%s' "$out" | head -1); YAML, tokens, bash -n clean"
  else
    record "$target" workflows-parse FAIL "$(printf '%s' "$out" | grep '^BAD' | head -5 | tr '\n' ';')"
  fi
}

# ---------------------------------------------------------------------------
# synced deferral scripts present + executable
# ---------------------------------------------------------------------------
check_synced_scripts() { # <target> <dir>
  local target="$1" dir="$2" missing=""
  for s in is-deferred-ticket.sh check-deferred-reqs-in-range.sh list-reqs-in-range.sh \
           provenance-gated-commit.sh derive-release-version.sh close-out-reconcile.sh; do
    [ -x "$dir/scripts/$s" ] || missing="$missing $s"
  done
  if [ -z "$missing" ]; then
    record "$target" synced-scripts PASS "deferral/provenance scripts present and executable"
  else
    record "$target" synced-scripts FAIL "missing or not executable:$missing"
  fi
}

# ---------------------------------------------------------------------------
# update twice: first succeeds, second changes nothing
# ---------------------------------------------------------------------------
run_update_twice() { # <target> <dir>
  local target="$1" dir="$2" log="$WORK_DIR/$1.update1.log" log2="$WORK_DIR/$1.update2.log" rc start
  # Writes are attributed by log offset, not by cwd: the manifest bootstrap
  # runs an older CLI in a /tmp worktree, and its writes count too.
  start=$(wc -l < "$GH_LOG" 2>/dev/null || echo 0)
  isolated "$dir" node "$CLI" update . > "$log" 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then
    record "$target" update FAIL "exit $rc (see $log): $(tail -3 "$log" | tr '\n' ' ')"
    return 1
  fi
  local conflicts
  # formatConflictSummary (cli/src/update/write-managed.ts) opens with
  # "<n> file(s) have local modifications devaudit will not overwrite:".
  conflicts=$(grep -oE '[0-9]+ file\(s\) have local modifications devaudit will not overwrite' "$log" | head -1)
  if [ -n "$conflicts" ]; then
    record "$target" update WARN "exit 0; $conflicts: $(grep -E '^ *- .*(\.devaudit-new|stale file kept)' "$log" | head -5 | sed 's/^ *- //' | cut -d' ' -f1 | tr '\n' ' ')(see $log)"
  else
    record "$target" update PASS "exit 0, $(isolated "$dir" git status --porcelain | wc -l | tr -d ' ') path(s) changed"
  fi
  local blocked
  blocked=$(tail -n +"$((start + 1))" "$GH_LOG" 2>/dev/null | grep ' BLOCKED gh ' \
    | sed -E 's/.* BLOCKED gh ([^ ]+ [^ ]+).*/\1/' | sort | uniq -c | sed -E 's/^ +//' | tr '\n' ';')
  record "$target" gh-writes-blocked PASS "${blocked:-no gh write attempted}"
  # Commit the sync locally (throwaway clone) so a second run can be compared.
  isolated "$dir" git add -A >/dev/null 2>&1
  isolated "$dir" git -c user.name=release-validation -c user.email=rv@localhost \
    commit -q --no-verify -m "chore: release-validation sync (local only)" >/dev/null 2>&1 || true
  isolated "$dir" node "$CLI" update . > "$log2" 2>&1
  rc=$?
  local drift
  drift=$(isolated "$dir" git status --porcelain)
  if [ $rc -ne 0 ]; then
    record "$target" update-idempotent FAIL "second update exit $rc (see $log2)"
  elif [ -n "$drift" ]; then
    record "$target" update-idempotent FAIL "second update changed: $(printf '%s' "$drift" | head -5 | tr '\n' ' ')"
  else
    record "$target" update-idempotent PASS "second update changed nothing"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# doctor: read-only JSON contract, --fix --dry-run changes nothing
# ---------------------------------------------------------------------------
check_doctor() { # <target> <dir>
  local target="$1" dir="$2" out rc keys
  out=$(isolated "$dir" node "$CLI" doctor --json 2>/dev/null)
  rc=$?
  keys=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("{")));const need=["ok","tools","releaseCloseoutDrift","onboarding","deferral","proposals"];const miss=need.filter(k=>!(k in j));console.log(miss.length?"missing:"+miss.join(","):"ok deferral="+j.deferral.map(c=>c.name+":"+(c.ok?"ok":"warn")).join(" "))}catch(e){console.log("unparseable")}})')
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 6 ]; then
    record "$target" doctor-json FAIL "exit $rc ($keys)"
  elif [[ "$keys" == ok* ]]; then
    record "$target" doctor-json PASS "exit $rc; $keys"
  else
    record "$target" doctor-json FAIL "exit $rc; $keys"
  fi
  local before after
  before=$(isolated "$dir" git status --porcelain)
  isolated "$dir" node "$CLI" doctor --fix --dry-run > "$WORK_DIR/$target.fix-dry-run.log" 2>&1
  rc=$?
  after=$(isolated "$dir" git status --porcelain)
  if [ "$before" != "$after" ]; then
    record "$target" doctor-fix-dry-run FAIL "--dry-run changed the tree"
  elif [ "$rc" -ne 0 ] && [ "$rc" -ne 6 ]; then
    record "$target" doctor-fix-dry-run FAIL "exit $rc (see $WORK_DIR/$target.fix-dry-run.log)"
  else
    record "$target" doctor-fix-dry-run PASS "exit $rc, tree unchanged"
  fi
}

# ---------------------------------------------------------------------------
# read-only script smoke on the real history
# ---------------------------------------------------------------------------
check_scripts_on_history() { # <target> <dir> <release_branch>
  local target="$1" dir="$2" rb="$3" out rc
  out=$(isolated "$dir" bash scripts/derive-release-version.sh 2>&1); rc=$?
  if [ $rc -eq 0 ] && [ -n "$out" ]; then
    record "$target" derive-release-version PASS "$(printf '%s' "$out" | tail -1)"
  else
    record "$target" derive-release-version FAIL "exit $rc: $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
  fi
  out=$(isolated "$dir" env CURRENT_RELEASE= SINCE_REF="origin/$rb" bash scripts/check-deferred-reqs-in-range.sh 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    record "$target" deferral-gate-real PASS "$(printf '%s' "$out" | tail -1)"
  else
    record "$target" deferral-gate-real FAIL "exit $rc: $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
  fi
  out=$(isolated "$dir" bash scripts/close-out-reconcile.sh compliance/pending-releases 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    record "$target" close-out-reconcile PASS "stale: ${out:-none}"
  else
    record "$target" close-out-reconcile FAIL "exit $rc: $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
  fi
}

# ---------------------------------------------------------------------------
# deferral scenario on the real repo (local commits only, then reset)
# ---------------------------------------------------------------------------
check_deferral_scenario() { # <target> <dir> <release_branch>
  local target="$1" dir="$2" rb="$3" base out rc
  base=$(isolated "$dir" git rev-parse HEAD)
  local D="REQ-9901" N="REQ-9902" P="compliance/pending-releases"
  isolated "$dir" mkdir -p "$P" "rv-deferral"
  isolated "$dir" bash -c "cat > $P/RELEASE-TICKET-$D.md <<'EOF'
# Release Ticket: $D

**Status:** TESTED - PENDING SIGN-OFF
- **Release intent:** deferred-to-next — release-validation scenario, PR #0 closed unmerged
EOF
cat > $P/RELEASE-TICKET-$N.md <<'EOF'
# Release Ticket: $N

**Status:** TESTED - PENDING SIGN-OFF
- **Absorbed predecessor releases:** None
EOF"
  isolated "$dir" bash -c "echo deferred > rv-deferral/$D.txt"
  isolated "$dir" git add -A >/dev/null 2>&1
  isolated "$dir" git -c user.name=release-validation -c user.email=rv@localhost \
    commit -q --no-verify -m "feat: release-validation deferred work [$D]" >/dev/null 2>&1
  # A later, untagged commit on top: derive-release-version's steps 1-3 read
  # REQ tags from HEAD, so the pending-ticket path (step 4, which must skip
  # deferred tickets) is only reached when HEAD carries no REQ tag.
  isolated "$dir" bash -c "echo later > rv-deferral/later.txt"
  isolated "$dir" git add -A >/dev/null 2>&1
  isolated "$dir" git -c user.name=release-validation -c user.email=rv@localhost \
    commit -q --no-verify -m "chore: release-validation unrelated follow-up" >/dev/null 2>&1

  # 1. the shared helper recognises the deferred ticket
  if isolated "$dir" bash scripts/is-deferred-ticket.sh "$P/RELEASE-TICKET-$D.md" \
     && ! isolated "$dir" bash scripts/is-deferred-ticket.sh "$P/RELEASE-TICKET-$N.md"; then
    record "$target" scenario-is-deferred PASS "deferred ticket recognised, normal ticket not"
  else
    record "$target" scenario-is-deferred FAIL "is-deferred-ticket.sh misclassified the scenario tickets"
  fi
  # 2. derive-release-version never derives the parked REQ
  out=$(isolated "$dir" env DEVAUDIT_ALLOW_PENDING_TICKET_FALLBACK=1 bash scripts/derive-release-version.sh 2>/dev/null)
  if [ "$out" != "$D" ]; then
    record "$target" scenario-derive-skips PASS "derived '${out:-<none>}', not the deferred $D"
  else
    record "$target" scenario-derive-skips FAIL "derived the deferred $D"
  fi
  # 3. promotion gate fails while the deferred REQ ships unlisted
  out=$(isolated "$dir" env CURRENT_RELEASE="$N" SINCE_REF="origin/$rb" bash scripts/check-deferred-reqs-in-range.sh 2>&1); rc=$?
  if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "$D is deferred"; then
    record "$target" scenario-gate-blocks PASS "gate fails: $D deferred and unlisted"
  else
    record "$target" scenario-gate-blocks FAIL "gate exit $rc, expected a failure naming $D"
  fi
  # 4. ... and passes once the successor lists it as an absorbed predecessor
  isolated "$dir" sed -i "s/^- \*\*Absorbed predecessor releases:\*\* None/- **Absorbed predecessor releases:** $D/" "$P/RELEASE-TICKET-$N.md"
  out=$(isolated "$dir" env CURRENT_RELEASE="$N" SINCE_REF="origin/$rb" bash scripts/check-deferred-reqs-in-range.sh 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    record "$target" scenario-gate-allows PASS "gate passes once $N lists $D"
  else
    record "$target" scenario-gate-allows FAIL "gate exit $rc after listing: $(printf '%s' "$out" | tail -1)"
  fi
  # 5. close-out-reconcile does not report the deferred ticket as a missed close-out
  out=$(isolated "$dir" bash scripts/close-out-reconcile.sh "$P" 2>&1)
  if printf '%s\n' "$out" | grep -qx "$D"; then
    record "$target" scenario-reconcile FAIL "deferred $D reported as a stale close-out"
  else
    record "$target" scenario-reconcile PASS "deferred $D not reported as stale"
  fi
  isolated "$dir" git reset -q --hard "$base"
  isolated "$dir" git clean -qfd >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# targets
# ---------------------------------------------------------------------------
validate_dir() { # <target> <dir>
  local target="$1" dir="$2" rb
  rb=$(jq -r '.release_branch // "main"' "$dir/sdlc-config.json" 2>/dev/null || echo main)
  [ -n "$rb" ] && [ "$rb" != "null" ] || rb=main
  run_update_twice "$target" "$dir" || return 0
  check_synced_scripts "$target" "$dir"
  check_workflows "$target" "$dir"
  check_doctor "$target" "$dir"
  if isolated "$dir" git rev-parse --verify -q "origin/$rb" >/dev/null; then
    check_scripts_on_history "$target" "$dir" "$rb"
    check_deferral_scenario "$target" "$dir" "$rb"
  else
    record "$target" history-checks SKIP "no origin/$rb in the clone"
  fi
}

# clone_consumer <name|url|path> <dir> <target>: isolated clone of the consumer's
# develop (else default) branch with push disabled; records clone PASS/FAIL.
clone_consumer() {
  local spec="$1" dir="$2" name="$3" url ref
  case "$spec" in
    http*://*|git@*) url="$spec" ;;
    /*|./*|../*) url="$(cd "$spec" && git remote get-url origin)" ;;
    *) url="https://github.com/${GITHUB_OWNER}/${spec}.git" ;;
  esac
  rm -rf "$dir"
  mkdir -p "$(dirname "$dir")"
  if ! git clone -q "$url" "$dir" 2>"$WORK_DIR/$name.clone.log"; then
    record "$name" clone FAIL "$(tail -1 "$WORK_DIR/$name.clone.log")"
    return 1
  fi
  git -C "$dir" remote set-url --push origin "no-push://release-validation-is-read-only"
  ref="${CONSUMER_REF:-}"
  if [ -z "$ref" ]; then
    if git -C "$dir" rev-parse --verify -q origin/develop >/dev/null; then ref=develop; else ref=$(git -C "$dir" symbolic-ref --short HEAD); fi
  fi
  git -C "$dir" checkout -q "$ref" 2>/dev/null || git -C "$dir" checkout -q -b "$ref" "origin/$ref"
  if [ ! -f "$dir/sdlc-config.json" ]; then
    record "$name" clone FAIL "no sdlc-config.json on $ref (not an onboarded consumer)"
    return 1
  fi
  record "$name" clone PASS "$ref @ $(git -C "$dir" rev-parse --short HEAD); push disabled"
}

validate_consumer() { # <name|url|path>
  local spec="$1" name dir
  name=$(basename "${spec%.git}")
  dir="$WORK_DIR/consumers/$name"
  echo ""
  echo "== consumer $name"
  clone_consumer "$spec" "$dir" "$name" || return 0
  validate_dir "$name" "$dir"
}

validate_fixture() { # <node|python>
  local stack="$1" name="fixture-$1" dir
  dir="$WORK_DIR/fixtures/$name"
  echo ""
  echo "== fresh fixture ($stack)"
  rm -rf "$dir"; mkdir -p "$dir" "$WORK_DIR/fixtures"
  (
    cd "$dir" || exit 1
    git init -q -b main
    git config user.name release-validation; git config user.email rv@localhost
    # The directories `devaudit install` creates; `update` only syncs into
    # directories that exist (scripts/, .github/workflows/).
    mkdir -p scripts compliance/pending-releases .github/workflows
    if [ "$stack" = node ]; then
      cat > package.json <<'EOF'
{ "name": "rv-fixture-node", "version": "0.0.0", "private": true, "scripts": { "test": "echo ok" } }
EOF
      printf '{\n  "project_slug": "rv-fixture-node",\n  "stack": "node",\n  "integration_branch": "develop",\n  "release_branch": "main",\n  "devaudit": { "project_slug": "rv-fixture-node", "base_url": "http://127.0.0.1:9" }\n}\n' > sdlc-config.json
    else
      printf '[project]\nname = "rv-fixture-python"\nversion = "0.0.0"\n' > pyproject.toml
      printf '{\n  "project_slug": "rv-fixture-python",\n  "stack": "python",\n  "integration_branch": "develop",\n  "release_branch": "main",\n  "devaudit": { "project_slug": "rv-fixture-python", "base_url": "http://127.0.0.1:9" }\n}\n' > sdlc-config.json
    fi
    printf '# RTM\n\n| REQ-ID | Status |\n| --- | --- |\n' > compliance/RTM.md
    git add -A && git commit -q -m "chore: fixture"
    git branch -q develop && git checkout -q develop
    git update-ref refs/remotes/origin/main main
  ) || { record "$name" fixture FAIL "could not create the fixture"; return 0; }
  record "$name" fixture PASS "blank $stack repo, no prior sync"
  validate_dir "$name" "$dir"
  # devaudit-installer#995: declared-bundle parity in the generated Python ci.yml.
  if [ "$stack" = python ]; then
    local ci="$dir/.github/workflows/ci.yml"
    if [ -f "$ci" ] \
       && grep -q 'Generate and upload bundled changes (declared bundle)' "$ci" \
       && grep -q 'DEVAUDIT_DERIVE_BUNDLE_ONLY=1' "$ci" \
       && grep -q 'resolve-bundle-release.sh' "$ci"; then
      record "$name" python-bundle-parity PASS "the generated Python ci.yml registers a declared bundle and files members via resolve-bundle-release.sh"
    else
      record "$name" python-bundle-parity FAIL "the generated Python ci.yml is missing the declared-bundle steps (#995)"
    fi
  fi
}

run_layer1() {
  echo ""
  echo "== layer 1: installer automated checks ($ROOT)"
  local v rc out
  v=$(candidate_version)
  if [ "$(cd "$ROOT/cli" && npm run typecheck >/dev/null 2>&1; echo $?)" = 0 ]; then
    record installer typecheck PASS "cli tsc --noEmit clean"
  else
    record installer typecheck FAIL "cli typecheck failed"
  fi
  local mismatch=""
  for p in plugin-sdk cli sdlc plugins/devaudit-plugin-prisma plugins/devaudit-plugin-evidence-export; do
    [ "$(node -p "require('$ROOT/$p/package.json').version")" = "$v" ] || mismatch="$mismatch $p"
  done
  if [ -z "$mismatch" ]; then record installer versions-aligned PASS "all 5 packages at $v"; else record installer versions-aligned WARN "not at $v:$mismatch (bump happens at release)"; fi
  # #1020: no operator-facing guidance may tell anyone to put a skip-CI tag on a
  # commit that goes through a PR (GitHub then runs no workflows, so the required
  # Quality Gates check is never created). Historical records, tests, the changelog
  # and the SRS (which describes the rule) are exempt.
  local skip_hits
  skip_hits=$(cd "$ROOT" && grep -rnI --include='*.md' --include='*.ts' --include='*.sh' --include='*.yml' --include='*.template' --include='*.json' -e '\[skip ci\]' \
    cli/src sdlc/files sdlc/src docs README.md .devin 2>/dev/null \
    | grep -v -e '^docs/issues/' -e '^docs/articles/' -e '\.test\.sh:' -e '^docs/SRS\.md:' || true)
  if [ -z "$skip_hits" ]; then
    record installer no-skip-ci-guidance PASS "no operator-facing guidance recommends a skip-CI tag"
  else
    record installer no-skip-ci-guidance FAIL "skip-CI tag found: $(printf '%s' "$skip_hits" | head -3 | tr '\n' ' ')"
  fi
  if [ "${SKIP_LAYER1_TESTS:-0}" != "1" ]; then
    out=$(cd "$ROOT/cli" && npx vitest run 2>&1 | grep -E 'Tests +[0-9]' | tail -1)
    if printf '%s' "$out" | grep -q 'failed'; then record installer vitest FAIL "$out"; else record installer vitest PASS "$out"; fi
    local failed="" n=0
    for t in "$ROOT"/sdlc/files/_common/scripts/*.test.sh "$ROOT"/scripts/*.test.sh; do
      n=$((n + 1))
      ( cd "$ROOT" && timeout 600 bash "$t" >/dev/null 2>&1 ) || failed="$failed $(basename "$t")"
    done
    if [ -z "$failed" ]; then record installer shell-tests PASS "$n shell test files"; else record installer shell-tests FAIL "failed:$failed"; fi
  else
    record installer vitest SKIP "SKIP_LAYER1_TESTS=1"
  fi
  if ( cd "$ROOT" && bash tests/release-pipeline-e2e/run.sh >/dev/null 2>&1 ); then
    record installer mock-portal-lifecycle PASS "tests/release-pipeline-e2e/run.sh"
  else
    record installer mock-portal-lifecycle FAIL "tests/release-pipeline-e2e/run.sh failed"
  fi
  # Pack the CLI and plugin-sdk as npm would and install them into an empty
  # prefix. The CLI depends on `file:../plugin-sdk` for local development;
  # release.yml rewrites that to the published version before publishing, so
  # do the equivalent here: point it at the packed plugin-sdk tarball.
  local pack="$WORK_DIR/pack" tgz sdk_tgz
  rm -rf "$pack"; mkdir -p "$pack/repack"
  sdk_tgz=$(cd "$ROOT/plugin-sdk" && npm pack --silent --pack-destination "$pack" 2>/dev/null | tail -1)
  tgz=$(cd "$ROOT/cli" && npm pack --silent --pack-destination "$pack" 2>/dev/null | tail -1)
  if [ -n "$tgz" ] && [ -n "$sdk_tgz" ]; then
    tar -xzf "$pack/$tgz" -C "$pack/repack" \
      && jq --arg dep "file:$pack/$sdk_tgz" '.dependencies["@metasession.co/devaudit-plugin-sdk"] = $dep' \
           "$pack/repack/package/package.json" > "$pack/repack/package.json.tmp" \
      && mv "$pack/repack/package.json.tmp" "$pack/repack/package/package.json" \
      && tar -czf "$pack/cli-release-shaped.tgz" -C "$pack/repack" package \
      && tgz=cli-release-shaped.tgz || tgz=""
  fi
  if [ -n "$tgz" ] && ( cd "$pack" && npm init -y >/dev/null 2>&1 && npm install --silent "$pack/$tgz" >/dev/null 2>&1 ); then
    out=$(cd "$pack" && npx --no-install devaudit --version 2>/dev/null)
    if [ "$out" = "$v" ]; then record installer pack-install PASS "npm pack + install: devaudit --version = $out"
    else record installer pack-install FAIL "installed version '$out' != $v"; fi
  else
    record installer pack-install FAIL "npm pack or install failed"
  fi
}

summarise() {
  {
    echo "| Target | Check | Result | Detail |"
    echo "| --- | --- | --- | --- |"
    while IFS=$'\t' read -r t c r d; do
      printf '| %s | %s | %s | %s |\n' "$t" "$c" "$r" "${d//|/\\|}"
    done < "$RESULTS"
  } > "$WORK_DIR/results.md"
  local fails warns
  fails=$(awk -F'\t' '$3=="FAIL"' "$RESULTS" | wc -l | tr -d ' ')
  warns=$(awk -F'\t' '$3=="WARN"' "$RESULTS" | wc -l | tr -d ' ')
  echo ""
  echo "Results: $WORK_DIR/results.md  ($fails FAIL, $warns WARN)"
  [ "$fails" -eq 0 ]
}

# shellcheck source=release-validation/layer2b.sh
source "$ROOT/scripts/release-validation/layer2b.sh"

main() {
  command -v jq >/dev/null || die "jq is required"
  command -v python3 >/dev/null || die "python3 is required"
  python3 -c 'import yaml' 2>/dev/null || die "python3 PyYAML is required"
  [ $# -ge 1 ] || die "usage: $0 {layer1|layer2b|consumer <name>|fixture <node|python>|all [names...]}"
  make_stub_gh
  local cmd="$1"; shift
  case "$cmd" in
    layer1) ensure_build; run_layer1 ;;
    layer2b) ensure_build; run_layer2b ;;
    consumer) [ $# -ge 1 ] || die "consumer needs a name"; ensure_build; for c in "$@"; do validate_consumer "$c"; done ;;
    fixture) [ $# -ge 1 ] || die "fixture needs node or python"; ensure_build; for s in "$@"; do validate_fixture "$s"; done ;;
    all)
      ensure_build; run_layer1
      if [ $# -eq 0 ]; then
        set -- $(local_consumers)
        [ $# -gt 0 ] || record installer consumers WARN "no consumers given and no $RV_CONSUMERS_FILE: only layer 1, fixtures and layer 2b ran"
      fi
      for c in "$@"; do validate_consumer "$c"; done; validate_fixture node; validate_fixture python; run_layer2b ;;
    *) die "unknown command '$cmd'" ;;
  esac
  summarise
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
