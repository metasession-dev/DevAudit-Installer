# DevAudit on DevAudit: self-governance onboarding plan

**Status:** Proposed implementation plan
**Scope:** DevAudit-Installer (this repo) and `devaudit` (the portal, `metasession-dev/devaudit`); a new self-hosted audit instance at `audit.devaudit.ai`
**Audience:** Engineering, release reviewers, and prospective enterprise customers or auditors reviewing DevAudit's own compliance posture
**Tracked:** devaudit-installer#917 (parent strategy issue, §5), devaudit-installer#932 (pre-release validation gate this plan reuses), devaudit-installer#941 (mocked-portal SDLC-lifecycle smoke test this plan requires)

## Purpose

DevAudit sells evidence-backed SDLC compliance tooling to other engineering teams, but as of this writing neither of its own two repositories runs that tooling on itself — the portal's own `CLAUDE.md` says so explicitly, and this repo's README has historically treated "CI green" as the entire merge bar. That gap is not cosmetic. It has three concrete consequences:

1. **It is an enterprise sales blocker.** Vendor security questionnaires and SOC 2 report requests are a standard part of any enterprise deal, and a compliance vendor that cannot produce its own evidence trail fails that review before the conversation starts.
2. **It is a genuine processor obligation, not just marketing.** The portal stores customer audit evidence, handles authentication/MFA, and touches Stripe billing. As a GDPR data processor it needs its own Record of Processing Activities (ROPA) and Data Protection Impact Assessment (DPIA) regardless of whether DevAudit ever markets its own compliance posture.
3. **It is the only way DevAudit's own team will feel the product's friction first** — process weight, missing stack/host adapters, the free-tier two-admin limit — before a paying customer does.

This document describes **what we are building, why, and the exact sequence of steps to get there**, including the testing work required both before and after onboarding. It supersedes nothing in devaudit-installer#917 — it is the executable plan for §5 of that issue, with the three previously-open decisions now resolved (see §2 below) and turned into concrete, ordered work.

**Honest limit, stated up front:** this plan gets DevAudit evidence-backed SDLC/change-management controls over its own two repositories. It does **not** by itself constitute SOC 2 or ISO 27001 certification — those additionally require company-level controls (HR, device management, vendor management, access reviews), a contracted external auditor, and for SOC 2 Type II, an observation window. This plan is the prerequisite, not the certification itself.

## 1. What we are doing

We are running DevAudit's own SDLC process — tracked requirements, staged evidence, four-eyes release approval, close-out — against DevAudit's own two repositories, using DevAudit's own product, exactly as a customer would.

To do this without the circular-trust problems described in §3, we are standing up a **second, self-hosted instance of the portal application**, used exclusively for DevAudit's own governance:

- **Domain:** `audit.devaudit.ai` — a subdomain of the existing production domain. Chosen over a fully separate domain (cheaper to provision, reuses existing DNS/cert infrastructure) and over an internal-only deployment (a subdomain can be shown to a prospect or auditor as a live trust artifact, which an internal-only instance cannot).
- **Version policy: N-1.** The audit instance always runs the **previously released** version of the portal, never the version currently on `main`. This is the direct fix for the "portal approves its own releases" loop (§3, Loop 2): a PR changing the portal's own approval logic is reviewed and approved under the *old*, already-proven rules on the audit instance, not the new rules it is trying to introduce. The new logic only begins governing approvals once the PR has shipped **and** the audit instance itself has been deliberately upgraded to the new release.
- **Tenants:** two projects, onboarded in sequence — the portal repository first, then this Installer repository (rationale in §4).
- **Admins:** at minimum two named human approvers on the audit instance, satisfying the four-eyes requirement (§3, Loop 4). One has been named (see §2); the first/existing approver's identity should be confirmed and recorded here before Phase 1's UAT gate goes live.

This is a separate, additional deployment. Production `devaudit.ai` is unaffected and continues serving customers normally throughout.

## 2. Decisions

Three decisions were identified as blocking in devaudit-installer#917 as open items. Status:

| Decision | Resolution |
|---|---|
| Where the audit instance lives | **Resolved.** Self-hosted, subdomain `audit.devaudit.ai`, pinned to N-1. |
| Who the second human approver is | **Resolved.** William (this document's requester). The existing/first approver's identity still needs confirming and recording here before Phase 1 begins. |
| Whether to open the framework clause registry | **Not resolved, not blocking.** This is a separate question tied to devaudit-installer#917 §3 (the `devaudit scan` adoption wedge), independent of this onboarding track. Tracked separately. |

## 3. The self-referential trust problem

A compliance tool governing its own development creates four distinct loops where the system under test and the system doing the testing are the same system. Each has a specific, already-designed mitigation; this plan exists to execute them, not to re-derive them.

| # | Loop | Risk if unmitigated | Mitigation |
|---|---|---|---|
| 1 | **Installer gates govern changes to themselves.** | A PR that weakens a CI gate is checked by the weakened gate; a broken gate can block its own fix. | **Bootstrap from the last release**, exactly like a compiler bootstrapping from the previous binary: this repo syncs itself from the last *published npm version* (`npx @metasession.co/devaudit-cli@<last-release> update`), never from its own working tree. A gate change is reviewed under old rules and only takes effect after it ships and is pulled back in. |
| 2 | **The portal approves its own releases.** | A release that breaks the approval flow could lock itself out, or worse, silently self-approve; evidence held in a system currently under change is not credible to an auditor. | **Separate, N-1-pinned, self-hosted audit instance** (§1) with distinct admins from production. A documented break-glass procedure (named person, signed manual approval, incident record) covers the case where the audit instance itself is unavailable. |
| 3 | **Changes to rules/scoring.** | Editing `lib/config/frameworks/*`, approval logic, evidence contracts, or authz rules silently redefines what "compliant" means for every customer, not just DevAudit. | **Auto-classify HIGH risk via CODEOWNERS** on those paths: mandatory ADR, threat model, four-eyes UAT, and a customer-visible changelog entry before merge. |
| 4 | **Four-eyes needs two humans.** | The SDLC framework assumes one owner-developer plus AI agents; an AI cannot be the second approver by design — the whole point of four-eyes is a second human signature. | **Name ≥2 human admins** for DevAudit's own project on the audit instance (§2). If the team is genuinely one person at any point, use an external reviewer or advisor as the second signature rather than relaxing the control. |

**Also in scope:** both repositories currently run `auto-merge.yml`, which conflicts with required release approval. It must be restricted to housekeeping/dependency-bot PRs (the untracked path) — or removed — before Phase 0 is considered complete.

## 4. Implementation plan

Portal before Installer, per the existing rationale in devaudit-installer#917 §5: the portal is the higher-risk system (holds customer data, in SOC 2 scope by virtue of what it stores) and getting it onboarded first produces the trust-page/badge marketing value earliest.

### Phase 0 — Groundwork and decisions (target: Week 0–1)

- [x] Decide audit-instance location and version policy — self-hosted, `audit.devaudit.ai`, pinned N-1.
- [x] Name the second human approver — William.
- [ ] Confirm and record the first/existing human approver's identity.
- [ ] Restrict `auto-merge.yml` on both repositories to housekeeping/dependency-bot PRs only (or remove it).
- [ ] Provision the `audit.devaudit.ai` subdomain: DNS record, TLS certificate, hosting target (the portal is already Node + Prisma + Railway, per devaudit-installer#917 §1 — reuse that stack for consistency rather than introducing a new host).
- [ ] Obtain a self-host licence JWT for the portal (the portal already supports self-hosting via a signed licence JWT, per devaudit-installer#917 §1's repo-comparison table — this is an existing capability being used for a new purpose, not new product work).
- [ ] Stand up the self-hosted portal instance at `audit.devaudit.ai`, pinned to the last published release (N-1 at time of first deploy), with its own database — fully isolated from production `devaudit.ai`.
- [ ] Create the two named admin accounts on the audit instance.
- [ ] Define and document the break-glass procedure for Loop 2 (§3): named person, signed manual approval, mandatory incident record on every use.
- [ ] Set up CODEOWNERS-based HIGH-risk classification (Loop 3, §3) on both repositories, scoped initially to the paths named in devaudit-installer#917 §5 (`lib/config/frameworks/*`, approval logic, evidence contracts, authz rules on the portal side; the sync-pipeline and gate-template paths on the Installer side — enumerated precisely in Phase 2).

### Phase 1 — Onboard the portal project (target: Week 1–2)

- [ ] `devaudit install` the portal repository, using the pinned-released CLI, targeting the audit instance as its backing project (not production).
- [ ] Author Tier-1/2 governance documents: processor ROPA, DPIA, AI-use disclosure, incident response plan, periodic review schedule — per devaudit-installer#917 §5's rollout item 2.
- [ ] Backfill the portal's existing `docs/SRS.md` and ADRs into the RTM the audit instance now tracks, so historical decisions aren't orphaned from the new evidence trail.
- [ ] Walk one real tracked requirement through all five stages against the audit instance, following the worked example already designed in devaudit-installer#917 §5 ("REQ-2xx — Remote MCP connector (read-only)"): plan → implement & test → compile evidence → submit for review (two-human UAT approval on the audit instance) → deploy. Use this as the template and acceptance proof that the portal's onboarding is functionally complete, not just configured.

### Phase 2 — Onboard the Installer project (target: Week 2–3)

- [ ] Build the npm-package host adapter described in devaudit-installer#917 §5: deploy = `npm publish`; production smoke = `npx @metasession.co/devaudit-cli@<version> --version` plus a `scan` against a fixture repo (the `release-devaudit` skill already performs part of this verification and should be extended, not duplicated).
- [ ] `devaudit install` this repository against the audit instance, pinned to the N-1 released CLI — directly exercising Loop 1's bootstrap-from-last-release mitigation (§3) for the first time on this repo's own releases.
- [ ] Extend the CODEOWNERS HIGH-risk classification from Phase 0 to the sync-pipeline and gate-template paths: `cli/src/update/*.ts`, `sdlc/files/**/*.yml.template`, `sdlc/files/_common/skills/sdlc-implementer/`, and any path that changes what a generated gate workflow does.
- [ ] Walk one real tracked requirement through all five stages, following the second worked example in devaudit-installer#917 §5 (a PR editing a gate, e.g. `compliance-validation.yml.template`) — specifically to prove out the asymmetry that example calls out: a gate-editing PR is reviewed under the *old* gate, ships in a release, and only then reaches this repo's own working tree via a separate `update` PR, which the new rule never itself gated.

### Phase 3 — Testing: proving the self-governance loop actually holds (ongoing, every release, not a one-time milestone)

This is where devaudit-installer#932's already-built methodology and devaudit-installer#941's proposed work fit together — Phase 1 and 2 only matter if they're continuously, automatically verified, not asserted once and left alone.

**3a. Cloned-consumer pre-release validation gate** (already built — devaudit-installer#932, documented permanently in devaudit-installer#917 §5 "The Installer's own E2E gate")

Once this repository is itself a consumer syncing from the audit instance's tracked flow, any change to the sync pipeline still has to pass the existing gate before promotion to `main`, exactly as it does today:

1. Clone every active consumer (never the real working checkouts) into a scratch directory; `npm install` each clone so its own tooling is genuinely present.
2. Build the candidate release and run it directly against each cloned consumer.
3. Inspect, don't just check the exit code: diff every changed file, confirm generated YAML is valid with no duplicate keys, run the consumer's own `devaudit doctor`.
4. Re-run once more immediately — a second `update` must report no new conflicts (idempotency).
5. Escalate anything a fixture wouldn't have caught back into the permanent fixture test suite.

No new work is required here; this phase just confirms the existing gate continues to run before any release that could touch this repo's own onboarded sync behaviour.

**3b. Mocked-portal SDLC-lifecycle smoke test** (proposed, not yet built — devaudit-installer#941)

3a proves sync mechanics; it says nothing about whether this repo's generated release-gate and close-out workflows correctly drive a project through the portal interaction points — which is precisely what Phase 1/2's worked examples depend on working correctly, every release, not just the one time they were manually walked through. Before Phase 3c can be trusted as a real signal, devaudit-installer#941 needs to be built:

1. Stand up a disposable tracer-consumer fixture; `devaudit install` it against the release candidate.
2. Author one trivial tracked requirement; drive it through the SDLC stage *scripts* (not the interactive skill — the skill requires a human in the loop by design and must stay that way).
3. Extend the existing `msw` mocking pattern already used in `cli/test/fleet.test.ts`/`install.test.ts`/`join.test.ts` to the `check-release-approval.yml.template` and `close-out-release.yml.template` portal endpoints. Script the mock to walk `draft → uat_review → uat_approved` and fire a simulated `release-closed` dispatch.
4. Assert the generated gate logic correctly blocks/proceeds on each portal state, and the generated close-out logic correctly performs merge-back, ticket/RTM reconciliation, and status reporting.

**This never creates a real UAT approval or a real "released" transition on behalf of a human** — it proves the generated plumbing is correct in a test harness, exactly as devaudit-installer#941 specifies. The actual human approval click on the real audit instance (Phase 3c) stays exactly as manual as it is today; this is a deliberate compliance control, not a gap to automate away.

**3c. Live validation against the real audit instance**

Once Phases 1 and 2 are onboarded, every tracked requirement on either repository flows through the real `audit.devaudit.ai` instance: plan approval, UAT approval by the two named human admins, and release close-out. This is the authoritative signal that self-governance is actually working day to day. 3a and 3b are the automated pre-flight checks that catch a regression in the sync pipeline or the generated workflow logic *before* it ever reaches this real, human-gated, N-1-pinned flow.

**3d. Acceptance criteria — what "this is working" means**

- A tracked requirement on the portal completes all five stages against the audit instance, with evidence captured at every stage (Phase 1's worked example, repeated as a standing capability, not a one-off).
- A tracked requirement on this repository does the same, pinned to the N-1 CLI (Phase 2's worked example, repeated as a standing capability).
- A deliberately introduced regression in a generated gate or close-out workflow is caught by 3b before it could reach 3c.
- The cloned-consumer gate (3a) passes before any sync-pipeline-touching change is promoted to `main`.

### Phase 4 — Publish and sustain (target: Week 3+)

- [ ] Publish the "DevAudit on DevAudit" trust page: live coverage badge plus an auditor share-link request path, per devaudit-installer#917 §5 rollout item 4.
- [ ] Add both repositories to the existing `fleet-doctor` sweep.
- [ ] Establish a periodic review cadence for the governance documents produced in Phase 1 (ROPA, DPIA, incident response plan) — these are living documents, not one-time deliverables.
- [ ] Revisit SOC 2 Type I readiness once Phases 1–3 have run for at least one full release cycle on each repository; Type II requires a sustained observation window on top of that, per the honest-limit note in the Purpose section.

## 5. Risks and open items

- **Self-host licence JWT acquisition process and cost are unconfirmed** — needs owner follow-up before Phase 0 can complete.
- **Hosting ownership of `audit.devaudit.ai`** — who operates and pays for it (same team as production, or a separate arrangement) needs to be settled alongside provisioning.
- **Sustained two-approver requirement** — if the team is genuinely one person at any point, §3 Loop 4's fallback (an external reviewer/advisor as the second signature) needs an actual named candidate before it's more than a policy statement.
- **Framework clause registry exposure** (§2) is explicitly out of scope for this plan but tracked in devaudit-installer#917 §3 — revisit independently.
- **devaudit-installer#941 is unstarted.** Phase 3c's trustworthiness as a signal depends on 3b existing; until #941 is built, Phase 1/2's worked examples are the only verification of the portal-interaction workflows, which is a one-time manual check, not a continuous one.

## 6. References

- devaudit-installer#917 — parent strategy issue; §5 is the source of the self-referential-loops table, both worked examples, and the original rollout outline this plan executes.
- devaudit-installer#932 — sync-safety umbrella; origin of the cloned-consumer pre-release validation gate reused in Phase 3a.
- devaudit-installer#941 — mocked-portal SDLC-lifecycle smoke test; required before Phase 3c can be treated as a trustworthy continuous signal, per Phase 3b.
- `docs/SRS.md` (Appendix) — documents the broader E2E-testing gap this plan's Phase 3 partially closes.
- `docs/release-lineage-and-test-execution-audit-model.md` — the audit-instance's evidence and release-lineage model this plan's tracked requirements will be recorded under.
