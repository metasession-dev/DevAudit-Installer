# Which Test Gates Your Release? Make It a Decision

**Long-form parent:** Six Kinds of Tests, One Safety Net: What Runs When, and What Happens When the Last Gate Fails
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

Most teams can't answer two questions on release day: which test is allowed to stop a release, and what happens when one fails?

Here is the model we use in [DevAudit](https://devaudit.ai).

**Cheap checks first, wide checks later**
- Commit time: lint, a requirement reference on every commit, a type check
- Unit tests while you build
- Feature tests on the PR: only the tests tagged to your requirement
- Smoke on every push to the integration branch
- The release gate on the PR into main: critical by default
- The full regression: after a successful production deploy by default, or nightly, or as the release gate

**Pick the gate per project**
Three settings: which tier runs on the release PR (none, smoke, critical or full), whether the full pack also runs after deploy, and an optional nightly run. The defaults keep today's behaviour.

Full before merge is the strictest and the slowest, since a big pack can take about an hour. Critical plus a nightly run gives an earlier signal. `devaudit doctor` reviews the choice against your real run times; it only proposes, and you change it with `devaudit configure`.

The tier names are the same for Playwright, pytest, Jest and Vitest.

**A failure is a decision, never a default**
Nothing is accepted automatically. A failed gate ends in one of three recorded outcomes:
1. Fix it: a fix PR, a green re-run on the new head, recorded in the portal
2. Accept it: a written exception with an impact assessment, an owner, a review date and a tracking issue
3. Defer the release: it is parked as "deferred" and a later release has to pick it up on purpose

The portal won't approve a release while a failed run has no recorded resolution. The agent stops and reports it blocked. A nightly run is not release evidence: a failure opens one issue and blocks nothing.

The result: quick feedback on every push, a gate you chose on the release, and an audit trail that is simply the work you already did.

Read the full article → devaudit.ai/blog/test-types-and-final-regression

#SoftwareTesting #DevOps #Compliance
