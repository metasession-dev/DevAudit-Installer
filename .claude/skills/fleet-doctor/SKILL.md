---
name: fleet-doctor
description: Operator-only. Metasession's own automated fleet audit, built on `devaudit doctor --fleet` (any DevAudit account's self-service read-only sweep) plus write actions specific to Metasession's fleet -- classify each finding as a framework/portal defect (raise upstream) or consumer-specific drift (fix in place -- hotfix if release-blocking, Lightweight-path housekeeping otherwise, or deferred into the consumer's next tracked REQ bundle). Never synced to consumers -- lives only in DevAudit-Installer's own .claude/skills/. Trigger phrases -- "run fleet doctor", "audit all consumers", "check onboarded projects for drift".
tags: [operator, fleet, audit, devaudit-installer]
---

# Fleet doctor

A fleet-wide sweep across every onboarded DevAudit consumer, for the operator working from a `DevAudit-Installer` checkout with sibling consumer repos on disk. Unlike the six per-consumer skills (`sdlc-implementer`, `e2e-test-engineer`, `governance-doc-author`, `requirements-aligner`, `adr-author`, `risk-register-keeper` — see [`docs/skills.md`](../../../docs/skills.md)), which run from inside one consumer with no visibility into siblings, this skill runs from *this* repo and needs visibility across every consumer plus the two framework repos (`devaudit`, `DevAudit-Installer`) it might file issues against.

**This skill is never synced into a consumer.** It lives under `DevAudit-Installer/.claude/skills/`, not `sdlc/files/_common/skills/` (the synced-template pool) — that's what keeps it out of `devaudit update`'s wholesale skill sync.

## Relationship to `sdlc-implementer`

Not "called by" `sdlc-implementer` in the direction that might be assumed — the dependency runs the other way, plus one advisory nudge:

- **`fleet-doctor` calls into** each flagged consumer's own `sdlc-implementer` (its existing Lightweight path) to apply a fix. It does not reinvent "how do I merge a housekeeping change" — it reuses the mechanism that already exists and is already tested.
- **`sdlc-implementer`'s Phase 0 step 0** (per-project template-staleness self-heal) suggests the operator run `fleet-doctor` when what it finds looks systemic rather than "just behind" — advisory only, never a hard dependency, so a single-issue run never pays the cost of auditing every other consumer.

## What this skill never does

- Never edits framework code in `devaudit` or `DevAudit-Installer` directly — a framework-origin finding is raised as an issue, not patched here.
- Never merges a fix without going through an existing, already-guarded path (hotfix/back-merge, or `sdlc-implementer`'s Lightweight path) — no new merge mechanism.
- Never invents a second bundling mechanism — a deferred fix rides the existing `Bundles: #A, #B` declaration.
- Never takes a write action against a repo whose owner doesn't match the expected org — see Phase 3.5.

## Phases

### 1. Discover + 2. Per-consumer check

Both steps are now one command (devaudit-installer#861) — run from this repo with Metasession's own operator `DEVAUDIT_USER_TOKEN` set:

```bash
devaudit doctor --fleet --json
```

(or `npx @metasession.co/devaudit-cli@latest doctor --fleet --json` if not globally installed). This discovers every project the operator token's account can see on the portal (org membership / access grants — enforced portal-side, not by this command), resolves each to a local sibling checkout (`../<repo-name>`, skipped and noted — not failed — if not present on disk), and runs `devaudit doctor --json` against each one found. The result is the same structured per-consumer report as before — tool preflight, release close-out drift, onboarding-checklist checks — each still tagged with a first-pass `suspectedOrigin: 'framework' | 'consumer-drift' | 'unknown'` (devaudit-installer#867), aggregated across every consumer. `docs/consuming-projects.md`'s Active consumers table is no longer what this step reads — it's a human-readable reference now, not the discovery source. Collect every non-`unknown`, non-`ok` finding across all consumers before moving to classification — don't act consumer-by-consumer, since cross-consumer comparison is exactly what step 3 needs.

### 3. Classify

For each finding, confirm or override `suspectedOrigin` using judgment, not just the tool's tag:

- **The same anomaly on every (or most) consumers** → almost certainly `framework` — a template, skill, CLI, or portal defect, not something any one operator did.
- **One consumer diverging from what every sibling has** (a file present everywhere else, a secret every sibling has that this one lacks, a stale `devaudit_synced_version` while siblings are current) → `consumer-drift`.
- Before filing anything upstream, search open issues in `devaudit` and `DevAudit-Installer` (`gh issue list --search ...`) to avoid re-filing a duplicate — dedupe onto the existing issue with a comment instead.

### 3.5 Org boundary — required before any write action

Before filing an issue, opening a hotfix branch, or invoking `sdlc-implementer` against any consumer (steps 4-5 below), verify that consumer's repo owner matches the expected org:

```bash
gh repo view <owner>/<repo> --json owner --jq .owner.login
```

Expected org: `metasession-dev`. If the owner doesn't match, **stop for that consumer** — report the mismatch in the run summary (step 6) and take no write action against it. `devaudit doctor --fleet` (step 1+2) is already tenant-isolated at the portal level and is always read-only — this gate only needs to cover steps 4 and 5's write actions, as defense-in-depth against `repo_url` being an unverified string (see `docs/doctor.md`'s `--fleet` section).

### 4. Framework findings → raise, never patch here

File a new issue (or comment on/dedupe onto an existing one) in the owning repo — `devaudit` for portal-side behavior, `DevAudit-Installer` for CLI/template/skill-side behavior. Use the same evidence discipline as any well-scoped bug report: exact repro, which consumers are affected, the suspected file/line if you traced it that far. This skill investigates and reports; it does not edit framework code as part of this run.

### 5. Consumer-drift findings → fix in that consumer

Route by severity, exactly as the operator's own triage would:

- **Release-blocking / actively broken now** — drive it as a `hotfix/<slug>` branch off that consumer's `main`, through the repo's existing hotfix/back-merge machinery (GitFlow branch rules; `hotfix-backmerge.yml` + `INSTALLER_DISPATCH_TOKEN` if configured — see `docs/articles/permissions-and-tokens-reference.md`).
- **Not urgent** — invoke that consumer's own `sdlc-implementer`, routed through its Lightweight path (`chore:`/`docs:`/`ci:`, no `REQ-XXX`, no UAT ceremony) to merge the fix directly.
- **Defer to the next tracked requirement's bundle** — file the fix as a normal tracked-or-housekeeping issue in that consumer's own repo and leave it unassigned. Don't invent a second bundling mechanism: the next real `sdlc-implementer` run against that consumer picks it up via the **existing** `Bundles: #A, #B` declaration (Phase 1 step 4 of `sdlc-implementer`, devaudit-installer#736).

### 6. Report

One run summary, in the same LAST/NEXT sticky-comment style `sdlc-implementer` already uses for a single REQ, scaled to a fleet run:

- Consumers checked (and any skipped because not locally available)
- Clean (no findings)
- Auto-fixed, with PR links
- Filed upstream, with issue links
- Deferred for bundling, with issue links

## Verification before trusting this skill's output

Run it once in a read-only/dry-run posture first — report findings, file nothing, merge nothing — to sanity-check the classification before letting it act for real. `devaudit doctor --fleet` itself is always read-only; the risk is entirely in steps 4–5's write actions, so gating those first is enough.
