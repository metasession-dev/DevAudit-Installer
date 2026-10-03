# Two Repos, One Feature, Zero Tests That Prove It Works Together

**Long-form parent:** When Agents Write Both Sides of the API and Nobody Tests the Seam
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

A backend engineer asked us to check whether a FastAPI service had basic smoke tests and an e2e framework. Sort of — unit tests covered the pure logic, and CI was fully wired for Playwright, but there was no `package.json`, no `e2e/` directory, no spec file anywhere. The scaffolding was frontend boilerplate, copied into a repo with no frontend.

Easy fix: swap Playwright for pytest + httpx against a live instance, and the backend gets real API-level e2e coverage.

The harder question came next. The backend doesn't ship alone — its sibling frontend repo already has Playwright, and its auth tests mock the backend entirely. So the backend is tested in isolation, the frontend is tested against a fake backend, and nothing tests the seam between them. For a split-repo architecture where most features touch both sides, that's the real risk: not "do we have e2e tests," but "do our e2e tests ever run against each other."

## The traditional answer

Contract testing (Pact), a shared staging environment, or collapsing to a monolith so one browser-driven suite exercises the whole stack. All of these work. All of them cost something most teams underinvest in — discipline to keep contracts current, or infrastructure for a second live service in CI.

## How we're approaching it in an agentic SDLC

We looked at whether our own compliance framework should track a cross-repo test tier — one release record spanning two projects. It can't, by design: evidence is owned by the release that produced it, cross-project links are explicitly rejected at the API level, and REQ numbering is independent per project. That's not a gap to code around — collapsing two repos' audit trails into one relationship would make the lineage model unauditable.

Instead, the answer is sequencing, not tooling. A cross-repo feature becomes two independently tracked requirements — backend ships and deploys first, frontend is built against the agreed contract, and frontend's own UAT, now running against the *real* deployed backend, is where the integration actually gets proven. We didn't invent this — we found it already running in production, days before we articulated it as policy: two REQs, same number, two and a half hours apart, cross-referenced by a one-line note. A developer had already sequenced it correctly, with no framework telling them to.

So what we're building isn't a new process — it's the compliance layer catching up to sequencing good engineers already default to, making it structural instead of tribal knowledge that breaks the first time someone new joins the team.

It's also a first step, not a finished answer. There's no automated regression protection yet for a *later* change quietly breaking an *earlier* integration nobody re-checks at UAT. We expect this to evolve fast as we see more of these patterns. Stay tuned.

The lesson generalizes: when an AI agent can write both sides of an integration in an afternoon, the code-writing bottleneck disappears and "does this actually work together" becomes the whole story. Tracking each repo honestly — instead of faking a cross-repo abstraction the evidence can't back — is the more truthful answer, even when it's the less convenient one.

---

*Read the full article → devaudit.ai/blog/cross-repo-integration-testing*

*See the SDLC → [devaudit.ai/sdlc](https://devaudit.ai/sdlc)*
