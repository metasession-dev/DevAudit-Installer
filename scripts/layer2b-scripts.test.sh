#!/usr/bin/env bash
# Behavioural test of layer2b's scenario_scripts (#1046): a removed script is skipped, a broken one still fails.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0
record() { RESULT="$3|$4"; }
eval "$(awk '/^scenario_scripts\(\)/,/^}/' "$HERE/release-validation/layer2b.sh")"

t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/clone/scripts"
printf '#!/usr/bin/env bash\necho ok\n' > "$t/clone/scripts/good.sh"
printf '#!/usr/bin/env bash\nif then\n' > "$t/clone/scripts/broken.sh"

check() { # <name> <expected-prefix> <paths...>
  local name="$1" want="$2"; shift 2
  printf '%s\n' "$@" > "$t/list"
  scenario_scripts target "$t/clone" "$t/list"
  case "$RESULT" in "$want"*) echo "ok - $name" ;; *) echo "not ok - $name (got: $RESULT)"; fail=1 ;; esac
}

check "removed script is skipped" "PASS|1 changed" scripts/good.sh scripts/gone.sh
check "only removed scripts" "PASS|0 changed" scripts/gone.sh
check "broken script still fails" "FAIL|do not parse: scripts/broken.sh" scripts/good.sh scripts/broken.sh
exit $fail
