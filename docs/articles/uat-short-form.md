# A Person Tried It and Wrote Down What Happened: UAT That Leaves Evidence

**Long-form parent:** A Person Tried It and Wrote Down What Happened: How DevAudit Configures, Runs and Records UAT
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

Most audit trails hold one sentence about user acceptance testing: "UAT done." No one can say who tested, which build, or what happened at step 4.

[DevAudit](https://devaudit.ai) makes UAT leave evidence.

**Configured**
- `uat.human_pack`: write the test pack by risk (the default, MEDIUM and above), always, or never
- `approval.mode`: the person who accepts must differ from the author, or the gap is recorded

**Written**
For a qualifying change, the agent writes three documents from the acceptance criteria, for a tester who has never seen the system:
- a briefing: what changed, what did not, environment, accounts
- a procedure: click-by-click steps with exact expected results, at least one positive and one negative per criterion
- a blank execution record

CI fails while a placeholder remains or an acceptance criterion appears in no step.

**Executed and recorded**
A person, not the agent, runs the steps and fills in the record. Then they log the outcome in the portal against a tested SHA or build, with evidence attached. The portal only accepts that from a signed-in admin or uploader, never from a CI key.

**Saved**
The record lands in git. The pack uploads as evidence. A "Manual UAT execution" cycle and an audit event are written.

**Gated**
No successful UAT cycle, no approval. Under the independent policy, you cannot approve your own release, and each approval is logged as independent or self.

**Honest limit:** DevAudit records that a person tested it, on a named build, with their evidence. It cannot judge how well they tested.

Read the full article → devaudit.ai/blog/uat

#QA #DevOps #Compliance
