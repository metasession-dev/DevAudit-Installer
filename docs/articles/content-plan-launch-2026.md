# DevAudit.ai Soft Launch Content Plan — 2026

> **Purpose:** A soft-launch content plan led by one invitation article, followed by a 38-article series targeting four B2B personas across the buying funnel. Each article is grounded in DevAudit's real SDLC workflows, not generic thought leadership.

---

## Website & repo reference index

All articles should link back to existing pages. Authors must reference the canonical sources below — do not paraphrase when you can link.

### devaudit.ai pages

| Page | URL | Use in articles |
|------|-----|------------------|
| **Homepage** | https://devaudit.ai/ | Hero messaging: "Compliance as a byproduct, not a project." Three audiences (vibe coders, traditional engineers, builders/founders). Live evidence feed example. |
| **The SDLC (manifesto)** | https://devaudit.ai/sdlc | Five stages explained, three pillars (framework + gates + portal), six AI skills, two release shapes (tracked + housekeeping), 3-tier E2E gating, "AI as a first-class contributor", "What DevAudit is not" section. |
| **Standards coverage** | https://devaudit.ai/compliance | Clause-by-clause mapping: ISO 29119, ISO 27001, SOC 2, GDPR, EU AI Act. "One gate, multiple frameworks" concept. |
| **Onboarding** | https://devaudit.ai/onboarding | Three paths in (install / update / join), onboarding form, "The framework adapts; the audit shape doesn't" positioning, open-source-first messaging. |
| **Blog** | https://devaudit.ai/blog | Publication home for all content plan articles. |
| **Sign in** | https://devaudit.ai/auth/sign-in | PAT issuance starting point for tutorials. |
| **Embed widget** | https://devaudit.ai/projects/[slug]/settings/embed | Project-scoped compliance badges iframe. Copy-paste snippet for public websites. Shows SOC 2, ISO 27001, GDPR, EU AI Act badges live from project claims. Three 404 gates for privacy (global kill switch, project existence, publish toggle). |

### GitHub repo pages (metasession-dev/DevAudit-Installer)

| Doc | URL | Use in articles |
|------|-----|------------------|
| **README** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md | CLI commands (`install`/`update`/`join`), agent compatibility table, architecture overview, three-pillar summary. |
| **SDLC framework structure** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/sdlc-framework.md | Template layering: process → stack → host adapters. |
| **Stage 1 — Plan requirement** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/1-plan-requirement.md | Risk classification, RTM entry, implementation plan creation. |
| **Stage 2 — Implement & test** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/2-implement-and-test.md | TDD, E2E delegation, gate execution order. |
| **Stage 3 — Compile evidence** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/3-compile-evidence.md | Evidence artefact shape, upload paths, UAT verification. |
| **Stage 4 — Submit for review** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/4-submit-for-review.md | PR prerequisites, release approval gate. |
| **Stage 5 — Deploy** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/5-deploy-main.md | Merge, post-deploy smoke, production approval. |
| **Implementing an SDLC issue** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/implementing-an-sdlc-issue.md | End-to-end walkthrough (referenced from /sdlc page). |
| **Change workflows** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/change-workflows.md | Tracked vs housekeeping, workflow triage, commit-type taxonomy. |
| **Skills overview** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md | The six AI skills: what each produces. |
| **Compliance gates** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md | Five CI workflows: how each fires, what each owns. |
| **Evidence tiers** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/evidence-tiers.md | Tier 1/2/3 split, operator-upload vs CI-upload. |
| **E2E test tiers** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/e2e-test-tiers.md | Smoke → critical → regression gating model. |
| **Release playbooks** | https://github.com/metasession-dev/DevAudit-Installer/tree/main/docs/release-playbooks | High-risk, low-risk, housekeeping — each written for AI-driven and manual. |
| **Onboarding (detailed)** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/onboarding.md | Full operator walkthrough for `devaudit install`. |
| **Governance templates** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/governance-templates.md | ROPA, DPIA, AI disclosure, incident report, periodic review starters. |
| **Adding a skill** | https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/adding-a-skill.md | Skill authoring contract (for Article 24). |

---

## Website messaging alignment

The website establishes specific language and positioning that articles must reinforce (not contradict):

1. **"Compliance as a byproduct, not a project."** — This is the primary tagline. Every article's conclusion should circle back to this concept: the work you already do IS the audit prep.
2. **Three audiences:** "vibe coders", "traditional engineers", "non-technical founders/builders" — the website uses these terms. Map to our four personas: Lead Developer = vibe coder + traditional engineer; CTO = traditional engineer + builder; CISO/Compliance = builder facing auditors.
3. **"Built for vibe coders"** — the rotating hero text leads with this. Developer content should not be allergic to the term; embrace it as the hook.
4. **"What DevAudit is not"** — six explicit disclaimers on /sdlc. Articles must not overclaim. Specifically:
   - Not a certification (we produce evidence; the auditor decides)
   - Not SAST/SCA (Semgrep/npm audit are gates, not our product)
   - Not a SIEM (lifecycle events only, not infra logs)
   - Not a replacement for code review (we enforce THAT, not QUALITY)
   - Not for one-person side projects (the ceremony has real cost)
   - Not an AI safety product (pair with Guardrails/Lakera for that)
5. **"Adopt in 30 seconds"** — the homepage claims `npx install` in 30 seconds. The onboarding page says the interactive flow is ~5-10 min. Article 9's "15 minutes" title is the end-to-end including first release, which is honest. Ensure consistency.
6. **"One prompt"** — the /sdlc page shows `> Implement issue #N under the SDLC.` as the single-prompt entry point. This is a key developer-facing message.
7. **Open-source-first** — framework + CLI are Apache 2.0. The portal is the paid product. Articles should make this distinction clear: the SDLC is free; the evidence portal that holds the proof is the product.
8. **Five frameworks, one process, shared controls** — from /compliance. A single SAST scan generates evidence for ISO 27001 + SOC 2 + GDPR + EU AI Act simultaneously. This is the efficiency pitch for Compliance Officers.

---

## Content principles

1. **Show the workflow, not the brochure.** Every article references a concrete DevAudit mechanism (a CI gate, a portal screen, a CLI command, a skill invocation). Developers will verify the claims; give them something to verify.
2. **One persona, one pain point, one article.** Cross-persona pieces dilute. Tag each article with its primary persona; secondary personas get a callout box, not co-ownership.
3. **Funnel-aware.** Top-of-funnel (TOFU) = industry problem awareness. Middle (MOFU) = how DevAudit solves it. Bottom (BOFU) = implementation detail, migration guides, pricing justification.
4. **Regulatory citations are specific.** "EU AI Act Art. 11" not "upcoming AI regulation." "SOC 2 CC8.1" not "compliance requirements." The personas we're targeting know the clause numbers.
5. **Real incidents over hypotheticals.** Where possible, reference anonymised versions of real issues (like the REQ-081 scope-creep incident, the missing evidenceShot gap, the merged-branch orphan commit).

---

## First publication: soft launch invitation

Before the broader thought-leadership and workflow series begins, the **first published article** should be a soft-launch invitation that makes the current ask explicit.

### Launch article

| Order | Funnel | Primary persona | Article title | Format |
| --- | --- | --- | --- | --- |
| **Launch-1** | Launch | Multi-persona | Soft Launch: Take DevAudit for a Test Drive | Long-form launch note (1200-1500w) |

### Required message for Launch-1

- state clearly that DevAudit is in **soft launch**
- invite developers, engineering leads, founders, and auditors to try it
- ask contributors to open issues and PRs
- ask auditors/reviewers to report missing evidence, unclear mappings, or release-review gaps
- route readers to the onboarding path, the SDLC overview, and the repo issue tracker

### Canonical source draft

- Long-form: [`docs/articles/soft-launch-test-drive-long-form.md`](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/articles/soft-launch-test-drive-long-form.md)
- Short-form companion: [`docs/articles/soft-launch-test-drive-short-form.md`](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/articles/soft-launch-test-drive-short-form.md)

---

## Persona × funnel matrix

| # | Funnel | Primary persona | Article title | Format |
|---|--------|----------------|---------------|--------|
| **TOFU — Awareness** | | | | |
| 1 | TOFU | CISO | The EU AI Act Hits Code in August 2026: What Your AI Coding Agents Mean for High-Risk Classification | Long-form (2500w) |
| 2 | TOFU | CTO | The Agentic SDLC: Why 2026 Is the Year Software Engineering Gets a New Operating Model | Long-form (2500w) |
| 3 | TOFU | Compliance Officer | SOC 2 in the Age of AI Agents: The Segregation-of-Duties Problem Nobody Solved Yet | Long-form (2000w) |
| 4 | TOFU | Lead Developer | Vibe Coding Broke My CI Pipeline: A Post-Mortem on Unconstrained AI in Production | Narrative post-mortem (2000w) |
| 5 | TOFU | CISO + CTO | 60% of Enterprises Have No AI Governance Framework — Here's What That Actually Costs | Data-driven report (1500w) |
| **MOFU — Consideration** | | | | |
| 6 | MOFU | CISO | Immutable Audit Trails for AI-Generated Code: How DevAudit Closes the SOC 2 Accountability Gap | Solution deep-dive (2000w) |
| 7 | MOFU | CTO | Separating Code from Evidence: How DevAudit Keeps Git Fast While Scaling AI Compliance | Technical architecture piece (2000w) |
| 8 | MOFU | Compliance Officer | From 40 Hours to 4: Automating Evidence Collection from CI/CD for Audit Preparation | ROI case study (1500w) |
| 9 | MOFU | Lead Developer | DevAudit in 15 Minutes: `npx devaudit install` and Your First Compliant Release | Hands-on tutorial (2500w) |
| 10 | MOFU | CTO + Compliance | The Four-Eyes Gate: How DevAudit Enforces Human Approval Without Slowing Down Releases | Workflow walkthrough (1800w) |
| 11 | MOFU | CISO + Compliance | EU AI Act Art. 11 Technical Documentation: What DevAudit Generates Automatically vs. What You Still Write | Compliance mapping (2000w) |
| **BOFU — Decision** | | | | |
| 12 | BOFU | CTO | DevAudit vs. Building It Yourself: The True Cost of DIY Compliance Tooling | Comparison guide (2000w) |
| 13 | BOFU | Lead Developer | Migrating from Manual Evidence Collection to DevAudit: A Step-by-Step Guide | Migration guide (2500w) |
| 14 | BOFU | Compliance Officer | Giving Your Auditor Portal Access: Scoped, Read-Only, No Developer Handholding | Feature walkthrough (1200w) |
| 15 | BOFU | CISO | DevAudit's Security Model: API Keys, PATs, Dual-Actor Approval, and the Kill Switch | Security whitepaper (2500w) |
| **Workflow series — "How a Feature Ships"** | | | | |
| 16 | MOFU | Lead Developer | Part 1: From GitHub Issue to Implementation Plan — How DevAudit Plans a Feature | Workflow deep-dive (2000w) |
| 17 | MOFU | Lead Developer | Part 2: TDD, E2E, and evidenceShot — How DevAudit Captures Test Evidence at the Assertion Level | Workflow deep-dive (2000w) |
| 18 | MOFU | Lead Developer + Compliance | Part 3: Compiling Evidence — What Happens Between "Tests Pass" and "Ready for Review" | Workflow deep-dive (2000w) |
| 19 | MOFU | Compliance Officer + CTO | Part 4: The UAT Gate — Four-Eyes Approval, Change Requests, and the Audit Trail | Workflow deep-dive (2000w) |
| 20 | MOFU | CTO | Part 5: Deploy to Production — Post-Deploy Smoke, Production Approval, and Release Finalisation | Workflow deep-dive (1500w) |
| **Industry & trends** | | | | |
| 21 | TOFU | CISO + CTO | The AI Agent Attack Surface: Prompt Injection, Memory Manipulation, and Why Your SDLC Is the Last Line of Defence | Thought leadership (2500w) |
| 22 | TOFU | Compliance Officer | ISO 29119 Meets Agentic AI: How Test Standards Apply When the Machine Writes the Tests | Standards analysis (2000w) |
| 23 | TOFU | CTO | The Binary Bloat Problem: Why AI-Generated Evidence Is Killing Your Git Repository | Technical problem piece (1500w) |
| 24 | TOFU | Lead Developer | AI Skills vs. AI Prompts: Why Structured Agent Delegation Beats Ad-Hoc Copilot Usage | Technical opinion (1800w) |
| **Role-specific workflow guides** | | | | |
| 25 | MOFU | Lead Developer | The Developer's Day with DevAudit: What Changes and What Doesn't | Day-in-the-life (1800w) |
| 26 | MOFU | Compliance Officer | The Auditor's View: Navigating the DevAudit Portal as a GRC Professional | Portal walkthrough (1500w) |
| 27 | MOFU | CTO | Onboarding Your Engineering Team: From First `install` to Organisation-Wide Rollout | Deployment guide (2000w) |
| 28 | MOFU | CISO | Configuring DevAudit for Your Risk Appetite: Approval Modes, Risk Classes, and UAT Gates | Configuration guide (1800w) |
| **Technical deep-dives — SDK & internals** | | | | |
| 29 | MOFU | CTO + Lead Developer | Extending DevAudit with the Plugin SDK: Custom Integrations Without Forking | Technical SDK guide (2000w) |
| 30 | MOFU | Lead Developer | One Source of Truth, Five AI Agents: How DevAudit Keeps Cursor, Windsurf, Gemini, and Claude Aligned | Technical architecture (1800w) |
| 31 | MOFU | Lead Developer | Screenshot Density: Feature vs. Regression — Managing Evidence Storage at Scale | Technical deep-dive (1500w) |
| 32 | MOFU | Lead Developer + CTO | Developer Mode vs. Operator Mode: How DevAudit Adapts to Solo Devs vs. Teams | Feature explanation (1500w) |
| 33 | MOFU | Compliance Officer + CISO | Why We Don't Auto-Generate Your GDPR Documentation: The Opt-In Governance Pattern | Transparency piece (1500w) |
| 34 | MOFU | CTO + Lead Developer | How DevAudit Generates Valid CI YAML Every Time: The Template Substitution Engine | Technical architecture (1800w) |
| 35 | MOFU | Compliance Officer | The Automation You Don't See: Housekeeping Releases and Bare-Date Versioning | Operational guide (1500w) |
| 36 | MOFU | CISO + Compliance Officer | From Incident to Risk Register: The Closed-Loop Compliance Flow | Process deep-dive (1800w) |
| 37 | MOFU | CISO | Fail-Closed: Security Design in the Release Gate — Preventing Shadow Approvals | Security deep-dive (1500w) |
| 38 | MOFU | Lead Developer | The LAST/NEXT Status Sticky: Workflow Navigability for Distributed Teams | UX pattern guide (1500w) |

---

## Article briefs

### TOFU — Awareness

---

#### Article 1: The EU AI Act Hits Code in August 2026

> **Publication note:** Deferred to W10 pending legal review of the EU AI Act regulatory framing. The article's claims about high-risk classification, Article 11 scope, and penalty tiers have been revised for accuracy but should be reviewed by a qualified advisor before publication.

**Primary persona:** CISO
**Goal:** Establish urgency around the August 2026 enforcement deadline and position AI coding agents as an under-recognised compliance surface within the development lifecycle of regulated AI systems.
**Key points:**
- AI coding agents (Claude Code, Cursor, Copilot, Windsurf) may form part of the development lifecycle of systems regulated by the EU AI Act. Organisations developing or operating high-risk AI systems must be able to evidence how those systems were designed, changed, tested and reviewed — AI coding agents are not inherently high-risk merely because they write production code, but their use must be documented when the system being built is regulated
- Where a team develops a high-risk AI system, Article 11 requires technical documentation. AI-assisted development can make reconstructing that lifecycle more difficult unless agent activity, testing and approvals are captured as work happens
- Art. 13 requires transparency and disclosure — who knows which code blocks were AI-generated?
- Fines: the highest tier (up to EUR 35M or 7% of global turnover) applies to prohibited AI practices; infringements of high-risk system obligations carry lower maximums (up to EUR 15M or 3%); the exact penalty depends on the infringement and the organisation
- The gap: security teams are focused on AI products (chatbots, recommendation engines) while AI *development tools* fly under the radar
**DevAudit hook:** DevAudit's `Co-Authored-By` commit enforcement, `ai-prompts.md` evidence artifact, and `ai-use-note.md` per-requirement record create the Art. 11 technical documentation trail automatically. The /sdlc page's "AI as a first-class contributor" section and the EU AI Act "Risk Elevation" control on /compliance are the canonical product references.
**CTA:** "See how DevAudit maps to EU AI Act articles → [devaudit.ai/compliance](https://devaudit.ai/compliance)"
**Cross-links:** [/sdlc § AI as a first-class contributor](https://devaudit.ai/sdlc) · [/compliance § EU AI Act](https://devaudit.ai/compliance)

---

#### Article 2: The Agentic SDLC

**Primary persona:** CTO
**Goal:** Frame the industry shift from AI-assisted coding to AI-driven SDLC participation and position DevAudit as the governance layer for this transition.
**Key points:**
- 2025 was "Copilot autocompletes your line." 2026 is "the AI agent plans, implements, tests, compiles evidence, and opens the PR." The SDLC itself is becoming agentic
- The CTO's decision: where does automation end and human judgment begin? DevAudit's answer: the AI does everything except approve and merge
- The six-skill model: `sdlc-implementer` orchestrates, delegates to `e2e-test-engineer`, `governance-doc-author`, `requirements-aligner`, `adr-author`, `risk-register-keeper` — each with a defined contract
- Agent-agnostic: Claude Code, Cursor, Windsurf, Gemini CLI, Codex — same SDLC, same gates, same evidence. No vendor lock-in on the AI side
- The speed vs. governance tension: 60% of enterprises report no formal AI governance framework. DevAudit is the framework
**DevAudit hook:** The `sdlc-implementer` skill takes a GitHub issue through Stages 1–5 unattended, pausing at the human approval gate — this is the agentic SDLC with guardrails. The /sdlc page's "One prompt" section (`> Implement issue #N under the SDLC.`) is the canonical demonstration.
**CTA:** "Read the SDLC manifesto → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)"
**Cross-links:** [/sdlc § One orchestrator, five specialists](https://devaudit.ai/sdlc) · [docs/skills.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md) · [docs/change-workflows.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/change-workflows.md)

---

#### Article 3: SOC 2 and Segregation of Duties

**Primary persona:** Compliance Officer
**Goal:** Surface the SOC 2 change-management challenge that AI agents create (the same entity writes, tests, and could approve code) and show how DevAudit's dual-approval gate supports segregation-of-duties and change-management objectives.
**Key points:**
- SOC 2 CC8.1 addresses controls over changes to systems and processes. When an AI agent writes the code AND generates the test evidence, the change-management chain becomes harder to evidence — the "segregation" is between a human and their tool, which auditors may not accept as meaningful separation
- Dual approval supports segregation-of-duties and change-management objectives under CC8.1 — DevAudit's `dual_actor` mode is one concrete implementation, not a SOC 2 mandate
- The `Co-Authored-By` tag attributes AI code to the human who directed it. The four-eyes approval gate (`dual_actor` mode) ensures `approver_user_id != release_creator_user_id`
- `solo_with_gap` mode exists for solo developers but requires an explicit risk-register entry acknowledging the control gap — the auditor sees the acknowledgement, not a silent bypass
- Evidence is immutable and timestamped on the portal — no post-hoc fabrication
**DevAudit hook:** `approval.mode: dual_actor` in `sdlc-config.json`, enforced by `check-release-approval.yml` at PR merge time. The /compliance page's SOC 2 CC8.1 "Change Management" row and ISO 27001 A.5.3 "Separation of Duties" row are the canonical mappings.
**CTA:** "See how DevAudit maps SOC 2 controls → [devaudit.ai/compliance](https://devaudit.ai/compliance)"
**Cross-links:** [/compliance § SOC 2](https://devaudit.ai/compliance) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md)

---

#### Article 4: Vibe Coding Broke My CI Pipeline

**Primary persona:** Lead Developer
**Goal:** Hook developers with a relatable post-mortem about what happens when unconstrained AI generates code without structure — then show how DevAudit prevents it.
**Key points:**
- Narrative format: a developer uses an AI agent to "vibe code" a feature. The agent generates 12 test files with no REQ annotations, no `evidenceShot()` calls, no traceability. CI passes (tests green), but the compliance portal shows zero evidence for the requirement. The release reaches UAT review with nothing for the reviewer to review
- The deeper problem: the agent pushed to a branch whose PR was already merged, then suggested cherry-picking orphaned commits to `develop`
- Root cause: no scope guard, no branch-state check, no evidence-wiring validation
- The fix: structured agent delegation (the `e2e-test-engineer` skill owns test authoring; the orchestrator doesn't inline specs), scope-check gates, branch-state pre-flight
- The punchline: "The AI was productive. It just wasn't compliant. DevAudit makes those the same thing."
**DevAudit hook:** The real incident from the wawagardenbar-app REQ-081 (anonymised). Issues #169, #170, #171. Tie to the "What DevAudit is not" disclaimer: "Not a replacement for code review — the four-eyes gate enforces THAT there's a second reviewer" — show that without the gate, unconstrained AI fails silently.
**CTA:** "Try the 15-minute quickstart → [devaudit.ai/onboarding](https://devaudit.ai/onboarding)"
**Cross-links:** [/sdlc § What DevAudit is not](https://devaudit.ai/sdlc) · [/onboarding](https://devaudit.ai/onboarding) · [docs/e2e-test-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/e2e-test-tiers.md)

---

#### Article 5: 60% Have No AI Governance Framework

**Primary persona:** CISO + CTO
**Goal:** Data-driven piece establishing the governance gap and the cost of inaction.
**Key points:**
- Cite 2026 industry surveys on AI governance adoption rates
- Map the gap to concrete risks: regulatory fines (EU AI Act), audit failures (SOC 2), IP liability (AI-generated code provenance), security incidents (prompt injection on agents with write access)
- The cost of building governance in-house vs. adopting a purpose-built tool
- Framework comparison: what exists today (manual spreadsheets, Jira workflows, GRC tools that don't speak CI/CD) vs. what's needed (developer-native, pipeline-integrated, evidence-automated)
**DevAudit hook:** DevAudit is the governance framework that ships as a `npx install` — not a 6-month consulting engagement. Reference the /onboarding page's "No two SDLCs are the same" section — DevAudit is opinionated about WHAT evidence auditors expect; flexible about HOW your team produces it.
**CTA:** "Tell us about your SDLC → [devaudit.ai/onboarding](https://devaudit.ai/onboarding)"
**Cross-links:** [/onboarding § Tell us about your SDLC](https://devaudit.ai/onboarding) · [/compliance](https://devaudit.ai/compliance) · [README § The SDLC at a glance](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md)

---

### MOFU — Consideration

---

#### Article 6: Immutable Audit Trails for AI-Generated Code

**Primary persona:** CISO
**Goal:** Deep-dive into how DevAudit creates tamper-resistant evidence of AI involvement in code changes.
**Key points:**
- Every AI-generated code block carries a `Co-Authored-By` commit trailer — enforced by commitlint hooks, not optional
- `ai-use-note.md` per requirement records: which AI tool, planned use areas, risk classification impact
- `ai-prompts.md` records the human-AI interaction that produced the code
- CI independently re-runs all quality gates on the PR branch — the human's local "it works on my machine" is not the evidence; GitHub Actions' tamper-resistant output is
- Portal evidence is append-only: iteration N adds, it does not replace. The audit trail shows what each iteration looked like
- SHA comparison: the Release Approval Gate compares the approved SHA against the PR HEAD — if code changed after approval, the gate warns
**DevAudit hook:** `check-release-approval.yml` SHA comparison step, `ai-prompts.md` evidence artifact, append-only iteration evidence. The /sdlc page's "AI as a first-class contributor" section confirms: `Co-Authored-By` trailer enforced by commitlint, portal renders human/AI split per release.
**CTA:** "See the evidence model in detail → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)"
**Cross-links:** [/sdlc § AI as a first-class contributor](https://devaudit.ai/sdlc) · [docs/evidence-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/evidence-tiers.md) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md)

---

#### Article 7: Separating Code from Evidence

**Primary persona:** CTO
**Goal:** Explain the architectural decision to keep binary evidence out of Git and in the portal — and why this matters at scale.
**Key points:**
- The problem: AI agents generate massive evidence volumes — Playwright screenshots, SAST JSON reports, test coverage HTML, trace ZIPs. Committing these to Git degrades clone times, bloats CI caches, and makes `git log` unusable
- DevAudit's answer: declarative compliance docs (markdown) live in Git (reviewable in PR diff). Binary evidence (JSON, PNG, HTML) uploads to the portal via `upload-evidence.sh` in CI
- The portal is the evidence store; Git is the code store. Both reference the same `REQ-XXX` and release version
- Architecture: `ci.yml` uploads gate evidence after tests pass; `compliance-evidence.yml` uploads committed docs on compliance-path pushes. Two workflows, no duplication (issue #45 — the dedup story)
- For the CTO: this means your Git repo stays fast, your CI artifacts are retained for 90 days in GitHub + permanently in the portal, and your developers never touch an evidence management UI
**DevAudit hook:** The explicit "Binary evidence in DevAudit, not git" rule from `3-compile-evidence.md`. The /sdlc page's "Three tiers, two upload paths" section explains the operator-upload vs CI-auto-upload split.
**CTA:** "See the architecture → [sdlc-framework.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/sdlc-framework.md)"
**Cross-links:** [/sdlc § Three tiers, two upload paths](https://devaudit.ai/sdlc) · [docs/evidence-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/evidence-tiers.md) · [Stage 3 doc](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/3-compile-evidence.md)

---

#### Article 8: From 40 Hours to 4

**Primary persona:** Compliance Officer
**Goal:** Quantify the time savings from automated evidence collection and show the before/after.
**Key points:**
- Before: compliance officer chases developers for screenshots, exports test reports from Jenkins, manually cross-references SAST findings, assembles evidence packs in SharePoint, sends to auditor via email
- After: CI uploads evidence automatically on every push. The portal organises it by requirement, release, and evidence type. The auditor gets scoped read-only portal access
- Walkthrough of what CI uploads automatically: `security_scan` (SAST JSON), `ci_pipeline` (gate outcomes), `test_report` (Playwright HTML + JUnit XML), `screenshot` (per-AC `evidenceShot` PNGs), `compliance_document` (markdown artifacts)
- What still requires human input: risk classification, acceptance criteria definition, UAT approval click, production approval click. DevAudit automates evidence *collection*, not evidence *judgment*
- ROI model: hours per audit cycle before vs. after, across 4 quarterly cycles per year
**DevAudit hook:** The `upload-evidence` job in `ci.yml.template` and the portal's release-completeness matrix. The /compliance page's "One gate, multiple frameworks" concept shows how a single gate check satisfies multiple compliance clauses simultaneously — compounding the time savings.
**CTA:** "See standards coverage → [devaudit.ai/compliance](https://devaudit.ai/compliance)"
**Cross-links:** [/compliance § One gate, multiple frameworks](https://devaudit.ai/compliance) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md)

---

#### Article 9: DevAudit in 15 Minutes

**Primary persona:** Lead Developer
**Goal:** Hands-on tutorial — `npx devaudit install` through first compliant release. No marketing, just commands and outputs.
**Key points:**
- Prerequisites: Node >= 22, a GitHub repo, a DevAudit PAT from `devaudit.ai/settings/tokens`
- Step 1: `export DEVAUDIT_USER_TOKEN="mctok_..." && npx @metasession.co/devaudit-cli@latest install ../your-project` — walk through the 11-step interactive flow
- Step 2: Review the diff — what got installed (workflows, hooks, rule files, skills, scripts)
- Step 3: `sdlc-config.json` — explain the key knobs (stack, host, UAT config, approval mode, e2e projects)
- Step 4: Create a GitHub issue, run `sdlc-implementer` (or walk Stages 1–5 manually), watch evidence appear in the portal
- Step 5: Open the portal — show the release dashboard, the evidence-by-requirement view, the completeness matrix
- What to do next: `devaudit update` when a new framework version ships, `devaudit join` for teammates
**DevAudit hook:** The actual CLI commands from `README.md`. Mirror the /onboarding page's 11-step breakdown (verify PAT → detect stack → confirm adapters → write config → create project → issue API key → upload secrets → install hooks → configure branch protection → sync templates → done report). The homepage's live evidence feed ("Production deploy wawagardenbar-app · main 2m") is what the portal looks like after completion.
**CTA:** "Sign in to issue a token → [devaudit.ai/auth/sign-in](https://devaudit.ai/auth/sign-in)"
**Cross-links:** [/onboarding § Onboard a new project](https://devaudit.ai/onboarding) · [README § Quick start](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md) · [docs/onboarding.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/onboarding.md)

---

#### Article 10: The Four-Eyes Gate

**Primary persona:** CTO + Compliance
**Goal:** Explain the four-eyes approval mechanism end-to-end — from submission to merge.
**Key points:**
- The release lifecycle: `draft → uat_review → uat_approved → prod_review → prod_approved → released`
- Step 11a: dev submits for UAT review (portal status: `uat_review`). Step 11b: a *different person* reviews evidence and clicks Approve
- `dual_actor` mode: `approver_user_id != release_creator_user_id` — enforced server-side, not honour-system
- `auto_low_risk` mode: LOW-risk requirements auto-approve once CI evidence uploads complete — human four-eyes reserved for MEDIUM/HIGH where the risk justifies the ceremony
- The `Release Approval Gate` workflow on the PR: polls the portal API, blocks merge until approval is recorded. `workflow_dispatch` re-trigger for when approval happens after the initial check
- Change-request loop: reviewer clicks "Request Changes" → agent enters iteration loop → addresses items → pushes → portal auto-resets to `uat_review` → re-review. Up to 5 iterations before the skill halts
- Post-merge: `post-deploy-prod.yml` runs production smoke, advances to `prod_review`, and a second approval promotes to `released`
**DevAudit hook:** `check-release-approval.yml.template`, `change-request-loop.md`, `sdlc-config.json` approval modes. The /sdlc page confirms: "A reviewer approves on the portal. The merge gate stays red until they do." The homepage live feed shows the real-time evidence: "PR #347 approved — Four-eyes complete · UAT signed."
**CTA:** "Read the SDLC manifesto → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)"
**Cross-links:** [/sdlc § Five stages](https://devaudit.ai/sdlc) · [Stage 4 doc](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/4-submit-for-review.md) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md)

---

#### Article 11: EU AI Act Art. 11 — What DevAudit Generates vs. What You Write

**Primary persona:** CISO + Compliance
**Goal:** Clause-by-clause mapping of EU AI Act technical documentation requirements to specific DevAudit artifacts.
**Key points:**
- Art. 11 (high-risk AI systems) requires: general description of the AI system, development methodology, design specifications, data requirements, testing and validation results, risk management measures — AI-assisted development makes capturing this lifecycle harder unless agent activity is tracked automatically
- What DevAudit generates automatically: `ai-use-note.md` (AI system description per REQ), `implementation-plan.md` (design specifications), test-execution-summary (testing results), SAST + dep-audit evidence (risk management), `Co-Authored-By` provenance trail
- What you still write: the company-level AI system register, DPIA (template provided), AI disclosure statement (template provided), human oversight procedures
- Art. 13 transparency: `ai-prompts.md` captures the human-AI interaction; the portal makes this reviewable by auditors
- The governance doc starters: ROPA, DPIA, AI disclosure, incident report, periodic review — installed via `devaudit bootstrap-governance`, authored via the `governance-doc-author` skill
**DevAudit hook:** `governance/` templates, `ai-prompts.md`, `ai-use-note.md`, standards-coverage page. The /compliance page's EU AI Act section lists five mapped controls (Human Oversight, Tool Governance, Transparency & Audit Trail, Risk Elevation, Regeneration Protocol) — use these as the article's structural backbone.
**CTA:** "View the full standards coverage → [devaudit.ai/compliance](https://devaudit.ai/compliance)"
**Cross-links:** [/compliance § EU AI Act](https://devaudit.ai/compliance) · [docs/governance-templates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/governance-templates.md) · [/sdlc § AI as a first-class contributor](https://devaudit.ai/sdlc)

---

### BOFU — Decision

---

#### Article 12: DevAudit vs. Building It Yourself

**Primary persona:** CTO
**Goal:** Honest comparison of DevAudit vs. the common alternative (custom scripts, Jira workflows, manual evidence collection).
**Key points:**
- The "we'll build it ourselves" path: custom CI scripts for evidence upload, a shared drive for screenshots, Jira custom fields for traceability, manual evidence assembly before audits
- What you're actually building: an evidence portal, an approval workflow engine, a CI integration layer, a standards-mapping database, per-requirement traceability, iteration tracking, auditor access controls, **a public trust-badge system** (every enterprise website needs a SOC 2 / ISO 27001 badge — building this yourself means maintaining embeddable iframes, cache headers, privacy gates, and framework claim resolution)
- The hidden costs: maintenance burden (every CI provider change breaks your scripts), no standard schema (auditors question bespoke formats), no iteration tracking (you can't see what changed between review cycles), no cross-project consistency, **no sales-ready compliance badges** (marketing asks for a trust badge, engineering says "we'll get to it", deal stalls)
- DevAudit's answer: one `npx install`, framework-owned CI templates that update with `devaudit update`, a portal purpose-built for compliance evidence, auditor access built in, **embed widget live since 2026-06-06** — copy-paste iframe snippet, three privacy gates, global kill switch for CISO control
- Comparison table: feature-by-feature (DIY vs. Jira + Confluence vs. traditional GRC tools vs. DevAudit)
**DevAudit hook:** The `devaudit update` story — framework templates stay current without manual maintenance. The /sdlc page's three-pillar architecture (framework + gates + portal) is the structural answer to "what are you actually building if you DIY?" The /onboarding page's "The framework is open-source. Read it first if you prefer." messaging removes the sales objection.
**CTA:** "Tell us about your SDLC → [devaudit.ai/onboarding](https://devaudit.ai/onboarding)"
**Cross-links:** [/sdlc § Framework, gates, and portal](https://devaudit.ai/sdlc) · [/onboarding § The framework is open-source](https://devaudit.ai/onboarding) · [README § Quick start — update](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md) · [/projects/[slug]/settings/embed](https://devaudit.ai/projects)

---

#### Article 13: Migrating from Manual Evidence Collection

**Primary persona:** Lead Developer
**Goal:** Step-by-step migration guide for teams currently doing compliance manually.
**Key points:**
- Assess your current state: where does evidence live today? (Git? SharePoint? Jira? Someone's desktop?)
- Phase 1: Install DevAudit on one project (`devaudit install`). Run one feature through Stages 1–5. Compare the evidence output to your manual process
- Phase 2: Add `evidenceShot()` calls to existing e2e tests. Add REQ annotations. Run CI and watch evidence populate in the portal
- Phase 3: Onboard remaining projects (`devaudit install` for each). Use `devaudit join` for team members
- Phase 4: Give your auditor portal access. Walk them through the release-completeness matrix
- Common migration gotchas: existing tests without REQ annotations (the wawagardenbar-app lesson), `sdlc-config.json` customisation for non-standard stacks, UAT configuration for projects that don't auto-deploy `develop`
**DevAudit hook:** The `install` → `update` → `join` lifecycle from `README.md`. The /onboarding page's three-path structure mirrors this migration journey perfectly.
**CTA:** "Get started → [devaudit.ai/onboarding](https://devaudit.ai/onboarding)"
**Cross-links:** [/onboarding § Three paths in](https://devaudit.ai/onboarding) · [README § When to use which command](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md) · [docs/onboarding.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/onboarding.md)

---

#### Article 14: Giving Your Auditor Portal Access

**Primary persona:** Compliance Officer
**Goal:** Show how simple it is to give an external auditor exactly what they need.
**Key points:**
- The old way: compile evidence into a folder, send via secure transfer, answer follow-up questions via email, repeat for every audit cycle
- The DevAudit way: create a scoped, read-only auditor account on the portal. The auditor browses evidence by project, requirement, release, and evidence type — self-service
- What the auditor sees: the release-completeness matrix (which evidence categories are present for each requirement), the evidence-by-requirement view (drill into any REQ to see screenshots, test reports, SAST results, compliance docs), the release timeline (when was each artifact uploaded, by which CI run)
- What the auditor does NOT see: source code, CI secrets, developer chat transcripts, anything outside their scoped project access
- The audit-pack export: `devaudit-plugin-evidence-export` bundles all evidence for a release into a downloadable archive if the auditor prefers offline review
**DevAudit hook:** Portal scoped access, `evidence-export` plugin. The /sdlc page describes the portal as: "Project registry, immutable evidence storage, release-approval lifecycle, four-eyes approval, auditor dashboards, time-limited share links, framework-coverage matrix per release, append-only audit log." Each of these is an auditor-facing feature.
**Embed widget (shipped 2026-06-06):** The public-facing complement to private auditor access — an iframe badge platter that displays live compliance framework claims (SOC 2, ISO 27001, GDPR, EU AI Act) on the project's own website. Unlike static trust badges, it connects to a living compliance system. Three 404 gates prevent information leakage; global kill switch gives CISO central control.
**CTA:** "See the portal → [devaudit.ai/compliance](https://devaudit.ai/compliance)"
**Cross-links:** [/sdlc § Pillar 3 — Evidence portal](https://devaudit.ai/sdlc) · [README § Related repositories](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md) · [/projects/[slug]/settings/embed](https://devaudit.ai/projects)

---

#### Article 15: DevAudit's Security Model

**Primary persona:** CISO
**Goal:** Security whitepaper for CISO technical due diligence before procurement.
**Key points:**
- Authentication: project-scoped API keys (CI uploads), Personal Access Tokens (human actions), GitHub OAuth (portal login)
- Authorisation: `dual_actor` approval mode enforces segregation server-side. API keys are scoped to one project — a compromised key cannot access other projects
- Evidence integrity: append-only evidence store, immutable once uploaded. SHA comparison detects code changes after approval
- CI trust model: evidence is generated by GitHub Actions (tamper-resistant infrastructure), not by the developer's local machine. The portal trusts CI-uploaded evidence over manually uploaded evidence
- Kill switch: the `Release Approval Gate` is a required status check on the PR — it blocks merge at GitHub's infrastructure level, not at the developer's discretion. Removing the gate requires branch-protection admin access
- Bootstrap mode: first-time setup gracefully passes the gate (no evidence to check yet) with a documented notice, then enforcement activates on the next PR
- Secret management: `DEVAUDIT_API_KEY` as repo secret, `DEVAUDIT_USER_TOKEN` as personal secret, base URL in `sdlc-config.json` (reviewable in PR diff, not hidden in repo variables)
**DevAudit hook:** `check-release-approval.yml.template` security design, `sdlc-config.json` approval modes. The /sdlc page's "What DevAudit is not" section is critically important here — reference "Not a SIEM" and "Not an AI safety product" disclaimers to scope the security model honestly.
**CTA:** "Tell us about your SDLC → [devaudit.ai/onboarding](https://devaudit.ai/onboarding)"
**Cross-links:** [/sdlc § What DevAudit is not](https://devaudit.ai/sdlc) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md) · [/onboarding](https://devaudit.ai/onboarding)

---

### Workflow series — "How a Feature Ships"

This is a five-part series that follows a single feature from GitHub issue to production. Each part maps to an SDLC stage and shows what the developer, the AI agent, CI, and the portal each do. Written for the Lead Developer persona but valuable for CTOs and Compliance Officers who want to understand the mechanics.

---

#### Article 16: Part 1 — From Issue to Plan

**Stage:** 1 (Plan Requirement)
**Key points:**
- Starts with a GitHub issue. The agent (or human) assigns `REQ-XXX`, classifies risk (LOW/MEDIUM/HIGH), creates the evidence directory
- For MEDIUM/HIGH: the `sdlc-implementer` creates `implementation-plan.md` using the compliance template — threat model, data flows, surface inventory, acceptance criteria in Given/When/Then form
- Sub-skill delegation: `requirements-aligner` maps ACs to SRS items, `adr-author` decides if an ADR is needed, `risk-register-keeper` identifies risks for MEDIUM/HIGH
- WAIT CHECKPOINT: human approves the plan before implementation begins
- Output: RTM entry, implementation plan, test scope, test plan — all committed to Git before a single line of product code is written
**Illustrate with:** A real `implementation-plan.md` structure (redacted) showing the AC table, surface inventory, compliance clause slots
**Cross-links:** [/sdlc § Five stages — Plan](https://devaudit.ai/sdlc) · [Stage 1 doc](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/1-plan-requirement.md) · [docs/skills.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md) · [docs/change-workflows.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/change-workflows.md)

---

#### Article 17: Part 2 — TDD, E2E, and evidenceShot

**Stage:** 2 (Implement and Test)
**Key points:**
- Write failing tests first — depth scales with risk class
- E2E delegation gate: the orchestrator skill MUST invoke `e2e-test-engineer` before touching any `.spec.ts` file — structural defence against the "I'll just write the test inline" inertia trap
- `evidenceShot(page, 'REQ-037', 1, 'edit-dialog-prefilled')` — captures a screenshot at the exact moment an AC is proven, not a generic post-test capture
- Screenshot density: `tier: 'always'` for the canonical anchor, `tier: 'feature'` for intermediate states that auto-suppress on regression runs
- Transport-layer specs (API-only, no UI) — their evidence form is `test-execution-summary.md`, not screenshots. The portal correctly shows zero screenshots for these REQs
- Gates: lint → typecheck → unit → SAST → dep-audit (fast, every change) → E2E (once, after fast gates clean)
- Self-audit before Phase 3: `git diff` every `.spec.ts` and verify it was authored via the skill
**Illustrate with:** A before/after of a test with and without `evidenceShot()` — what the portal shows in each case
**Cross-links:** [/sdlc § Five stages — Implement & test](https://devaudit.ai/sdlc) · [Stage 2 doc](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/2-implement-and-test.md) · [docs/e2e-test-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/e2e-test-tiers.md) · [docs/skills.md § e2e-test-engineer](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md)

---

#### Article 18: Part 3 — Compiling Evidence

**Stage:** 3 (Compile Evidence)
**Key points:**
- What gets committed to Git: `test-scope.md`, `test-plan.md`, `test-execution-summary.md`, `implementation-plan.md`, `security-summary.md`, `ai-prompts.md`, release ticket
- What gets uploaded to the portal: SAST JSON, gate-outcomes JSON, Playwright report, JUnit XML, per-AC screenshots, coverage reports
- Two CI workflows, no duplication: `ci.yml` uploads gate evidence, `compliance-evidence.yml` uploads committed docs. Both resolve the same release version via `derive-release-version.sh`
- UAT-environment verification (Step 10): opt-in by risk class via `sdlc-config.json`. Health check → smoke test → feature verification → record results
- The push-early lesson: commit and push compliance docs immediately so destination breakage (stale URL, revoked key) surfaces in seconds, not at the end of the stage
**Illustrate with:** The portal's release-completeness matrix filling in as CI runs
**Cross-links:** [/sdlc § Five stages — Evidence](https://devaudit.ai/sdlc) · [/sdlc § Three tiers, two upload paths](https://devaudit.ai/sdlc) · [Stage 3 doc](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/3-compile-evidence.md) · [docs/evidence-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/evidence-tiers.md) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md)

---

#### Article 19: Part 4 — The UAT Gate

**Stage:** 4 (Submit for Review)
**Key points:**
- The PR is the merge request, not the development workspace. Don't create it prematurely — every push to `develop` while a PR is open triggers duplicate CI runs
- Prerequisites: all development complete, CI green, UAT verification passed, evidence compiled, release approved in DevAudit
- The `Release Approval Gate` workflow: polls the portal API for `release.status`, blocks merge until `uat_approved`. Initially fails (expected) — approve in DevAudit, then re-run the workflow
- Risk-based review: LOW = self-merge after CI passes. MEDIUM/HIGH = second human reviewer required
- Change-request loop: reviewer requests changes → agent categorises (must-address / question / out-of-scope) → delta-plan → re-implement → re-compile evidence → push → portal auto-resets → re-review. Max 5 iterations
- The scope guard: if a change-request is fundamentally a new requirement, the agent halts and recommends a separate issue
**Illustrate with:** The portal's approval panel, the PR checks view showing the Release Approval Gate
**Cross-links:** [/sdlc § Five stages — UAT review](https://devaudit.ai/sdlc) · [Stage 4 doc](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/4-submit-for-review.md) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md) · [docs/release-playbooks/](https://github.com/metasession-dev/DevAudit-Installer/tree/main/docs/release-playbooks)

---

#### Article 20: Part 5 — Deploy and Finalise

**Stage:** 5 (Deploy to Main)
**Key points:**
- Merge via `gh pr merge --merge` (merge commit preserves audit trail — squash and rebase are blocked by branch protection)
- `post-deploy-prod.yml` fires: production smoke check, uploads `environment=production` evidence, advances each in-scope release to `prod_review`
- Production approval: a reviewer confirms production is healthy and clicks Approve → status becomes `released`
- `close-out-release.yml` fires on `released`: reconciles the release ticket (moves to `approved-releases/`, flips RTM status to RELEASED)
- Issue closure: the GitHub issue is closed with a comment linking the PR, the requirement, and the release
- The traceability chain is complete: Issue → REQ-XXX → Implementation Plan → Test Scope → Test Plan → Test Execution → Evidence → UAT Approval → PR → Production Approval → Released
**Illustrate with:** The portal's release detail page in `released` state showing the full evidence pack
**Cross-links:** [/sdlc § Five stages — Deploy](https://devaudit.ai/sdlc) · [Stage 5 doc](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/5-deploy-main.md) · [docs/release-playbooks/](https://github.com/metasession-dev/DevAudit-Installer/tree/main/docs/release-playbooks) · [implementing-an-sdlc-issue.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/implementing-an-sdlc-issue.md)

---

### Industry & trends

---

#### Article 21: The AI Agent Attack Surface

**Primary persona:** CISO + CTO
**Goal:** Technical analysis of how AI coding agents expand the attack surface and why SDLC controls are the mitigation.
**Key points:**
- AI agents in 2026 have write access: they modify files, run commands, push to Git, create PRs, deploy to production (via CI)
- Attack vectors: prompt injection (malicious instructions in issue descriptions, code comments, or dependency READMEs that the agent ingests), memory manipulation (poisoning the agent's context window with false instructions), tool-use exploitation (tricking the agent into running destructive commands)
- The blast radius: a compromised agent with `git push` access can push malicious code that CI will test, evidence-package, and present for human approval — the human is now the last line of defence, reviewing AI-generated evidence about AI-generated code
- Why SDLC controls matter: the four-eyes gate ensures a human reviews before merge. The scope guard prevents the agent from exceeding its mandate. The SHA comparison detects code changes after approval. The immutable audit trail means post-hoc investigation is possible
- DevAudit's position: not an AI security product (that's a different market) — but the SDLC governance layer that ensures AI actions are bounded, attributed, and reviewable
**Cross-links:** [/sdlc § What DevAudit is not — "Not an AI safety product"](https://devaudit.ai/sdlc) · [/sdlc § AI as a first-class contributor](https://devaudit.ai/sdlc) · [/compliance § EU AI Act — Human Oversight](https://devaudit.ai/compliance)

---

#### Article 22: ISO 29119 Meets Agentic AI

**Primary persona:** Compliance Officer
**Goal:** Standards analysis of how traditional test standards apply when AI writes the tests.
**Key points:**
- ISO 29119 §3.4 (Test Plan) requires planned testing, not ad-hoc. When the AI generates tests, the plan must precede generation — DevAudit's Stage 1 `test-plan.md` is committed before the AI writes a single test
- ISO 29119 §5.4 (Independent testing) requires independence between test design and implementation. When the same AI writes code and tests, independence requires structural separation — DevAudit's skill delegation (`sdlc-implementer` cannot author e2e specs; `e2e-test-engineer` owns that)
- The "AI tested itself" problem: if the same model writes code and tests, confirmation bias is structural. DevAudit mitigates with: different skill contexts (different system prompts), CI re-execution (independent infrastructure), human approval (the four-eyes gate)
- Test evidence must be traceable to requirements — `evidenceShot()` with REQ/AC parameters creates this traceability at the assertion level, not the test-suite level
**Cross-links:** [/compliance § ISO 29119](https://devaudit.ai/compliance) · [/sdlc § One orchestrator, five specialists](https://devaudit.ai/sdlc) · [docs/e2e-test-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/e2e-test-tiers.md) · [Stage 2 doc](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/2-implement-and-test.md)

---

#### Article 23: The Binary Bloat Problem

**Primary persona:** CTO
**Goal:** Technical problem piece about Git repository degradation from AI-generated evidence, with DevAudit as the solution.
**Key points:**
- A single Playwright run generates: HTML report (~5MB), trace ZIPs (50MB+), screenshots (10-50 per REQ × 200KB each), coverage reports (5-20MB). Multiply by 3-5 releases per week
- Git is designed for text diffs, not binary blobs. Binary evidence makes `git clone` slow, `git log` painful, CI cache inefficient
- Common workarounds: `.gitignore` the evidence (lose traceability), Git LFS (adds complexity and cost), separate repos (fragmented audit trail)
- DevAudit's answer: markdown docs in Git (reviewable in PR diffs, lightweight). Binary evidence in the portal (permanent, searchable, scoped access). Both keyed to the same REQ-XXX and release version. No workarounds needed
**Cross-links:** [/sdlc § Three tiers, two upload paths](https://devaudit.ai/sdlc) · [docs/evidence-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/evidence-tiers.md) · [docs/sdlc-framework.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/sdlc-framework.md)

---

#### Article 24: AI Skills vs. AI Prompts

**Primary persona:** Lead Developer
**Goal:** Technical opinion piece arguing for structured agent delegation over ad-hoc prompting.
**Key points:**
- Ad-hoc prompting: "write e2e tests for this feature" → the agent produces tests in whatever style, with or without evidence hooks, with or without REQ annotations, with or without traceability. Quality depends entirely on prompt engineering skill
- Structured skills: `e2e-test-engineer` has a defined 7-phase workflow, a contract for `evidenceShot()` calls per AC, a self-audit step, a density policy, a regression-pack handoff. The developer invokes the skill; the skill enforces the standard
- The compounding benefit: skills compose (the orchestrator delegates to specialists), skills enforce (Phase 5½ evidence-wiring validation), skills evolve (update the skill once, every project gets the improvement via `devaudit update`)
- The limitation: skills are opinionated. If your team's e2e conventions differ fundamentally from the skill's assumptions, you'll fight it. DevAudit's bet: most teams benefit more from a good default than from total flexibility
**Cross-links:** [/sdlc § One orchestrator, five specialists](https://devaudit.ai/sdlc) · [docs/skills.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md) · [docs/adding-a-skill.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/adding-a-skill.md)

---

### Role-specific workflow guides

---

#### Article 25: The Developer's Day with DevAudit

**Primary persona:** Lead Developer
**Goal:** Honest day-in-the-life showing what changes and what stays the same.
**Key points:**
- What doesn't change: you still write code in your IDE, you still use Git, you still open PRs, you still run tests locally
- What changes: commits must follow Conventional Commits with `Ref: REQ-XXX` trailers (enforced by commitlint hooks). `feat`/`fix`/`refactor` commits without a REQ are rejected locally. Evidence artifacts are generated as part of the workflow, not as an afterthought
- The overhead for a LOW-risk change: ~5 minutes of planning (RTM entry + test scope), ~0 minutes of evidence compilation (CI handles it), ~2 minutes of portal interaction (approve the release)
- The overhead for a HIGH-risk change: ~20 minutes of planning (implementation plan + threat model + test plan, with human review checkpoint), ~10 minutes of evidence review, ~5 minutes of portal interaction
- What developers actually like: not chasing compliance officers for evidence requests, not maintaining a separate test-management tool, the AI handling the compliance boilerplate
- What developers push back on: the commit convention enforcement (initially), the "plan before you code" discipline for MEDIUM/HIGH risk (initially), the scope guard halting when they want to "just add one more thing"
**Cross-links:** [/sdlc § Five stages](https://devaudit.ai/sdlc) · [/onboarding § Three paths in](https://devaudit.ai/onboarding) · [implementing-an-sdlc-issue.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/implementing-an-sdlc-issue.md) · [docs/release-playbooks/low-risk-release.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/release-playbooks/low-risk-release.md)

---

#### Article 26: The Auditor's View

**Primary persona:** Compliance Officer (writing for the auditor audience they serve)
**Goal:** Portal walkthrough from the auditor's perspective — what they see, how they navigate, what they're looking for.
**Key points:**
- The auditor landing page: project list, each with a release count and compliance status summary
- Drilling into a project: the releases view — date-based versioning, status badges (draft/uat_review/uat_approved/released), evidence completeness per release
- Drilling into a release: the evidence-by-requirement view — each REQ shows its evidence categories (PLAN, TEST, RELEASE), test results, screenshots, security scan results
- The completeness matrix: which evidence categories are present (✓) or missing (✗) for each requirement. This is the first thing auditors check
- The audit-pack export: download all evidence for a release as a ZIP — offline review, archive for the audit file
- What the auditor can verify independently: CI ran on GitHub's infrastructure (links to workflow runs), approval was by a different user than the committer, evidence was uploaded by CI not manually
**Cross-links:** [/sdlc § Pillar 3 — Evidence portal](https://devaudit.ai/sdlc) · [/compliance](https://devaudit.ai/compliance) · [docs/evidence-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/evidence-tiers.md)

---

#### Article 27: Onboarding Your Engineering Team

**Primary persona:** CTO
**Goal:** Deployment guide for rolling out DevAudit across an engineering organisation.
**Key points:**
- Phase 1: Pilot on one project with one team (the CTO's team or the most compliant team). Use `devaudit install` — full 11-step setup. Run 2-3 features through the full cycle. Measure: time to first compliant release, developer sentiment, evidence completeness
- Phase 2: Roll out to remaining projects. Use `devaudit install` for each. Standardise `sdlc-config.json` settings across teams (approval mode, risk classes, UAT configuration). Train developers on the commit convention and the stage workflow
- Phase 3: Ongoing. Use `devaudit update` when the framework ships new versions. Monitor the portal's cross-project compliance dashboard. Give auditors portal access
- The `devaudit join` path for individual developers joining an already-onboarded project — no portal call-outs, no API key rotation, just local hooks and skill installation
- Customisation knobs: `sdlc-config.json` lets you configure everything from approval modes to UAT risk classes to e2e project configuration — one config file per project, reviewable in Git
**Cross-links:** [/onboarding § The framework adapts; the audit shape doesn't](https://devaudit.ai/onboarding) · [/onboarding § Onboard a new project](https://devaudit.ai/onboarding) · [README § Quick start](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md) · [docs/onboarding.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/onboarding.md)

---

#### Article 28: Configuring DevAudit for Your Risk Appetite

**Primary persona:** CISO
**Goal:** Configuration guide showing how `sdlc-config.json` maps to security policy decisions.
**Key points:**
- `approval.mode`: `dual_actor` (recommended — different approver than committer), `solo_with_gap` (solo developers — documented control gap), `auto_low_risk` (LOW auto-approves, MEDIUM/HIGH require human). Each mode has specific compliance implications
- `uat.enabled` + `uat.required_risk_classes`: which requirements must be UAT-verified on a deployed environment before approval. Default risk classes: `payment`, `destructive_migration`, `realtime`, `physical_ux`. Wildcard `"*"` for projects that UAT everything
- Risk classification criteria: LOW (internal tools, no regulated data), MEDIUM (PII, user-facing, API changes), HIGH (security, payments, RBAC, authentication). AI involvement raises risk by one level
- The `--require-plan-approval` flag: force human approval of implementation plans for all risk classes, not just HIGH/CRITICAL
- Periodic security review: `periodic-review.yml.template` auto-generates review issues on a configurable cadence — the CISO's mechanism for ensuring ongoing compliance, not just release-time compliance
**Cross-links:** [/compliance § ISO 27001 — A.13 Operations Security](https://devaudit.ai/compliance) · [/sdlc § Tracked + housekeeping](https://devaudit.ai/sdlc) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md) · [docs/governance-templates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/governance-templates.md)

---

#### Article 29: Extending DevAudit with the Plugin SDK

**Primary persona:** CTO + Lead Developer
**Goal:** Technical guide to the plugin architecture for teams needing custom integrations.
**Key points:**
- Plugin SDK overview: `@metasession.co/devaudit-plugin-sdk` with lifecycle hooks (`beforeSync`/`afterSync`, `beforePush`/`afterPush`, `onDoctor`)
- First-party plugins as reference: `devaudit-plugin-prisma` (ORM-specific evidence capture), `devaudit-plugin-evidence-export` (audit pack bundling)
- Plugin store location: `~/.config/devaudit/plugins/` with manifest validation
- Hook execution model: errors isolated per-plugin, hooks don't abort the main flow
- When to build a plugin vs. use the framework: custom stack detection, proprietary CI systems, internal evidence sources
- Plugin development workflow: `git clone` → `npm install` → implement hooks → `devaudit plugin install <path>`
**DevAudit hook:** `discoverPlugins()`, `runHook()` in CLI core. Plugin manifest schema with `devaudit` field in `package.json`.
**CTA:** "Explore the plugin SDK → [plugin-sdk README](https://github.com/metasession-dev/DevAudit-Installer/tree/main/plugin-sdk)"
**Cross-links:** [Plugin SDK source](https://github.com/metasession-dev/DevAudit-Installer/tree/main/plugin-sdk) · [docs/adding-a-skill.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/adding-a-skill.md)

---

#### Article 30: One Source of Truth, Five AI Agents

**Primary persona:** Lead Developer
**Goal:** Explain how DevAudit keeps multiple AI agents aligned without configuration drift.
**Key points:**
- The multi-agent problem: Cursor, Windsurf, Gemini CLI, Claude Code — each reads different rule files, drifts apart over time
- DevAudit's pointer pattern: `.cursorrules`, `.windsurfrules`, `GEMINI.md` are pointer files that reference `INSTRUCTIONS.md`
- `CLAUDE.md` preservation: project-specific content above the `## SDLC Compliance Process` header is kept, old SDLC sections are truncated and refreshed
- `INSTRUCTIONS.md` as canonical: holds the actual SDLC process content from `sdlc/ai-rules/INSTRUCTIONS-SDLC.md`
- Idempotent sync: re-running `devaudit update` produces byte-identical outputs, no duplicate pointers
- Why this matters: a team can use multiple agents without each having a different understanding of the SDLC
**DevAudit hook:** `syncAiRules()` in `cli/src/update/ai-rules.ts`. Five target files written on every install/update.
**CTA:** "Try multi-agent consistency → [devaudit.ai/onboarding](https://devaudit.ai/onboarding)"
**Cross-links:** [/sdlc § AI as a first-class contributor](https://devaudit.ai/sdlc) · [docs/skills.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md)

---

#### Article 31: Screenshot Density: Feature vs. Regression

**Primary persona:** Lead Developer
**Goal:** Technical deep-dive on the three-tier E2E model and screenshot density controls.
**Key points:**
- Three-tier placement: `e2e/smoke/` (every push), `e2e/critical/` (PR-to-release), `e2e/<area>/` (nightly/post-merge)
- Screenshot density tiers: `tier: 'always'` for canonical anchors (always captured), `tier: 'feature'` for intermediate stages (auto-suppress on regression runs)
- `evidenceShot()` helper signature: `evidenceShot(page, 'REQ-XXX', n, '<kebab-slug>', { tier: 'feature' })`
- Sidecar metadata: `.meta.json` with `{ origin, reqId, ac, slug, specFile, capturedAt }`, origin auto-detected from `E2E_NEW_SPECS`
- Storage efficiency: feature branches capture rich evidence, regression pack keeps only canonical anchors
- Transport-layer specs: no `page` object → evidence is `test-execution-summary.md` row with `[REQ-XXX][ACn]` bracket convention
**DevAudit hook:** `references/evidence.ts` shipped in skills. Three-tier gating model from v0.1.53.
**CTA:** "See the E2E tier model → [docs/e2e-test-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/e2e-test-tiers.md)"
**Cross-links:** [docs/e2e-test-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/e2e-test-tiers.md) · [Article 17 (Part 2)](https://devaudit.ai/blog)

---

#### Article 32: Developer Mode vs. Operator Mode: The Four-Bit Detection

**Primary persona:** Lead Developer + CTO
**Goal:** Explain how DevAudit adapts to solo developers vs. teams automatically.
**Key points:**
- The problem: onboarding should be lightweight for the second developer, but full for the operator
- Four-bit auto-detection: (1) `sdlc-config.json` exists, (2) portal project exists, (3) live `Onboarding-issued` API key, (4) `DEVAUDIT_USER_TOKEN` repo secret
- **All four true** → developer mode: skips steps 4/6/7/9 (config rewrite, key issuance, secret writes, branch protection), runs 8/10 (hooks, sync)
- **Any false** → operator mode: full 11-step setup with destructive steps
- `--force-team-config` override: operator can force full mode for secret rotation
- Safe defaults: `--dry-run` forces operator mode so preview shows maximal step set
- Exit code 7: `devaudit join` refuses to run when `sdlc-config.json` absent (guards against joining non-onboarded projects)
**DevAudit hook:** `detectInstallMode()` in `cli/src/install/index.ts`. `makeOnboardedProvider()` for testing.
**CTA:** "Understand install modes → [README § install vs join](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md)"
**Cross-links:** [README § When to use which command](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md) · [docs/onboarding.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/onboarding.md)

---

#### Article 33: Why We Don't Auto-Generate Your GDPR Documentation

**Primary persona:** Compliance Officer + CISO
**Goal:** Transparency about the governance opt-in pattern — avoiding false compliance.
**Key points:**
- The anti-pattern: auto-generated compliance docs that look real but are just templates — auditors reject them, liability increases
- DevAudit's opt-in stance: governance starters are NOT auto-seeded since v0.1.36
- Explicit `bootstrap-governance` command: operator must deliberately request RoPA, DPIA, AI disclosure, incident-report, periodic-review, risk-register starters
- "STARTER TEMPLATE — REPLACE BEFORE COMMITTING" banner: unambiguous placeholder status
- CI does NOT upload governance docs: Tier 1/2 docs (RoPA/DPIA/AI Disclosure) are operator-uploaded only; Tier 3 (incident templates) are CI-auto-uploaded on push
- Framework clause mapping: each starter declares its evidence type and clauses (RoPA→GDPR.Art-30, DPIA→GDPR.Art-35, etc.)
- Skip-if-exists semantics: `bootstrap-governance` never overwrites operator-edited docs
**DevAudit hook:** `bootstrapGovernanceDocs()` in `cli/src/install/bootstrap-governance.ts`. Governance templates in `sdlc/files/_common/governance/`.
**CTA:** "Learn about governance docs → [docs/governance-templates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/governance-templates.md)"
**Cross-links:** [docs/governance-templates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/governance-templates.md) · [/compliance § GDPR](https://devaudit.ai/compliance)

---

#### Article 34: How DevAudit Generates Valid CI YAML Every Time

**Primary persona:** CTO + Lead Developer
**Goal:** Technical architecture piece on the template substitution engine.
**Key points:**
- The problem: template rendering that leaves `{{TOKENS}}` unsubstituted = broken CI
- Scalar substitution: `{{PROJECT_SLUG}}` → `foo`, `{{NODE_VERSION}}` → `20`
- Block substitution: entire YAML sections dropped when config empty (prevents invalid `env:` blocks with blank lines)
- Services block stripping: when `database_service:''`, the entire `services:` block removed (would be invalid YAML)
- Stack-specific overrides: `sdlc/files/ci/python/ci.yml.template` overrides node defaults with ruff/mypy/pytest gates
- Host adapter wiring: railway's `deploy_trigger`, `production_url_secret`, `wait_for_deploy` snippets
- Idempotent sync: `devaudit update` re-renders all 10 CI templates, removes superseded workflows (`test-on-pr.yml`, `check-uat-approval.yml`)
**DevAudit hook:** `substituteTokens()`, `substituteBlocks()`, `stripServicesBlock()` in `cli/src/lib/templates.ts`. `CI_TEMPLATES` list in `ci-templates.ts`.
**CTA:** "See the framework architecture → [docs/sdlc-framework.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/sdlc-framework.md)"
**Cross-links:** [docs/sdlc-framework.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/sdlc-framework.md) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md)

---

#### Article 35: The Automation You Don't See: Housekeeping Releases

**Primary persona:** Compliance Officer
**Goal:** Operational detail on automated governance for non-tracked work.
**Key points:**
- The problem: dependency updates, docs fixes, CI tweaks need release tracking too — but don't need full REQ ceremony
- Bare-date versioning: `v2024.06.17.1` for housekeeping (no REQ-XXX in commit subjects)
- Auto-PR generation: `compliance-evidence.yml` detects bare-date pushes, generates `RELEASE-TICKET-<v>.md` + `security-summary-<v>.md`
- Idempotent PR: opens `chore/housekeeping-release-<v>` branch, updates in place if already exists
- Human attestation required: PR body contains REPLACE markers, needs operator sign-off
- Clause closure: housekeeping still uploads gate outcomes, security scans, audit-log — but without per-REQ evidence packs
- Conventional commit prefixes: `chore/`, `docs/`, `ci/`, `build/`, `test/`, `compliance/` — no `[REQ-XXX]` in commit
**DevAudit hook:** `generate-housekeeping-release-ticket.sh`, `generate-security-summary.sh` in `sdlc/files/_common/scripts/`. `compliance-evidence.yml.template` auto-PR step.
**CTA:** "See release workflows → [docs/release-playbooks/](https://github.com/metasession-dev/DevAudit-Installer/tree/main/docs/release-playbooks)"
**Cross-links:** [docs/change-workflows.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/change-workflows.md) · [docs/release-playbooks/housekeeping-release.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/release-playbooks/housekeeping-release.md)

---

#### Article 36: From Incident to Risk Register: The Closed-Loop Compliance Flow

**Primary persona:** CISO + Compliance Officer
**Goal:** Show the bidirectional linking between incidents and risk management.
**Key points:**
- Incident-driven risk entry: when `incident-export.yml` fires on issue close (label=`incident`)
- `risk-register-keeper` skill Phase 2: creates residual-risk entry with status MITIGATED / OPEN / ACCEPTED
- Bidirectional audit trail: incident report frontmatter gains `risk_register_entry: RISK-NNN`, register references `incident-report-N.md`
- Framework attribution on filing: `ISO29119.3.5.4` baseline + conditional `SOC2.CC7.2` / `GDPR.Art-33` / `GDPR.Art-34` / EU AI Act clauses
- `incident` label creation: idempotent `gh label create incident --force` applied at filing time
- Close-with-label → `incident-export.yml` → `compliance-evidence.yml` flips clauses MISSING→COVERED
- Incident report template: opt-in via `bootstrap-governance`, one incident per file, framework coverage declared
**DevAudit hook:** `risk-register-keeper/SKILL.md` Phase 2 post-incident flow. `incident-export.yml.template` workflow.
**CTA:** "Explore incident management → [docs/governance-templates.md § Incident Report](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/governance-templates.md)"
**Cross-links:** [docs/governance-templates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/governance-templates.md) · [/compliance § SOC 2 CC7.2](https://devaudit.ai/compliance)

---

#### Article 37: Fail-Closed: Security Design in the Release Gate

**Primary persona:** CISO
**Goal:** Technical security analysis of the bootstrap fail-closed protection.
**Key points:**
- The attack scenario: portal inconsistency (projects endpoint 404 but releases/resolve 2xx) could bypass four-eyes
- Bootstrap fail-closed: `check-release-approval.yml` cross-checks both endpoints
- Logic: projects 404 + releases/resolve 404 = bootstrap mode (gate passes, first PR introducing framework)
- Logic: projects 404 + releases/resolve 2xx = FAIL (gate fails closed — prefer hard stop over bypass)
- 401/403 on either probe = invalid key = exit 1
- Bootstrap mode: skips release resolution, skips SHA comparison, allows merge for first-time setup
- Why this matters: prevents "shadow approvals" where a release exists but the project lookup fails
**DevAudit hook:** `check-release-approval.yml.template` bootstrap detection. `APPROVAL-003` in SRS.
**CTA:** "Read the security whitepaper → [Article 15](https://devaudit.ai/blog)"
**Cross-links:** [Article 15: DevAudit's Security Model](https://devaudit.ai/blog) · [docs/compliance-gates.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/compliance-gates.md)

---

#### Article 38: The LAST/NEXT Status Sticky: Workflow Navigability

**Primary persona:** Lead Developer
**Goal:** UX pattern explanation for distributed teams managing long-running SDLC cycles.
**Key points:**
- The problem: long-running issues (5 phases, multiple days) — where did we leave off? who's next?
- Status sticky pattern: `scripts/update-sdlc-status.sh` invoked at every transition/handoff
- Format: single marker-tagged issue comment, edited idempotently (never duplicated)
- `**LAST:** <past-tense, identifiers>` — what just happened, with verifiable pointers
- `**NEXT:** <names the actor>` — who acts now (AI skill, human role, CI system)
- Transitions that update: Stage 1→2, 2→3, 3→4 (hard stop), 4→5 (resume), sub-skill returns
- Lead with the pattern: in-chat turn begins with the two-line LAST/NEXT shape
- On divergence: issue comment is canonical source of truth
**DevAudit hook:** `update-sdlc-status.sh` in `sdlc/files/_common/scripts/`. `sdlc-implementer/SKILL.md` § SDLC navigability.
**CTA:** "Try the SDLC workflow → [devaudit.ai/onboarding](https://devaudit.ai/onboarding)"
**Cross-links:** [implementing-an-sdlc-issue.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/sdlc/files/_common/implementing-an-sdlc-issue.md) · [docs/skills.md § sdlc-implementer](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/skills.md)

---

## Publishing cadence

The first four weeks publish **one article per week** to give each piece room to breathe, allow distribution and discussion, learn which positioning resonates, and build trust before increasing cadence. The EU AI Act article (#1) is deferred to W10 pending legal review of its regulatory framing.

| Week | Articles | Theme |
|------|----------|-------|
| W1 | Launch-1 | Soft-launch invitation — recruit testers and reviewers |
| W2 | #4 | Vibe Coding Broke My CI Pipeline — establish the concrete problem |
| W3 | #9 | DevAudit in 15 Minutes — drive installation and activation |
| W4 | #2 | The Agentic SDLC — establish the wider category and CTO narrative |
| W5 | #3, #5, #6 | Governance gap — SOC 2 change management, the 60% stat, audit trail deep-dive |
| W6 | #16, #17, #18 | Workflow series Pt 1–3 — plan → implement → evidence |
| W7 | #19, #20, #10 | Workflow series Pt 4–5 + four-eyes gate |
| W8 | #7, #23, #24 | Technical architecture — code/evidence separation, binary bloat, skills vs. prompts |
| W9 | #8, #14, #26 | Compliance audience — ROI, auditor access, auditor's view |
| W10 | #1, #11, #22 | EU AI Act + standards deep-dives — Article 1 (pending legal review), Art. 11 mapping, ISO 29119 |
| W11 | #21, #12, #13 | Attack surface + decision stage — AI agent threats, DIY comparison, migration guide |
| W12 | #15, #25, #27 | Security whitepaper + role guides — security deep-dive, developer day, team onboarding |
| W13 | #28, #29, #30 | Risk config + technical deep-dives — risk configuration, plugin SDK, multi-agent rules |
| W14 | #31, #32, #33 | Screenshot density, framework internals, governance opt-in |
| W15 | #34, #35, #36 | CI template engine, housekeeping releases, incident→risk loop |
| W16 | #37, #38 | Fail-closed design, workflow UX |

### Social companion timing

Short-form companions publish **same day** as the long-form, staggered by 2–4 hours (long-form first, so the link is live when the social post goes out). For X thread versions, publish **the following morning** to catch a second timezone window.

| Day | Long-form publishes | Social companion same-day | X thread next morning |
|-----|--------------------|--------------------------|-----------------------|
| Mon/Tue | Blog articles (1–2 per week; 1 per week during W1–W4) | LinkedIn + Dev.to companions | High-signal only |
| Wed | — | Reshare previous week's best-performing companion with new hook | — |
| Thu/Fri | Blog articles (1–2 per week) | LinkedIn + Dev.to companions | — |

---

## Distribution channels

Every article ships in two formats: the **long-form** (devaudit.ai/blog) and a **short-form social companion** (~300 words / 2-min read) distributed to LinkedIn, Dev.to, and X. The short-form is not a summary — it's a self-contained hook that delivers one insight and links to the long-form for depth.

### Channel matrix

| Channel | Content type | Articles |
|---------|-------------|----------|
| **devaudit.ai/blog** | Long-form (primary home, SEO-optimised) | All 38 |
| **LinkedIn (posts + articles)** | Short-form companions | All CISO/CTO/Compliance articles: #1, #2, #3, #5, #6, #8, #10, #11, #12, #14, #15, #19, #21, #22, #26, #27, #28, #33, #35, #36, #37 |
| **Dev.to / Hashnode** | Short-form companions (reposted with canonical URL pointing to devaudit.ai/blog) | All developer articles: #4, #7, #9, #13, #16, #17, #18, #20, #23, #24, #25, #29, #30, #31, #32, #34, #38 |
| **X (Twitter)** | Thread versions (3–5 tweets) of the short-form companions | #4, #9, #2 (W2–W4) + highest-signal pieces (#5, #21, #23, #24, #30, #37) |
| **Hacker News** | Direct long-form submissions | #4 (post-mortem format), #23 (binary bloat — technical problem), #30 (multi-agent rules — technical architecture), #34 (CI template engine — technical deep-dive) |
| **Email nurture** | Long-form links | BOFU articles (#12, #13, #14, #15) to leads who've engaged with TOFU/MOFU content |
| **Webinar** | Live walkthrough | "How a Feature Ships" series (#16–#20) with a real project |

---

## Short-form social companions

Each companion post follows this structure:

1. **Hook** (1 sentence) — the problem or surprising fact that stops the scroll
2. **Insight** (3–5 sentences) — the one key takeaway from the long-form, written to stand alone
3. **Proof point** (1–2 sentences) — a specific DevAudit mechanism, a regulation clause, or a real-world outcome
4. **Link** — "Read the full article → devaudit.ai/blog/[slug]" (always the blog canonical URL)

### Writing rules

- **No thread-bait.** The short-form delivers value without requiring the click. The long-form delivers *more* value, not the *only* value.
- **Platform-native tone.** LinkedIn: professional, first-person perspective, no hashtag spam (max 3). Dev.to: technical, code-block-friendly, show don't tell. X: punchy, one-insight-per-tweet.
- **Persona-appropriate voice.** CISO/Compliance posts reference regulation clauses and audit scenarios. Developer posts reference CLI commands, code patterns, and workflow friction. CTO posts reference architecture decisions and scaling trade-offs.
- **Always link the canonical.** Social posts drive traffic to devaudit.ai/blog, not to Dev.to reposts. Dev.to reposts set `canonical_url` to the blog.

### Short-form companion briefs

---

#### #1s: EU AI Act — The Deadline Your Engineering Team Doesn't Know About

**Long-form parent:** Article 1 — The EU AI Act Hits Code in August 2026
**Platform:** LinkedIn
**Hook:** "Your AI coding agents are AI systems under the EU AI Act. August 2026 is the enforcement deadline. How's your technical documentation?"
**Insight:** Most security teams are focused on AI products (chatbots, recommendation engines) while the AI tools writing production code fly under the radar. Art. 11 requires technical documentation of the AI system's development lifecycle — and a `Co-Authored-By` commit tag is not that documentation.
**Proof point:** DevAudit auto-generates `ai-use-note.md` per requirement, records the human-AI interaction in `ai-prompts.md`, and enforces disclosure via commitlint. The /compliance page maps every SDLC artefact to the specific EU AI Act article it satisfies.
**CTA:** "Full breakdown → devaudit.ai/blog/eu-ai-act-hits-code"

---

#### #2s: One Prompt. Five Stages. Audit-Ready.

**Long-form parent:** Article 2 — The Agentic SDLC
**Platform:** LinkedIn
**Hook:** "`> Implement issue #47 under the SDLC.` — one prompt drives an AI agent through plan, implement, test, evidence, and review. The human enters at the approval gate."
**Insight:** 2025 was autocomplete. 2026 is the AI agent running your entire SDLC — planning, branching, testing, compiling evidence, opening the PR. The question isn't whether to adopt agentic development; it's where automation ends and human judgment begins.
**Proof point:** DevAudit ships six AI skills with defined contracts. The orchestrator (`sdlc-implementer`) delegates to five specialists. Same SDLC whether you use Claude Code, Cursor, Windsurf, or Gemini CLI.
**CTA:** "Read the manifesto → devaudit.ai/sdlc"

---

#### #3s: Your AI Agent Just Passed Your SOC 2 Audit. Should It Have?

**Long-form parent:** Article 3 — SOC 2 and Segregation of Duties
**Platform:** LinkedIn
**Hook:** "CC8.1 addresses controls over changes to systems. When the same AI writes the code AND generates the test evidence, the change-management chain becomes harder to evidence. The 'segregation' is between a human and their tool — auditors may not accept that as meaningful separation."
**Insight:** Dual approval supports segregation-of-duties and change-management objectives under CC8.1. The `Co-Authored-By` tag is attribution; the four-eyes gate (`dual_actor` mode) is one concrete implementation. Neither is a SOC 2 mandate, but both strengthen the control environment.
**Proof point:** `approval.mode: dual_actor` in `sdlc-config.json`, enforced server-side by `check-release-approval.yml`. The portal records `approver_user_id != release_creator_user_id` immutably.
**CTA:** "See the SOC 2 mapping → devaudit.ai/compliance"

---

#### #4s: The AI Was Productive. It Just Wasn't Compliant.

**Long-form parent:** Article 4 — Vibe Coding Broke My CI Pipeline
**Platform:** Dev.to, X (thread)
**Hook:** "An AI agent wrote 12 test files. CI passed. Tests green. The compliance portal showed zero evidence. The release reached UAT with nothing for the reviewer to review."
**Insight:** The agent pushed to a branch whose PR was already merged. Then it suggested cherry-picking orphaned commits. Root cause: no scope guard, no branch-state check, no evidence-wiring validation. The AI did its job — but nobody told it what job to do.
**Proof point:** DevAudit's `e2e-test-engineer` skill owns test authoring with mandatory `evidenceShot()` calls per AC. The orchestrator skill cannot inline specs. Structural separation, not policy you have to remember.
**CTA:** "Full post-mortem → devaudit.ai/blog/vibe-coding-broke-ci"

---

#### #5s: The Number That Should Worry Your Board

**Long-form parent:** Article 5 — 60% Have No AI Governance Framework
**Platform:** LinkedIn
**Hook:** "60% of enterprises have no formal AI governance framework. The EU AI Act enforcement deadline is August 2026. The SOC 2 auditor is asking about AI controls now."
**Insight:** The cost isn't the fine — it's the six months of scramble when the auditor asks how you govern AI-generated code and you don't have an answer. Building governance in-house means building an evidence portal, an approval engine, a CI integration layer, and a standards-mapping database.
**Proof point:** DevAudit is the governance framework that ships as `npx install` — not a 6-month consulting engagement. The framework is open-source (Apache 2.0); the portal that holds the proof is the product.
**CTA:** "Tell us about your SDLC → devaudit.ai/onboarding"

---

#### #6s: Can You Prove Which Code Your AI Wrote?

**Long-form parent:** Article 6 — Immutable Audit Trails for AI-Generated Code
**Platform:** LinkedIn
**Hook:** "Your auditor asks: 'Which code in this release was AI-generated, and who reviewed it?' If you can't answer in under 30 seconds, you have an audit trail problem."
**Insight:** DevAudit's portal renders a human/AI split per release. `Co-Authored-By` trailers are enforced by commitlint (not optional). Evidence is append-only — iteration N adds, never replaces. The SHA comparison detects code changes after approval.
**Proof point:** The portal's release detail page shows: who wrote what, who approved what, when evidence was uploaded, and by which CI run. The auditor sees this without touching source code.
**CTA:** "See the evidence model → devaudit.ai/sdlc"

---

#### #7s: Your Git Repo Doesn't Need 50MB of Playwright Traces

**Long-form parent:** Article 7 — Separating Code from Evidence
**Platform:** Dev.to
**Hook:** "A single Playwright run: 5MB HTML report, 50MB+ trace ZIPs, 200KB × 30 screenshots, 15MB coverage. Multiply by 5 releases/week. Your `git clone` takes 4 minutes."
**Insight:** Git is for text diffs. Binary evidence kills clone times, bloats CI caches, and makes `git log` unusable. DevAudit puts markdown docs in Git (reviewable in PR diffs) and binary evidence in the portal (permanent, searchable, scoped). Both keyed to the same REQ-XXX.
**Proof point:** The /sdlc page's "Three tiers, two upload paths" architecture: operator-uploaded high-judgement content + CI-auto-uploaded per-event artefacts. No workarounds, no Git LFS.
**CTA:** "Read the architecture → devaudit.ai/blog/separating-code-from-evidence"

---

#### #8s: Your Compliance Officer Spends 40 Hours Preparing for an Audit. It Should Be 4.

**Long-form parent:** Article 8 — From 40 Hours to 4
**Platform:** LinkedIn
**Hook:** "Before: chase developers for screenshots, export test reports from Jenkins, manually cross-reference SAST findings, assemble in SharePoint, email to auditor. After: CI uploads everything. The portal organises it. The auditor browses self-service."
**Insight:** A single SAST scan in DevAudit generates evidence for ISO 27001 vulnerability management, SOC 2 system monitoring, GDPR security of processing, and EU AI Act transparency — one check, five frameworks.
**Proof point:** The /compliance page: "One gate, multiple frameworks." DevAudit automates evidence *collection*, not evidence *judgment*. Human input stays where it should: risk classification, acceptance criteria, approval clicks.
**CTA:** "See the standards coverage → devaudit.ai/compliance"

---

#### #9s: 15 Minutes to Your First Compliant Release

**Long-form parent:** Article 9 — DevAudit in 15 Minutes
**Platform:** Dev.to, X (thread)
**Hook:** "`export DEVAUDIT_USER_TOKEN=\"...\" && npx @metasession.co/devaudit-cli@latest install ../your-project` — 11 steps, automated. Token → stack detection → config → project registration → secrets → hooks → branch protection → templates → done."
**Insight:** The CLI detects your tech stack from `package.json`, prompts to confirm adapters (Next.js / Express / FastAPI; Railway / Vercel / Render), and writes `sdlc-config.json`. Push to `develop` — first CI run uploads evidence to the portal. Your first REQ ships compliant.
**Proof point:** The framework + CLI are Apache 2.0. The /onboarding page lists three paths in: install, update, join. No demo wall, no gated access.
**CTA:** "Sign in and get a token → devaudit.ai/auth/sign-in"

---

#### #10s: "Approved" Doesn't Mean "Same Person Approved Their Own Work"

**Long-form parent:** Article 10 — The Four-Eyes Gate
**Platform:** LinkedIn
**Hook:** "The Release Approval Gate blocks merge until a person *who isn't the committer* approves on the portal. Server-side enforcement, not honour-system."
**Insight:** Three modes: `dual_actor` (recommended), `auto_low_risk` (LOW auto-approves; MEDIUM/HIGH require human), `solo_with_gap` (solo devs — documented control gap visible to auditor). The reviewer can Request Changes → the agent enters the iteration loop → max 5 rounds → re-review. Scope creep halts the agent.
**Proof point:** The homepage live feed: "PR #347 approved — Four-eyes complete · UAT signed." That's real-time. The gate stays red until approval is recorded.
**CTA:** "Read the manifesto → devaudit.ai/sdlc"

---

#### #11s: EU AI Act Art. 11: Here's What DevAudit Generates. Here's What You Still Write.

**Long-form parent:** Article 11 — EU AI Act Art. 11 Technical Documentation
**Platform:** LinkedIn
**Hook:** "Art. 11 requires: AI system description, development methodology, testing results, risk management measures. DevAudit auto-generates five of these per requirement. You write three at the company level."
**Insight:** The /compliance page lists five mapped EU AI Act controls: Human Oversight, Tool Governance, Transparency & Audit Trail, Risk Elevation, Regeneration Protocol. Each maps to a specific SDLC artefact. What you still own: the company-level AI system register, the DPIA, and the human oversight procedures — templates provided.
**Proof point:** AI involvement raises risk classification by one level for MEDIUM/HIGH. That's automatic. More testing, more review — because the regulation says so.
**CTA:** "Full standards mapping → devaudit.ai/compliance"

---

#### #12s: "We'll Build It Ourselves" — A Pricing Exercise

**Long-form parent:** Article 12 — DevAudit vs. Building It Yourself
**Platform:** LinkedIn
**Hook:** "You're not building a CI script. You're building an evidence portal, an approval workflow engine, a CI integration layer, a standards-mapping database, per-requirement traceability, iteration tracking, and auditor access controls."
**Insight:** The hidden cost isn't the build — it's the maintenance. Every CI provider change breaks your scripts. Auditors question bespoke formats. You can't see what changed between review cycles. DevAudit's framework updates with `devaudit update`; the portal is purpose-built.
**Proof point:** The /onboarding page says: "The framework is open-source. Read it first if you prefer." No sales objection. Read the code, then decide.
**CTA:** "Tell us about your SDLC → devaudit.ai/onboarding"

---

#### #13s: From SharePoint Evidence Packs to Portal Evidence in 4 Phases

**Long-form parent:** Article 13 — Migrating from Manual Evidence Collection
**Platform:** Dev.to
**Hook:** "Phase 1: `devaudit install` on one project. Phase 2: add `evidenceShot()` calls to existing e2e tests. Phase 3: onboard remaining projects. Phase 4: give your auditor portal access."
**Insight:** The most common gotcha: existing tests without REQ annotations. The portal shows zero evidence because nothing is keyed to a requirement. The fix is structural — add `Ref: REQ-XXX` trailers and `evidenceShot()` calls — not a config change.
**Proof point:** Three CLI commands cover the full lifecycle: `install` (new project), `update` (pull latest framework), `join` (add a teammate). The /onboarding page mirrors these three paths.
**CTA:** "Get started → devaudit.ai/onboarding"

---

#### #14s: Your Auditor Doesn't Need Your Developer's Time

**Long-form parent:** Article 14 — Giving Your Auditor Portal Access
**Platform:** LinkedIn
**Hook:** "Create a scoped, read-only auditor account. They browse evidence by project, requirement, release, and type — self-service. No developer hand-holding. No email chains."
**Insight:** What the auditor sees: the release-completeness matrix (✓/✗ per evidence category), the evidence-by-requirement drill-down, timestamped CI upload records. What they don't see: source code, CI secrets, developer chat transcripts.
**Proof point:** The /sdlc page describes the portal as: "Project registry, immutable evidence storage, release-approval lifecycle, four-eyes approval, auditor dashboards, time-limited share links." Every word is an auditor-facing feature.
**CTA:** "See the portal → devaudit.ai/compliance"

---

#### #15s: How DevAudit Earns Trust at the Infrastructure Level

**Long-form parent:** Article 15 — DevAudit's Security Model
**Platform:** LinkedIn
**Hook:** "Evidence is generated by GitHub Actions (tamper-resistant infrastructure), not by the developer's local machine. The portal trusts CI-uploaded evidence over manually uploaded evidence."
**Insight:** Project-scoped API keys (one project, one key). `dual_actor` enforced server-side. Append-only evidence store. The Release Approval Gate is a required status check on the PR — removing it requires branch-protection admin access. And honestly: DevAudit is not a SIEM, not an AI safety product, not a replacement for code review. Scoped claims, verifiable.
**Proof point:** The /sdlc page's "What DevAudit is not" section. Six disclaimers, up front. That's how you earn trust.
**CTA:** "Tell us about your SDLC → devaudit.ai/onboarding"

---

#### #16s–#20s: How a Feature Ships (series teaser)

**Long-form parents:** Articles 16–20 (5-part workflow series)
**Platform:** LinkedIn (#19), Dev.to (#16, #17, #18, #20)
**Hook (series launch):** "We're publishing a 5-part series that follows one feature from GitHub issue to production. Every stage. Every artefact. Every gate. Here's Part 1."
**Per-part hooks:**
- **Part 1:** "Before a single line of code: risk classification, RTM entry, implementation plan, threat model, test scope. All committed to Git."
- **Part 2:** "Write failing tests first. Delegate e2e to the specialist skill. Capture `evidenceShot()` at the assertion level, not the suite level."
- **Part 3:** "Two CI workflows, no duplication. Markdown in Git, binaries in the portal. Both keyed to the same REQ and release version."
- **Part 4:** "The merge gate stays red until a human who isn't the committer approves on the portal. Change requests enter a max-5 iteration loop."
- **Part 5:** "Merge, post-deploy smoke, production approval. The traceability chain: Issue → REQ → Plan → Tests → Evidence → UAT → PR → Prod → Released."
**CTA (each):** "Full walkthrough → devaudit.ai/blog/how-a-feature-ships-part-N"

---

#### #21s: The AI Agent Has Write Access to Your Production Pipeline

**Long-form parent:** Article 21 — The AI Agent Attack Surface
**Platform:** LinkedIn, X
**Hook:** "A compromised AI agent with `git push` access can push malicious code that CI will test, evidence-package, and present for human approval. The human is now reviewing AI-generated evidence about AI-generated code."
**Insight:** The four-eyes gate is the last line of defence. The scope guard prevents the agent from exceeding its mandate. The SHA comparison detects post-approval changes. The immutable audit trail enables post-hoc investigation. DevAudit is not an AI safety product — but the SDLC governance layer that bounds and attributes AI actions.
**Proof point:** The /sdlc page: "Not an AI safety product — pair with Guardrails / Lakera / Anthropic safety stack for that." Scoped claim. Different market. But the SDLC controls are the complementary layer.
**CTA:** "Read the full analysis → devaudit.ai/blog/ai-agent-attack-surface"

---

#### #22s: ISO 29119 Was Written for Humans. Your AI Writes the Tests Now.

**Long-form parent:** Article 22 — ISO 29119 Meets Agentic AI
**Platform:** LinkedIn
**Hook:** "ISO 29119 §5.4 requires independence between test design and implementation. When the same AI writes code and tests, that independence requires structural separation — not just different prompts."
**Insight:** DevAudit's answer: the orchestrator skill cannot author e2e specs. The `e2e-test-engineer` skill owns test authoring end-to-end — different skill context, different system prompt, different contract. CI re-execution provides independent infrastructure verification.
**Proof point:** The /compliance page maps DevAudit's full ISO 29119 artefact hierarchy: Test Policy → Test Strategy → Test Plan → Test Case Spec → Execution Logs → Traceability Matrix → Completion Report.
**CTA:** "See the ISO 29119 mapping → devaudit.ai/compliance"

---

#### #23s: Your Git Repo Is Getting Fatter. Here's Why.

**Long-form parent:** Article 23 — The Binary Bloat Problem
**Platform:** Dev.to, X
**Hook:** "Playwright HTML report: 5MB. Trace ZIPs: 50MB+. Per-REQ screenshots: 200KB × 30. Coverage: 15MB. Per release. 5 releases/week. Your `.git` directory is now 2GB."
**Insight:** Git LFS adds complexity. `.gitignore` loses traceability. Separate repos fragment the audit trail. DevAudit keeps markdown in Git and binaries in the portal. Both keyed to REQ-XXX. Clean repo, complete evidence.
**Proof point:** The /sdlc page: "Three tiers, two upload paths." Operator-uploaded policy docs refresh on human review; CI-auto-uploaded per-event artefacts flow automatically.
**CTA:** "Read the full piece → devaudit.ai/blog/binary-bloat-problem"

---

#### #24s: Stop Prompting. Start Delegating.

**Long-form parent:** Article 24 — AI Skills vs. AI Prompts
**Platform:** Dev.to, X
**Hook:** "'Write e2e tests for this feature' → tests in whatever style, no REQ annotations, no evidence hooks. 'Skill(e2e-test-engineer)' → 7-phase workflow, `evidenceShot()` per AC, self-audit, density policy."
**Insight:** Skills compose (orchestrator delegates to specialists), skills enforce (evidence-wiring validation), skills evolve (update once via `devaudit update`, every project inherits). The trade-off: skills are opinionated. Most teams benefit more from a good default than from total flexibility.
**Proof point:** Six skills ship with DevAudit: sdlc-implementer, e2e-test-engineer, governance-doc-author, requirements-aligner, adr-author, risk-register-keeper. Each has a `SKILL.md` with explicit "WILL NOT do" invariants.
**CTA:** "Read the skills overview → devaudit.ai/blog/ai-skills-vs-prompts"

---

#### #25s: What Actually Changes When You Adopt DevAudit

**Long-form parent:** Article 25 — The Developer's Day with DevAudit
**Platform:** Dev.to
**Hook:** "Still your IDE. Still Git. Still PRs. What changes: commits need `Ref: REQ-XXX` trailers (commitlint enforces it), and the AI handles the compliance boilerplate you used to skip."
**Insight:** LOW-risk overhead: ~5 min planning, ~0 min evidence (CI handles it), ~2 min portal. HIGH-risk: ~20 min planning (with human checkpoint), ~10 min evidence review, ~5 min portal. What developers like: never chasing compliance officers. What they push back on: the scope guard halting when they want to "just add one more thing."
**Proof point:** The release playbooks on GitHub walk a low-risk and a high-risk release end-to-end — written twice: once for AI-driven, once manual.
**CTA:** "Read the full day-in-the-life → devaudit.ai/blog/developer-day-with-devaudit"

---

#### #26s: What Your Auditor Sees When You Give Them Portal Access

**Long-form parent:** Article 26 — The Auditor's View
**Platform:** LinkedIn
**Hook:** "Project list → releases → evidence-by-requirement → completeness matrix (✓/✗). The auditor's first question — 'Is the evidence complete?' — is answered before they ask it."
**Insight:** The auditor can verify independently: CI ran on GitHub's infrastructure (linked workflow runs), approval was by a different user than the committer, evidence was uploaded by CI not manually. Time-limited share links for external auditors who don't need persistent accounts.
**Proof point:** The portal's append-only audit log shows every upload, approval, and status change with timestamps and user IDs. 7-year evidence retention. 3-year audit log retention.
**CTA:** "See the standards coverage → devaudit.ai/compliance"

---

#### #27s: From Pilot to Org-Wide in Three Phases

**Long-form parent:** Article 27 — Onboarding Your Engineering Team
**Platform:** LinkedIn
**Hook:** "Phase 1: one project, one team, `devaudit install`. Phase 2: remaining projects, standardised config. Phase 3: `devaudit update` when the framework ships. The `join` command for new teammates — no API key rotation."
**Insight:** The /onboarding page's positioning: "No two SDLCs are the same. DevAudit is opinionated about WHAT evidence auditors expect; flexible about HOW your team produces it." The onboarding conversation is 30 minutes on your decisions, not introductions.
**Proof point:** Agent-agnostic: Claude Code ships native skills; Cursor/Windsurf/Gemini CLI get drop-in rule files; any other agent reads `INSTRUCTIONS.md` directly. No lock-in on the AI side.
**CTA:** "Tell us about your SDLC → devaudit.ai/onboarding"

---

#### #28s: Three Config Decisions That Define Your Compliance Posture

**Long-form parent:** Article 28 — Configuring DevAudit for Your Risk Appetite
**Platform:** LinkedIn
**Hook:** "1. `approval.mode` — who can approve. 2. `uat.required_risk_classes` — what gets UAT-verified. 3. Risk classification criteria — what counts as HIGH. Three decisions in `sdlc-config.json` that your auditor will ask about."
**Insight:** `dual_actor` vs `auto_low_risk` vs `solo_with_gap` — each has specific compliance implications. AI involvement raises risk by one level. `periodic-review.yml.template` auto-generates review issues on a configurable cadence for ongoing compliance, not just release-time.
**Proof point:** `sdlc-config.json` is committed to Git — reviewable in PR diffs, not hidden in a settings UI. Every config decision has an audit trail.
**CTA:** "Full configuration guide → devaudit.ai/blog/configuring-risk-appetite"

---

## SEO keyword targets

| Cluster | Primary keywords | Articles |
|---------|-----------------|----------|
| EU AI Act compliance | eu ai act software development, ai act technical documentation, ai act august 2026 deadline | #1, #11, #21 |
| SOC 2 AI governance | soc 2 ai agents, soc 2 segregation of duties ai, ai audit trail | #3, #6, #15 |
| Agentic SDLC | agentic sdlc, ai coding agent governance, ai software development lifecycle | #2, #24, #25 |
| Compliance automation | automated evidence collection ci/cd, compliance automation developer, audit evidence automation | #8, #14, #26 |
| DevAudit specific | devaudit, devaudit.ai, devaudit install, devaudit vs, compliance evidence portal | #9, #12, #13 |

---

## CTA routing table

Every article ends with one primary CTA that routes to a devaudit.ai page. This ensures consistent conversion paths.

| Article | Primary CTA destination | Conversion intent |
|---------|------------------------|-------------------|
| #1, #3, #8, #11 | [devaudit.ai/compliance](https://devaudit.ai/compliance) | Standards-curious → see what's covered |
| #2, #6, #10 | [devaudit.ai/sdlc](https://devaudit.ai/sdlc) | Architecture-curious → read the manifesto |
| #4, #13 | [devaudit.ai/onboarding](https://devaudit.ai/onboarding) | Problem-aware → try the product |
| #5, #12, #15 | [devaudit.ai/onboarding](https://devaudit.ai/onboarding) | Decision-stage → book a conversation |
| #9 | [devaudit.ai/auth/sign-in](https://devaudit.ai/auth/sign-in) | Ready to start → issue a token now |
| #14, #26 | [devaudit.ai/compliance](https://devaudit.ai/compliance) | Auditor-adjacent → see what the portal shows |
| #16–#20 | [devaudit.ai/sdlc](https://devaudit.ai/sdlc) | Workflow-interested → read the full manifesto |
| #21, #22, #23, #24 | [devaudit.ai/sdlc](https://devaudit.ai/sdlc) | Thought-leadership → understand the product philosophy |
| #25, #27, #28 | [devaudit.ai/onboarding](https://devaudit.ai/onboarding) | Role-specific → start the adoption conversation |

---

## Internal linking strategy for devaudit.ai/blog

Each article published on the blog should include:

1. **Header nav links** — The site nav already has: The SDLC · Standards coverage · Sign in. Blog articles inherit this.
2. **In-body links to other articles** — At least 2 cross-references to other articles in the series (builds session depth and SEO internal link equity).
3. **GitHub "read the source" links** — For developer-persona articles, link directly to the relevant framework source file on GitHub. This builds trust ("we're not hiding anything") and reinforces the open-source-first positioning.
4. **End-of-article "Related" section** — 3 related articles, chosen to advance the reader down the funnel (TOFU → MOFU → BOFU).
5. **Sidebar CTA** — Persistent on all articles: the `npx install` command block + "Sign in to issue a token" link, matching the homepage and /onboarding page pattern.
