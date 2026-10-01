# When Agents Write Both Sides of the API and Nobody Tests the Seam

> **Primary persona:** CTO + Lead Developer
> **Funnel stage:** MOFU — Consideration
> **Format:** Technical deep-dive (~2000 words)
> **Cross-links:** [/sdlc](https://devaudit.ai/sdlc) · [docs/e2e-test-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/e2e-test-tiers.md) · [docs/release-lineage-and-test-execution-audit-model.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/release-lineage-and-test-execution-audit-model.md)

> **Blog publishing fields** — the devaudit.ai blog stores posts as `{slug, title, excerpt, body, tags[], author}`, none of it derived automatically from this file. Paste these into the CMS admin form:
> - **Title:** When Agents Write Both Sides of the API and Nobody Tests the Seam
> - **Slug:** `cross-repo-integration-testing`
> - **Excerpt:** A backend gets a real e2e tier and a frontend already has one — but its tests mock the backend entirely. Nothing tests the seam. Here's why the fix isn't a new cross-repo test suite, but formalizing the sequencing developers were already running by instinct — and why that's only a first step.
> - **Author:** Metasession
> - **Tags:** `sdlc`, `testing`, `agentic-development`

---

We were asked to check something simple: for a project split across a FastAPI backend and a Next.js frontend, do we have basic smoke tests, and is an end-to-end framework actually set up? Three repos, one question, should have been a five-minute answer.

Two of the three repos checked out cleanly. The third — the backend — looked fine from a distance. CI had a `feature-e2e.yml` workflow fully wired for Playwright: `npm ci`, install chromium, start a dev server on port 3000, run specs matching `e2e/**/*.spec.ts` tagged with a requirement ID. `sdlc-config.json` had e2e configuration keys. The scaffolding was all there.

It just didn't point at anything. There was no `package.json` in the repo. No `e2e/` directory. No spec file, anywhere, of any kind. The workflow's own detection step would resolve `has_tests=false` on every run and quietly skip itself — forever, since nothing was ever going to populate it. Someone had templated a frontend's e2e setup into a pure-Python backend that has no JavaScript tooling at all, and the mismatch had sat there long enough to look load-bearing.

The fix for that part was straightforward and specific to the stack: this backend already has ~140 pytest files and a working CI gate around them. Rather than bolting Node and Playwright onto an all-Python repo for one test tier, the natural move is a `tests/e2e/` layer using pytest and httpx against a live instance with a real test database — same runner, same CI gate, real HTTP round-trips instead of the pure-function unit tests that were standing in for e2e coverage. We filed it, scoped it, and started walking it through the SDLC.

Then the question that actually mattered surfaced.

## The question a single-repo review can't ask

This backend doesn't ship in isolation. It has a sibling frontend repo, and that frontend already has a working Playwright suite — smoke tests, auth flows, settings pages, eight spec files deep. On paper, between the two repos, e2e coverage looks solid.

Except the frontend's auth spec mocks the backend. Every one of those Playwright tests runs against a stubbed API response, not the real service. So the actual state, once you add the new backend e2e tier, is:

- Backend tested against itself, in isolation, with pytest and httpx.
- Frontend tested against a fake backend, in isolation, with Playwright.
- **Nothing tests the boundary between them.**

For a monolith, this problem doesn't exist — one browser-driven suite hitting the real app inherently drives the real backend too, because there's only one process. But this is a split-repo architecture, deliberately: a FastAPI service and a Next.js frontend, two deploy targets, two CI pipelines, two test suites that have never once talked to each other in CI. And the overwhelming majority of feature work here touches both repos — a new endpoint means a new UI to call it, a new business rule means both a backend validation and a frontend form. If contract drift between the two services is going to surface anywhere, it's going to surface in exactly the gap neither suite covers.

This is not a defect in either test suite. Each one is doing its job correctly, for its own repo. It's a structural gap that only exists *because* the architecture is split, and it's invisible if you review either repo on its own — which is exactly how it stayed invisible.

## What the traditional SDLC playbook offers here

This isn't a new problem; distributed-systems teams have been living with it for as long as they've been splitting services. The standard toolkit:

**Consumer-driven contract testing** (Pact and similar). The frontend publishes what it expects from an endpoint; the backend verifies it can satisfy that contract in CI, independent of a live integration run. This catches drift early and cheaply, but it requires both sides to maintain contract definitions as a first-class artifact — discipline that degrades the moment a team is moving faster than the contract suite gets updated.

**A shared staging environment with real cross-service e2e.** Stand up both services together — docker-compose, a shared namespace, whatever the platform allows — and run the frontend's Playwright suite against the real backend instead of a mock. This is the most faithful test, and also the most expensive: another environment to provision, more CI minutes, more flakiness surface (now you're debugging network timing between two services instead of one app's DOM).

**Collapse to a monolith.** Sometimes the actual fix is architectural: if the split doesn't buy you anything (independent scaling, separate deploy cadences, different teams owning different services), one codebase with one e2e suite makes this entire class of problem disappear. Not always available — you don't get to retroactively un-split an architecture for a test-strategy convenience — but worth naming as the honest baseline every other option is trading against.

**Release trains.** Gate frontend and backend deploys together, so a given "release" is always a known-compatible pair, and integration is validated once per train rather than per commit.

Every one of these is a real, working answer. Every one of them also costs something specific: contract tests need upkeep, shared staging needs infrastructure and time, monoliths need an architecture decision most teams have already made in the other direction, and release trains need coordination overhead that split-repo teams often adopted the split specifically to avoid.

## Why this gets sharper in an agentic SDLC

None of the above is new. What's new is the ratio.

An AI coding agent can write a correct backend endpoint and a correct frontend consumer of that endpoint in the same afternoon — sometimes the same session. The part of software delivery that used to be the bottleneck (writing the code on both sides of an integration) has gotten dramatically cheaper. The part that hasn't gotten cheaper is verifying the two sides actually agree with each other once they're both written. If anything, agent-authored code makes contract drift *more* likely to slip through unnoticed, not less: an agent implementing the frontend consumer will confidently write against whatever shape it's told the API returns, and if that shape drifts — even slightly — from what the backend actually ships, nothing forces the mismatch to surface unless something runs the real pair together.

Put differently: when code-writing velocity increases and integration-verification velocity doesn't, the share of total risk sitting in the integration seam goes up, not down. A framework that only ever reviews and tests one repo at a time is reviewing an increasingly smaller fraction of the actual risk surface, even if it's reviewing that fraction perfectly.

This is the problem worth naming honestly, rather than the more comfortable claim that agentic development makes testing easier across the board. It doesn't, uniformly — it makes single-repo work dramatically faster and leaves multi-repo coordination exactly where it was.

## How we looked at solving it — and what we found instead

The instinct was to ask whether our own compliance framework could track this: a single release record spanning two repos, one evidence pack covering both sides of the integration, one cross-service Playwright suite treated as a first-class gate.

We looked. It can't, and the reason is structural, not accidental.

Every release in the framework's lineage model is owned by exactly one project — one `slug`, one evidence chain, one `RTM.md`. The one "bundling" mechanism that exists (`BUNDLED-CHANGES-REQ-XXX.md`, for consolidating housekeeping commits and predecessor releases under a single approval envelope) is explicitly intra-project. The lineage design doc doesn't just fail to support cross-project links — it states outright that the ingestion API should **reject** them. REQ numbering is independent per project; two repos can and do land on the identical number by coincidence, with the only connection between them a human-written note in a free-text field.

That's not an oversight waiting to be fixed. Evidence stays owned by the release and the repo that produced it *because* that's what makes the audit trail trustworthy — a release record that claims coverage across two independently-versioned, independently-deployed codebases would be asserting something no single CI run can actually prove. Faking a cross-repo abstraction on top of that would make the lineage model less honest, not more capable.

So the framework's real answer isn't a feature. It's a pattern the framework already enforces structurally, whether or not anyone thinks about it explicitly: **a cross-repo feature is always two independently tracked requirements**, and the natural ordering between them does the integration-verification work that a shared test suite would otherwise need to do.

Concretely: the repo that owns the new contract — usually the backend, introducing new API surface — gets its requirement first. Its own acceptance criteria are validated at the contract level: does the endpoint exist, does it return what the spec says, does it enforce auth and rate limits correctly. None of that needs a frontend. The consuming repo's requirement follows, built against the agreed contract (mocked during its own fast development loop, same as today), and its own UAT review — a human clicking through the feature against a real, shared deployment — is where the integration is actually exercised. Not simulated. Not mocked. The real backend, the real frontend, one human confirming the seam holds, at exactly the point where both sides are live together for the first time.

We found this pattern already running, before we'd articulated it as a policy. Two requirements, coincidentally the same number, in two different repos: one authoring the API foundations for a new storefront capability, the other building the settings UI that consumes it. The backend's plan was approved first. The frontend's plan was approved two and a half hours later, the same day. Nobody wrote a rule enforcing that order — it happened because the frontend requirement needed a real contract to build against, and it naturally followed the repo that owned one.

This is worth being precise about, because it changes what we're actually claiming to have built. We didn't design a new cross-repo testing methodology and ask developers to adopt it. A developer had already, correctly, sequenced backend-before-frontend without being told to — because it's the only order that produces a frontend built against something real instead of a guess. What the framework adds on top of that instinct is not a new step in the workflow; it's turning a habit that lived in one engineer's judgment into something structural: a requirement, a plan, an evidence pack, and a UAT gate on *each* side of the sequence, so the same discipline holds when someone new joins the team, or when nobody happens to remember to check the other repo first. We are formalizing and enforcing the compliance shape around a process developers were already running informally — not inventing a new one and asking them to change how they work.

## Why this is the right shape, not a workaround

It would be more satisfying to end this with a shipped feature — a cross-repo dashboard, an automated integration gate spanning two projects. We're naming instead why we're *not* building that, at least not as the first move.

**UAT is real integration testing, and it's already the load-bearing check.** The framework's own principle is that the UAT reviewer is the human the entire control regime depends on — if they approve without genuinely reviewing, every other gate is formally satisfied and substantively broken. When that review happens against a shared deployment with both services live, it's already doing the job a cross-service automated suite would do, for the surface the current requirement touches. The gap isn't that UAT doesn't validate integration — it's that UAT only validates what the reviewer thinks to check, once, at release time. It gives you no regression protection against a *later*, unrelated change quietly breaking an *earlier* integration.

**That gap is real, and it should be named as a risk, not papered over.** The honest position is: this architecture accepts that cross-service drift is caught by a human's judgment about what to click through during UAT, not by an automated suite that re-verifies every prior integration on every push. For a team of this size, shipping at this velocity, that's a defensible trade — cheaper than standing up and maintaining a second live environment in CI, and it doesn't ask the compliance framework to assert coverage it can't actually back with evidence. It's also exactly the kind of decision that belongs in a risk register, not in an assumption nobody wrote down.

**The structural discipline already does most of the work.** Independent per-project requirements, backend-before-frontend sequencing when a contract is new, and a UAT gate that only fires once the real dependency is live — none of that required inventing new tooling. It required recognizing that the framework's insistence on repo-scoped, honestly-evidenced releases wasn't the obstacle to solving this. It was most of the solution already, once the sequencing was made deliberate instead of coincidental.

The broader lesson generalizes past this one framework. As agentic development collapses the cost of writing correct code on both sides of an integration, the temptation is to also collapse the verification model — one big cross-cutting test suite, one release record, one gate that claims to cover everything. That instinct is worth resisting. Compliance and testing infrastructure that tells the truth about what each piece of evidence actually proves — this repo, this release, this human's review of this live deployment — stays trustworthy even as the code underneath it gets written faster than any human could have written it alone. An abstraction that papers over the seam between two services doesn't make the seam safer. It just makes the blind spot harder to see.

## This is a first step, not a finished answer

We want to be direct about the scope of what's described here. This is sequencing discipline applied to a pattern developers were already following — it is not automated regression protection, and we're not claiming it is. If a change three requirements later quietly breaks an integration that UAT validated correctly at the time, nothing here catches that automatically. That gap is real, it's accepted deliberately rather than ignored, and it belongs in a risk register, not a footnote.

We expect our approach to testing interdependent, multi-repo systems to change quickly from here. Split-repo, multi-service architectures aren't going away, and as agentic development pushes more teams toward shipping faster across more services at once, the pressure on exactly this seam is only going to grow. What we've described is the honest floor: enforce the sequencing good engineers already default to, make it structural instead of tribal knowledge, and don't claim coverage the evidence can't back. Where this goes next — contract-testing integration, an explicit cross-repo linkage model, something we haven't tried yet — will be shaped by what we see break in practice, not by what looks good in a diagram today. Stay tuned.

---

*Read the e2e test tier model → [docs/e2e-test-tiers.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/e2e-test-tiers.md)*

*See the full SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*

*Read the release lineage model → [docs/release-lineage-and-test-execution-audit-model.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/release-lineage-and-test-execution-audit-model.md)*
