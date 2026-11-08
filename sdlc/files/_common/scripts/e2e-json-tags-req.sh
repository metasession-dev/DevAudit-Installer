#!/usr/bin/env bash
# e2e-json-tags-req.sh — does a Playwright JSON report hold an executed test
# tagged to a requirement? (devaudit-installer#435; shared by ci.yml and
# compliance-evidence.yml since #1213.)
#
# A test counts when its title, its suite ancestry, or one of its
# annotations/tags names <REQ-XXX>, and at least one of its results ran (not
# `skipped` or `interrupted`). The match is a substring match, as it has been
# since #435.
#
# Usage:   scripts/e2e-json-tags-req.sh <REQ-XXX> <results.json>
# Exit:    0 when tagged and executed; 1 when not, or when the file cannot be
#          read; 2 on a usage error.
#
# Install: cp this file to your project's scripts/ directory && chmod +x scripts/e2e-json-tags-req.sh

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <REQ-XXX> <results.json>" >&2
  exit 2
fi
[ -f "$2" ] || exit 1

python3 - "$1" "$2" <<'PY'
import json, re, sys

req_id, filename = sys.argv[1:]
def values(value):
  if isinstance(value, str): return [value]
  if isinstance(value, dict): return [str(value.get('type', '')), str(value.get('description', ''))]
  return []
def tagged(node, ancestry):
  text = [*ancestry, str(node.get('title', ''))]
  for field in ('annotations', 'tags'):
    for value in node.get(field, []): text.extend(values(value))
  return any(req_id in value for value in text)
def executed(test):
  return any(result.get('status') not in {'skipped', 'interrupted'} for result in test.get('results', []))
def contains(node, ancestry):
  title = str(node.get('title', ''))
  path = [*ancestry, title] if title else ancestry
  for spec in node.get('specs', []):
    if tagged(spec, path) and any(executed(test) for test in spec.get('tests', [])): return True
  for test in node.get('tests', []):
    if tagged(test, path) and executed(test): return True
  return any(contains(suite, path) for suite in node.get('suites', []))
try:
  with open(filename, encoding='utf-8') as handle:
    report = json.load(handle)
except Exception:
  raise SystemExit(1)
raise SystemExit(0 if re.fullmatch(r'REQ-[A-Z0-9-]+', req_id) and contains(report, []) else 1)
PY
