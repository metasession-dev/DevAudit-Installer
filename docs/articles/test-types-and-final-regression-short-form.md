# Your Last Test Should Run After You Deploy

**Long-form parent:** Six Kinds of Tests, One Safety Net: What Runs When, and What Happens When the Last Gate Fails
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

Most teams can't answer two questions on release day: which test is allowed to stop a release, and what happens when one fails?

Here is the model we use in [DevAudit](https://devaudit.ai).

**Cheap checks first, wide checks last**
- Commit time: lint, a requirement reference on every commit, a type check
- Unit tests while you build
- Feature E2E on the PR: only the Playwright specs tagged to your requirement
- Smoke E2E on every push to the integration branch
- Critical E2E on the PR into main: the must-not-break journeys
- Full regression after a successful production deploy, against what is actually running

Same Playwright, bigger sets of specs. The hour-long suite never queues up behind every merge, and it still runs on the real deployment.

**A failure is a decision, never a default**
Nothing is accepted automatically. A failed gate ends in one of three recorded outcomes:
1. Fix it: a fix PR, a green re-run on the new head, recorded in the portal
2. Accept it: a written exception with an impact assessment, an owner, a review date and a tracking issue
3. Defer the release: it is parked as "deferred" and a later release has to pick it up on purpose

The portal won't approve a release while a failed run has no recorded resolution. The agent stops and reports it blocked. The test summary can't say PASS while a failure is open. A stale exception gets flagged by `devaudit doctor`.

The auto-filed issue after deploy is a prompt to triage, not an acceptance. It never reverts anything either.

The result: quick feedback on every push, a focused gate on the release, and an audit trail that is simply the work you already did.

Read the full article → devaudit.ai/blog/test-types-and-final-regression

#SoftwareTesting #DevOps #Compliance
