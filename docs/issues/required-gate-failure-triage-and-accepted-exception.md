# Required-gate failure triage and accepted exceptions

> **Historical design record.** The proposal is tracked in devaudit-installer#1016 (E2E) and #1017 (dependency audit); the decision is [ADR-003](../ADR/ADR-003-required-gate-failure-acceptance.md). For current behaviour read `sdlc/files/_common/scripts/validate-test-summary.sh`, `report-test-execution.sh`, `validate-risk-acceptance-record.sh` and `sdlc/files/_common/skills/sdlc-implementer/SKILL.md` (Phase 4 step 5a), not this file.

Observed on wawagardenbar-app REQ-109 / release PR #906: a required E2E check failed on the release PR, a re-run on the same SHA passed, and the test-execution summary read PASS. The failure surfaced at portal UAT approval about two weeks later; the triage lived in a PR comment and an unmerged branch.

Gaps: no release-PR-time triage gate; the summary can claim PASS with failures; no summary-to-CI reconciliation; "accept" under-specified; triage not recorded in the portal; no way to record triage without moving the release head; no early notice. Resolved by the fix-or-accept gate, the accepted-exception record, portal-direct `resolve`, summary integrity checks, watcher escalation and the `accepted-exceptions` doctor check.
