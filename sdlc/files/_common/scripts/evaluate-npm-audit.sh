#!/usr/bin/env bash
# evaluate-npm-audit.sh -- evaluate npm audit high/critical advisories against
# narrowly governed, repository-owned temporary risk acceptances.
#
# The helper intentionally owns both decision logic and machine-readable output.
# Workflow templates must not parse its human log output or convert evaluation
# failures into successful "unknown" results.

set -euo pipefail

AUDIT_PATH="dependency-audit.json"
LOCK_PATH="package-lock.json"
EXCEPTIONS_PATH="compliance/security/accepted-vulnerabilities.json"
OUTPUT_PATH="dependency-risk-evaluation.json"

usage() {
  echo "Usage: $0 [--audit <path>] [--lock <path>] [--exceptions <path>] [--output <path>]" >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --audit) AUDIT_PATH="${2:-}"; shift 2 ;;
    --lock) LOCK_PATH="${2:-}"; shift 2 ;;
    --exceptions) EXCEPTIONS_PATH="${2:-}"; shift 2 ;;
    --output) OUTPUT_PATH="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Error: unknown argument: $1" >&2; usage ;;
  esac
done

for required_path in "$AUDIT_PATH" "$LOCK_PATH"; do
  [ -n "$required_path" ] && [ -f "$required_path" ] || {
    echo "Error: required input is missing: ${required_path:-<empty>}" >&2
    exit 2
  }
done

python3 - "$AUDIT_PATH" "$LOCK_PATH" "$EXCEPTIONS_PATH" "$OUTPUT_PATH" <<'PY'
import json
import os
import sys
from datetime import date

audit_path, lock_path, exceptions_path, output_path = sys.argv[1:]


def fail(message):
    print(f"Dependency-risk evaluation error: {message}", file=sys.stderr)
    raise SystemExit(2)


def load_json(path, label):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read {label} {path}: {error}")


def package_name_from_path(path):
    marker = "node_modules/"
    if marker not in path:
        fail(f"package-lock node path is not a node_modules path: {path}")
    tail = path.rsplit(marker, 1)[1]
    parts = tail.split("/")
    if not parts or not parts[0]:
        fail(f"cannot derive package name from node path: {path}")
    return "/".join(parts[:2]) if parts[0].startswith("@") else parts[0]


def introducer_for(node_path, packages):
    parent_marker = "/node_modules/"
    if parent_marker not in node_path:
        return "direct"
    parent_path = node_path.rsplit(parent_marker, 1)[0]
    parent = packages.get(parent_path)
    if not isinstance(parent, dict) or not isinstance(parent.get("version"), str):
        fail(f"cannot resolve introducing dependency for {node_path}")
    return f"{package_name_from_path(parent_path)}@{parent['version']}"


def advisory_id(advisory):
    url = advisory.get("url")
    if not isinstance(url, str) or "/" not in url:
        fail("high/critical audit advisory is missing a URL")
    value = url.rsplit("/", 1)[-1]
    if not value:
        fail("high/critical audit advisory has an empty advisory ID")
    return value


def valid_date(value, field, index):
    if not isinstance(value, str):
        fail(f"exception {index} has no valid {field}")
    try:
        return date.fromisoformat(value)
    except ValueError:
        fail(f"exception {index} has invalid {field}: {value}")


audit = load_json(audit_path, "npm audit JSON")
lock = load_json(lock_path, "package-lock JSON")
if not isinstance(audit, dict) or not isinstance(audit.get("vulnerabilities"), dict):
    fail("npm audit JSON must contain a vulnerabilities object")
if not isinstance(lock, dict) or not isinstance(lock.get("packages"), dict):
    fail("package-lock JSON must contain a packages object")

if os.path.exists(exceptions_path):
    exception_document = load_json(exceptions_path, "risk acceptance JSON")
    if not isinstance(exception_document, dict) or exception_document.get("schemaVersion") != 1:
        fail("risk acceptance JSON must be an object with schemaVersion 1")
    exceptions = exception_document.get("exceptions")
    if not isinstance(exceptions, list):
        fail("risk acceptance JSON must contain an exceptions array")
else:
    exceptions = []

required_fields = (
    "advisoryId",
    "package",
    "vulnerableRange",
    "vulnerableVersion",
    "dependencyPath",
    "introducedBy",
    "approvedAt",
    "expiresAt",
    "approvedBy",
    "reason",
    "remediationIssue",
)
today = date.today()
validated_exceptions = []
seen_exception_keys = set()
for index, item in enumerate(exceptions, start=1):
    if not isinstance(item, dict):
        fail(f"exception {index} must be an object")
    missing = [field for field in required_fields if not isinstance(item.get(field), str) or not item[field].strip()]
    if missing:
        fail(f"exception {index} is missing required field(s): {', '.join(missing)}")
    approved_at = valid_date(item["approvedAt"], "approvedAt", index)
    expires_at = valid_date(item["expiresAt"], "expiresAt", index)
    if approved_at > today:
        fail(f"exception {index} approvedAt cannot be in the future")
    if expires_at <= today:
        fail(f"exception {index} is expired on {item['expiresAt']}")
    if not item["remediationIssue"].startswith("https://github.com/"):
        fail(f"exception {index} remediationIssue must be a GitHub issue URL")
    key = (item["advisoryId"], item["dependencyPath"])
    if key in seen_exception_keys:
        fail(f"duplicate exception for {item['advisoryId']} at {item['dependencyPath']}")
    seen_exception_keys.add(key)
    validated_exceptions.append(item)

packages = lock["packages"]
accepted = []
unresolved = []
seen_advisories = set()

for finding_name, finding in audit["vulnerabilities"].items():
    if not isinstance(finding, dict):
        fail(f"audit vulnerability {finding_name} must be an object")
    via = finding.get("via", [])
    if not isinstance(via, list):
        fail(f"audit vulnerability {finding_name} has invalid via data")
    advisory_objects = [
        item for item in via
        if isinstance(item, dict) and item.get("severity") in ("high", "critical")
    ]
    if finding.get("severity") in ("high", "critical") and not advisory_objects:
        fail(f"high/critical audit vulnerability {finding_name} has no resolvable advisory object")

    nodes = finding.get("nodes", [])
    if advisory_objects and (not isinstance(nodes, list) or not nodes):
        fail(f"audit vulnerability {finding_name} has no installed package-lock node")

    for advisory in advisory_objects:
        package = advisory.get("dependency") or finding_name
        advisory_range = advisory.get("range")
        if not isinstance(package, str) or not package:
            fail(f"advisory in {finding_name} has no package name")
        if not isinstance(advisory_range, str) or not advisory_range:
            fail(f"advisory {advisory_id(advisory)} has no vulnerable range")
        identifier = advisory_id(advisory)
        for node_path in nodes:
            if not isinstance(node_path, str):
                fail(f"advisory {identifier} has invalid package-lock node")
            node = packages.get(node_path)
            if not isinstance(node, dict) or not isinstance(node.get("version"), str):
                fail(f"cannot resolve installed version for {node_path}")
            if package_name_from_path(node_path) != package:
                fail(f"audit package {package} does not match package-lock node {node_path}")
            version = node["version"]
            introduced_by = introducer_for(node_path, packages)
            decision_key = (identifier, node_path)
            if decision_key in seen_advisories:
                continue
            seen_advisories.add(decision_key)
            context = {
                "advisoryId": identifier,
                "severity": advisory["severity"],
                "package": package,
                "vulnerableRange": advisory_range,
                "vulnerableVersion": version,
                "dependencyPath": node_path,
                "introducedBy": introduced_by,
            }
            match = next((item for item in validated_exceptions if all(
                item[field] == context[field]
                for field in ("advisoryId", "package", "vulnerableRange", "vulnerableVersion", "dependencyPath", "introducedBy")
            )), None)
            if match is None:
                unresolved.append(context)
                print(
                    f"Unaccepted {context['severity']} risk: {identifier} "
                    f"({package}@{version} at {node_path})",
                    file=sys.stderr,
                )
            else:
                accepted.append({**context, "acceptance": {
                    field: match[field]
                    for field in ("approvedAt", "expiresAt", "approvedBy", "reason", "remediationIssue")
                }})
                print(
                    f"Accepted temporary risk: {identifier} ({package}@{version}) "
                    f"until {match['expiresAt']} by {match['approvedBy']}; "
                    f"remediation {match['remediationIssue']}",
                )

result = {
    "schemaVersion": 1,
    "auditFile": audit_path,
    "lockFile": lock_path,
    "accepted": accepted,
    "unresolved": unresolved,
    "summary": {
        "accepted": len(accepted),
        "unresolved": len(unresolved),
    },
}
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
    handle.write("\n")

print(f"Dependency risk evaluation: {len(accepted)} accepted, {len(unresolved)} unresolved.")
raise SystemExit(1 if unresolved else 0)
PY
