#!/usr/bin/env bash
# upload-compliance-documents.test.sh — behavioural tests for the per-requirement upload loop of
# upload-compliance-documents.sh (devaudit-installer#1080).
#
# Builds a throwaway git repo per case with a pending release ticket and evidence/plan files,
# stubs scripts/upload-evidence.sh to record its arguments, runs the real script and asserts on
# which implementation plans were uploaded. Hermetic: mktemp'd directories, no network
# (the audit-log export points at a closed local port and only warns).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/upload-compliance-documents.sh"

PASS=0
FAIL=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

# fixture <dir> <req> <evidence-has-plan: yes|no> <plans-has-plan: yes|no>
fixture() {
  local dir="$1" req="$2" in_evidence="$3" in_plans="$4"
  rm -rf "$dir"
  mkdir -p "$dir/scripts" "$dir/compliance/pending-releases" "$dir/compliance/evidence/$req" "$dir/compliance/plans/$req"
  cd "$dir"
  git init -q --initial-branch=main
  git config user.email "test@example.com"
  git config user.name "test"
  printf '# Release ticket %s\n' "$req" > "compliance/pending-releases/RELEASE-TICKET-$req.md"
  printf '# scope\n' > "compliance/evidence/$req/test-scope.md"
  if [ "$in_evidence" = yes ]; then printf '# plan (evidence copy)\n' > "compliance/evidence/$req/implementation-plan.md"; fi
  if [ "$in_plans" = yes ]; then printf '# plan (plans copy)\n' > "compliance/plans/$req/implementation-plan.md"; fi
  # a plan for a requirement that is not in this release must never be uploaded
  mkdir -p compliance/plans/REQ-999
  printf '# other\n' > compliance/plans/REQ-999/implementation-plan.md
  cat > scripts/upload-evidence.sh <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$UPLOAD_LOG"
EOF
  printf '#!/usr/bin/env bash\necho "$1"\n' > scripts/resolve-bundle-release.sh
  git add -A
  git commit -q -m "feat: [$req] change

Ref: $req"
}

# run <dir> -> prints the recorded uploads, one per line
run() {
  local dir="$1"
  cd "$dir"
  : > "$dir/upload.log"
  UPLOAD_LOG="$dir/upload.log" \
    DEVAUDIT_PROJECT_SLUG=fixture DEVAUDIT_GIT_SHA="$(git rev-parse HEAD)" DEVAUDIT_CI_RUN_ID=1 \
    DEVAUDIT_BRANCH=develop DEVAUDIT_RELEASE_VERSION=REQ-1 DEVAUDIT_BASE_URL=http://127.0.0.1:9 DEVAUDIT_API_KEY=k \
    bash "$HELPER" > "$dir/out.log" 2>&1 || true
  cat "$dir/upload.log"
}

plan_uploads() { grep -E ' implementation_plan ' || true; }

echo "plan only under compliance/plans (the LOW-risk case)"
D1="$WORK/c1"
fixture "$D1" REQ-1 no yes
OUT1="$(run "$D1" | plan_uploads)"
assert_eq "uploaded once" "1" "$(printf '%s\n' "$OUT1" | grep -c implementation_plan)"
assert_eq "from compliance/plans" "1" "$(printf '%s\n' "$OUT1" | grep -c 'compliance/plans/REQ-1/implementation-plan.md')"
assert_eq "filed as planning evidence for the requirement" "1" "$(printf '%s\n' "$OUT1" | grep -c 'fixture REQ-1 implementation_plan .* --category planning')"

echo "a copy in the evidence folder wins and is uploaded once"
D2="$WORK/c2"
fixture "$D2" REQ-1 yes yes
OUT2="$(run "$D2" | plan_uploads)"
assert_eq "uploaded once" "1" "$(printf '%s\n' "$OUT2" | grep -c implementation_plan)"
assert_eq "from the evidence folder" "1" "$(printf '%s\n' "$OUT2" | grep -c 'compliance/evidence/REQ-1/implementation-plan.md')"
assert_eq "not also from compliance/plans" "0" "$(printf '%s\n' "$OUT2" | grep -c 'compliance/plans/')"

echo "no plan anywhere: nothing uploaded, no error"
D3="$WORK/c3"
fixture "$D3" REQ-1 no no
OUT3="$(run "$D3" | plan_uploads)"
assert_eq "no implementation_plan upload" "0" "$(printf '%s' "$OUT3" | grep -c implementation_plan || true)"
assert_eq "the other evidence still uploads" "1" "$(run "$D3" | grep -c 'test_scope')"

echo "a plan for a requirement outside the release is never uploaded"
assert_eq "REQ-999 plan not uploaded" "0" "$(run "$D1" | grep -c 'REQ-999')"

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
