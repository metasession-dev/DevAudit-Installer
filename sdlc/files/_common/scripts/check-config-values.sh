#!/usr/bin/env bash
# check-config-values.sh — name the configuration values that reached this job empty (DevAudit-Installer#1160).
#
# GitHub evaluates a `${{ secrets.X }}` or `${{ vars.X }}` that does not exist, or is not visible to the job,
# as an empty string and does not fail. The first symptom is then far from the cause, for example a dev server
# that never starts and a wait that times out. The generated workflows run this script before the dev server
# starts, once per config map, so the failure names the value instead.
#
# Usage:
#   check-config-values.sh '<map>.<ENV_NAME>=<secrets|vars>.<SOURCE_NAME>' ...
#     <map>         the sdlc-config.json map the entry came from (e2e_env, app_env)
#     <ENV_NAME>    the environment variable the job should have
#     <SOURCE_NAME> the secret or variable it is read from
#   Example: check-config-values.sh 'e2e_env.SUPABASE_SECRET_KEY=secrets.SUPABASE_SECRET_KEY'
#
# Exit 0 when every named environment variable is non-empty (or nothing is named); exit 1 otherwise. Only
# names are printed, never a value. An entry that may legitimately be empty is written in the config as
# `${{ secrets.X || '' }}`, which the generator does not pass to this script.

set -uo pipefail

missing=0
summary=()

for spec in "$@"; do
  left="${spec%%=*}"
  source="${spec#*=}"
  [ "$left" != "$spec" ] || { echo "::error::check-config-values.sh: expected <map>.<ENV_NAME>=<secrets|vars>.<NAME>, got '$spec'"; exit 2; }
  map="${left%%.*}"
  name="${left#*.}"
  case "$name" in
    ''|*[!A-Za-z0-9_]*) echo "::error::check-config-values.sh: '$name' is not an environment variable name"; exit 2 ;;
  esac
  [ -z "${!name:-}" ] || continue

  kind="${source%%.*}"
  from="${source#*.}"
  if [ "$kind" = "secrets" ]; then
    what="the secret \`$from\`"
    where="Settings > Secrets and variables > Actions > Repository secrets"
  else
    what="the variable \`$from\`"
    where="Settings > Secrets and variables > Actions > Variables"
  fi
  msg="$map.$name is empty: $what is not visible to this job. It is not defined at repository level (a value that exists only in an environment, a different name, or a fork or Dependabot pull request all read as empty)."
  echo "::error::$msg"
  echo "  fix: define $from under $where in this repository, or correct the name in sdlc-config.json ($map.$name)."
  summary+=("- \`$map.$name\`: $what is empty for this job")
  missing=$((missing + 1))
done

if [ "$missing" -gt 0 ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Configuration values that reached this job empty"
    printf '%s\n' "${summary[@]}"
    echo
    echo "GitHub reads an unknown or invisible \`secrets.X\` / \`vars.X\` as an empty string. Define each at repository level, or fix the name in \`sdlc-config.json\`."
  } >> "$GITHUB_STEP_SUMMARY"
fi

[ "$missing" -eq 0 ]
