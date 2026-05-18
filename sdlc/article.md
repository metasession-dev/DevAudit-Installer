# Building a Compliance-Grade Software Development Pipeline for the Age of AI-Assisted Coding

_How a small team built a tiered documentation system, automated security gates, and workflow-driven compliance pipeline that satisfies ISO 29119, ISO 27001, and emerging AI governance requirements — without drowning in paperwork._

---

## The Problem No One Has Solved Cleanly Yet

Software compliance has always been about proving that what you shipped was built correctly, tested thoroughly, and reviewed by a human who understood what they were approving. The documentation burden is real but manageable: write a test plan, maintain a traceability matrix, keep your evidence, get someone to sign off.

Then AI started writing the code.

Not all of it. Not even most of it, in many teams. But enough that the fundamental assumptions behind compliance frameworks started to crack. When an AI generates a function, who is accountable for its correctness? When it suggests a dependency, how do you know the package actually exists? When you reprompt and get a different implementation of the same feature, how do you prove the second version is equivalent to the first?

These aren't hypothetical concerns. Regulatory bodies are beginning to provide guidance, and the core message is blunt: you are responsible for the code, regardless of who or what wrote it. The EU AI Act is adding disclosure requirements for AI-built systems in high-risk categories. ISO 27001 auditors want to see that your SDLC explicitly addresses AI tooling. And the informal, iterative, low-documentation nature of how most developers use AI is the opposite of what compliance requires.

The question isn't whether you can use AI and still be compliant. You can. The question is what the framework looks like that makes it work without turning every feature into a bureaucratic ordeal.

This article describes one answer. It's not the only answer, but it's a complete, working system built from first principles and tested against real compliance requirements.

---

## What We Built

Over a series of iterations, we developed a two-tier documentation system with a workflow-driven development pipeline that handles everything from requirement planning through production deployment, with AI governance built into every stage.

The system consists of 12 documents across two tiers, a GitHub Actions CI pipeline for independent verification, and five operational workflows that a developer (or an AI assistant working alongside a developer) follows for every change.

### The Tiered Structure

The first insight was that compliance documentation has two distinct layers that most teams accidentally merge into one: universal standards that apply regardless of what you're building, and project-specific details that change with every product.

**Tier 1** contains four documents that never reference a specific project:

The **Test Policy** defines why the organization tests, what it commits to, and who is accountable for what. This is where AI governance lives at the policy level — the permitted tools, the mandatory controls, the accountability chain. It states plainly that the human who commits AI-generated code is responsible for it, and that "the AI wrote it" is not an acceptable answer to an auditor.

The **Test Strategy** defines how testing is approached methodically. Testing levels (unit through acceptance), security testing methodology (per-commit SAST and dependency scanning, per-release access control and audit log verification, periodic penetration testing), AI-assisted development testing protocol (risk classification, human review requirements, the regeneration retest rule), verification vs. validation, defect management, traceability, and evidence requirements. It references tools by category ("SAST tool") but never names a specific product.

The **Test Architecture** defines what tests are built with. Specific tools and versions (Playwright, Jest, Semgrep, Snyk), directory structures, design patterns (Page Object Model, fixtures, factories), ESLint and Prettier configurations, CI pipeline stage specifications, artifact storage and retention policies, code style and naming conventions. This is the document an engineer opens when setting up test infrastructure.

The **Periodic Security Review Schedule** defines the recurring security activities that happen on a calendar rather than per-feature: quarterly SAST reviews, dependency deep audits, access control reviews, and audit log integrity checks; annual penetration testing, disaster recovery testing, and third-party security assessments.

The critical design decision was giving each document a single, non-overlapping responsibility. The Policy says "we will run SAST on every commit." The Strategy says "SAST is a mandatory gate that blocks merge on high/critical findings." The Architecture says "use Semgrep with auto config." No content appears in two places. When something changes, you update one document, not three.

**Tier 2** contains the project-specific documents: a Test Plan with concrete environment details, test suite counts, and exit criteria; five operational workflow files; a project setup guide; and a deployment reference. When you start a new project, you copy Tier 2 and customize it. Tier 1 stays untouched.

---

## The Six Workflows

The operational heart of the system is six documents that the developer follows sequentially. These aren't guidelines or reference material — they're executable procedures with specific commands, file paths, and decision points.

### Workflow 0: Project Setup (Run Once)

Before any development work begins, this workflow configures the repository, branch protection, CI pipeline, compliance directories, and local tooling. The key output is the GitHub Actions workflow file that implements the independent verification gate.

This solved a problem that emerged during development: the five per-feature workflows assume CI is already configured. Without a setup workflow, teams would either skip CI configuration (creating a compliance gap) or configure it inconsistently across projects. Making it workflow 0 — an explicit, documented, one-time step — ensures every project starts with the same infrastructure.

The setup guide includes the complete GitHub Actions YAML with `# UPDATE` markers for project-specific values (Node version, source directory, database service, seed script, environment variables). A developer customizes the markers and has a working CI pipeline.

### Workflow 1: Plan Requirement

Before writing any code, the developer defines the requirement in the RTM, classifies its risk level, and generates a test scope document.

The risk classification is the decision that governs everything downstream. Low risk (internal tools, no regulated data) gets standard gates and minimal documentation. Medium risk (PII, user-facing features, API changes) adds targeted security testing and validation. High risk (authentication, payments, RBAC) requires full verification and validation, independent review, and penetration testing consideration.

AI involvement raises risk by one level when the code touches Medium or High categories. This isn't punitive — it reflects the empirical reality that AI-generated code introduces injection vulnerabilities, insecure defaults, and hallucinated dependencies at higher rates than careful human development.

The test scope document is generated proportionally to risk. For Low risk, it's a few lines: standard gates plus acceptance criteria. For Medium, it's half a page: standard gates plus specific testing items (which endpoints need access control verification, which actions need audit log testing), a validation approach, and acceptance criteria. For High, it's a full page with security testing detail, independent review planning, and business workflow validation.

The critical compliance point: this document exists before implementation begins. It's evidence of planned testing, not retroactive documentation. An auditor can see that the testing approach was determined before the code was written.

### Workflow 2: Implement and Test

The development loop: code, commit, run all gates, fix, repeat. Every commit on `develop` must leave all gates green.

The mandatory gates are TypeScript compilation, SAST scanning (Semgrep), dependency auditing (`npm audit`), and the full E2E test suite. These run locally on the developer's machine during implementation, providing comprehensive evidence.

For AI-assisted work, the developer logs significant prompts and outputs to the evidence directory (proportional to risk level), and flags any component regenerations. The regeneration protocol is one of the system's more nuanced rules: if you ask the AI to generate a component from scratch a second time (rather than incrementally editing the first output), that triggers a full retest of the component and its dependents. You can't assume two AI outputs for the same prompt are functionally equivalent.

### Workflow 3: Compile Evidence

After implementation and testing, this workflow gathers all compliance artifacts: test results, SAST scan output, dependency audit results, security summary, AI use documentation, and the release ticket. It updates the RTM status and verifies that every item in the test scope (from workflow 1) has been addressed.

The release ticket template includes sections for AI involvement (which tool, which files, who reviewed the AI code, any regenerations), dependency changes (with vulnerability status), and a reviewer checklist that goes beyond code quality into security and compliance verification.

### Workflow 4: Submit for Review

Creating the PR triggers two things simultaneously: GitHub Actions runs the independent verification pipeline (TypeScript, SAST, dependency audit, unauthenticated E2E tests), and the human reviewer is notified.

This is where the two-source evidence model comes together. The developer's local evidence (in the compliance directory) proves comprehensive testing was performed. The CI evidence (in GitHub Actions logs and artifacts) proves it independently — produced by GitHub's infrastructure, not by the developer. The human reviewer sees both before making their decision.

The PR checklist explicitly includes test scope verification: the reviewer confirms the test scope document exists, the risk classification is appropriate, the testing depth matches the risk level, and all items in the scope were addressed. This catches the case where the AI under-classifies risk or under-specifies the test scope.

Branch protection prevents merging until CI passes. This is enforced by GitHub, not by team discipline.

### Workflow 5: Deploy to Main

After approval, the PR is merged (creating a merge commit that preserves the full audit trail), the hosting platform auto-deploys, and the developer performs post-deploy verification: health check, smoke test, and security verification (access control enforcement, security headers, no exposed stack traces).

The compliance artifacts are finalized: the release ticket moves from `pending-releases/` to `approved-releases/`, the RTM is updated to `APPROVED - DEPLOYED`, and the audit trail records every step from requirement to production.

---

## The AI Governance Model

The system's approach to AI governance is designed around a specific insight: AI-generated code doesn't need different testing — it needs more disciplined testing, applied consistently. The controls are:

**Accountability is non-transferable.** The Test Policy states it plainly: the human who commits the code is responsible for it. The reviewer who approves it shares that responsibility. This isn't a legal novelty — it's the same principle that applies to code from any source. But making it explicit in the policy prevents the "the AI wrote it" excuse from entering the culture.

**Human review is a formal compliance gate, not just good practice.** Every piece of AI-generated code must be reviewed by a qualified human before entering the test pipeline. "Qualified" means the reviewer understands the domain. The review is logged through the PR approval process — who reviewed it, when, and their decision.

**Risk classification accounts for AI involvement.** AI-generated code touching security-sensitive areas raises the risk level by one tier. This increases the review depth, testing requirements, and documentation burden proportionally.

**Regeneration triggers retest.** The non-determinism of AI output means you can't assume two generations of the same feature are equivalent. The system treats regeneration as a distinct event requiring full retesting, not an edit that follows standard gates.

**Documentation scales with risk.** Low-risk AI-assisted work needs only a `Co-Authored-By` commit tag. Medium risk adds a summary in the evidence directory. High risk requires detailed prompt and output retention. This avoids the trap of requiring full AI transcripts for every trivial change while ensuring the audit trail is robust where it matters.

**Permitted tools are explicit.** The Test Policy maintains a table of approved AI tools with their permitted uses and restrictions. Adding a new tool requires Engineering Leadership approval and policy updates. This prevents shadow AI usage from creating compliance blind spots.

---

## The Independent Verification Gate

One of the system's most important features emerged from a practical question: if a single developer is writing, testing, and committing code, where is the independent verification?

Running all tests locally means the developer produces all the evidence. An auditor has to trust that the tests ran against the actual code and the results weren't modified. That's a trust-based model.

Adding CI changes it to an evidence-based model. GitHub Actions runs TypeScript compilation, SAST scanning, dependency auditing, and the unauthenticated E2E test subset automatically on every PR. These results are produced by GitHub's infrastructure and recorded in GitHub's logs. The developer can't modify them.

The two evidence sources serve different purposes:

**Local testing** (developer machine) is the comprehensive gate. All tests, all security scans, the full suite. This is where defects are found and fixed.

**CI testing** (GitHub Actions) is the independent verification gate. A subset that provides tamper-resistant proof. This is what the auditor trusts.

Branch protection ties them together: the PR cannot merge unless CI passes. The human reviewer sees both sources — local evidence in the compliance directory and CI evidence in the PR checks — and approves based on the combination.

---

## What an Auditor Sees

When an auditor examines a change that went through this pipeline, they find a complete chain of evidence:

The **RTM** shows the requirement was defined with a risk classification before implementation began. The **test scope** document, timestamped before the first implementation commit, proves testing was planned, not retroactive. The **commit history** shows incremental development with requirement references and `Co-Authored-By` tags for AI involvement. The **compliance evidence directory** contains SAST scan results (JSON), dependency audit results (JSON), E2E test results, a security summary, and AI use documentation.

The **PR** shows the complete reviewer checklist, the CI check results (independent of the developer), the reviewer's approval with their identity and timestamp (recorded immutably by GitHub), and the compliance artifacts in the changed files. The **release ticket** in `approved-releases/` shows the full audit trail from requirement creation through deployment verification.

For AI-assisted changes, the auditor additionally finds: which AI tool was used, which files it generated, who reviewed the AI output, whether any components were regenerated (and whether retesting was performed), and — for Medium/High risk — the prompts and outputs that produced the code.

The chain is unbroken: requirement → planned test scope → implementation → comprehensive local testing → compiled evidence → independent CI verification → human review → deployment → post-deploy verification → finalization. Every link is documented and traceable.

---

## Compliance Framework Coverage

The system maps to specific compliance framework requirements:

**ISO/IEC/IEEE 29119-3** (Test Documentation): The tiered document structure directly implements the standard's artifact hierarchy. Test Policy, Test Strategy, Test Plan, Test Case Specifications (BDD feature files), Test Execution Logs (CI and local evidence), and Test Completion Reports (release tickets) are all present and correctly scoped.

**ISO 27001** (Information Security): Change control and traceability through the PR-based approval gate. Vulnerability management through per-commit SAST and dependency scanning plus periodic penetration testing. Access control testing as a per-release and quarterly activity. Audit log verification on the same schedule. Evidence retention (minimum 3 years) documented and implemented through Git history plus artifact storage.

**GDPR**: Test data privacy controls (no production PII in non-production environments, synthetic data generation). Data subject rights testing (access, rectification, erasure, portability, objection) included in test scope templates for relevant changes. Privacy by design testing built into the Medium/High risk test scope.

**EU AI Act preparedness**: AI tool documentation, human oversight integrated into the development process, prompt and output retention providing the basis for conformity assessment if required. The Test Policy explicitly addresses high-risk classification and its implications.

**SOC 2**: System monitoring (quarterly SAST + audit log review), logical access (quarterly access control review), change management (per-feature pipeline + quarterly reviews) map to CC7.1, CC6.1, and CC8.1 respectively.

---

## What Makes This Different

Most compliance frameworks for AI-assisted development fall into one of two traps: they're either so lightweight they don't satisfy auditors, or so heavy they make AI assistance counterproductive.

This system avoids both by making documentation proportional to risk. A Low-risk change (a UI tweak, a config update) goes through the same pipeline but produces minimal documentation — a commit tag, standard gate results, a brief PR. The overhead is negligible. A High-risk change (modifying authentication logic with AI assistance) produces a full test scope, detailed AI use documentation, independent security review, and comprehensive evidence. The overhead is significant but justified.

The workflow-driven approach means compliance isn't a separate activity bolted onto development — it's the development process itself. You don't "do compliance" after you finish coding. The compliance artifacts are natural outputs of the workflow steps you're already following.

The tiered document structure means you don't rewrite your compliance framework for every project. Tier 1 is written once and applies to everything. Tier 2 is customized per project from templates. Starting a new project means running the setup workflow, filling in placeholders, and executing the pipeline.

And the independent verification gate (CI) solves the single-developer trust problem without requiring a full QA team. GitHub Actions provides tamper-resistant evidence that the code passed all gates, regardless of who wrote it or who committed it.

---

## The Honest Limitations

This system doesn't solve everything.

It depends on the developer (or AI) actually following the workflows. If someone skips workflow 1 and starts coding without a test scope, the reviewer should catch it at workflow 4 — but the control is detective, not preventive.

The authenticated E2E tests (those requiring credentials) run only locally, not in CI. This means a subset of the test suite lacks independent verification. The mitigation is that the unauthenticated subset covers the majority of test cases, and the local evidence for the full suite is committed to the repository.

Periodic activities (penetration testing, disaster recovery testing) are defined in the schedule but require manual execution. They're not triggered by the pipeline. Someone has to remember to do them on schedule.

The AI regeneration protocol requires the developer to self-report when they regenerate a component. There's no automated detection of regeneration vs. incremental editing. The mitigation is the reviewer checklist, but this is a human control, not a technical one.

And the system is built for a single-developer or small-team context. Larger teams would need additional controls: more granular RBAC on who can approve which risk levels, automated test scope validation, and possibly automated evidence integrity checking.

---

## Getting Started

For teams wanting to implement this system:

1. **Adopt Tier 1 as-is** — The Test Policy, Test Strategy, Test Architecture, and Periodic Security Review Schedule are designed to be used without modification. They're organizational standards, not project-specific.

2. **Run the project setup workflow** — For each new project, execute `0-project-setup.md`. This creates the branch structure, CI pipeline, compliance directories, and project Test Plan from templates.

3. **Follow the pipeline** — Every feature goes through workflows 1-5. The discipline comes from the workflow structure, not from individual memory.

4. **Start with Low risk** — The first few requirements through the pipeline should be Low risk to validate that the process works end-to-end before the overhead of Medium/High risk documentation is introduced.

5. **Let the reviewer calibrate** — The test scope verification in the PR checklist is where risk classification mistakes get caught. The first few reviews will calibrate what "appropriate testing depth" means for your specific project.

The complete template set — all 12 documents — is available and ready to be customized for any project using the placeholder markers in the Tier 2 templates.

---

_This framework was developed iteratively through analysis of ISO 29119, ISO 27001, GDPR, SOC 2, and emerging AI governance guidance, then implemented as a practical workflow system designed for AI-assisted software development in a compliance context._
