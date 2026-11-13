# A Person Tried It and Wrote Down What Happened: How DevAudit Configures, Runs and Records UAT

![A three-position setting for human UAT (never, by risk, always) leading to a briefing, a procedure and an execution record that a tester completes and that are saved to a recorded release](images/uat-hero.png)

> **Primary persona:** CTO + Lead Developer
> **Funnel stage:** MOFU — Consideration
> **Format:** Workflow explainer (~2200 words)
> **Secondary persona callout:** Compliance officer — see "Where the record ends up"
> **Cross-links:** [/sdlc](https://devaudit.ai/sdlc) · [/onboarding](https://devaudit.ai/onboarding) · [docs/presets.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/presets.md) · [docs/configure.md](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/configure.md) · [Article 42: a configurable SDLC](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/articles/configurable-sdlc-long-form.md) · [Article 41: humans decide, the agent does the work](https://github.com/metasession-dev/DevAudit-Installer/blob/main/docs/articles/developer-qa-agent-collaboration-long-form.md)

---

Automated tests tell you the software does what the tests say. They cannot tell you whether a person who has never seen the change can use it. User acceptance testing (UAT) exists for that, and it is the part of a release that auditors most often find as a sentence in a ticket: "UAT done."

DevAudit treats UAT as something that has to leave evidence: what was tested, by whom, against which build, what happened at each step, and who accepted the result. This article follows one release through it. It covers how UAT is configured, who writes what, who runs it, where the result is recorded and saved, what the portal checks before it lets a release move on, and where the limits are.

## "UAT" means three different things here

The word is overloaded, so it helps to separate three things that DevAudit keeps apart.

1. **Verification in a UAT environment (Stage 3, Step 10).** For some changes the agent exercises the change on a deployed UAT environment, not only on a developer machine or in CI. Whether that applies is configured by `uat.enabled` and `uat.required_risk_classes`.
2. **The human UAT pack.** Three documents written for a person who does not know the system: a briefing, a step-by-step procedure and an execution record. Whether one is written is configured by `uat.human_pack`.
3. **The UAT review in the portal (Stage 4).** The release moves through `uat_review` to `uat_approved`. A person records the outcome of a UAT execution, and a person approves.

They answer different questions. The first asks whether the change works where it will run. The second makes it possible for someone else to test it without asking the author anything. The third is the decision, and it is recorded as one.

## How it is configured

All of it lives in `sdlc-config.json`, committed with the code, and `devaudit configure` edits it with validation (see article 42).

| Setting | What it does | Values |
| --- | --- | --- |
| `uat.human_pack` | Whether the three-document pack is written for a requirement | `risk` (default: for MEDIUM risk and above), `always`, `never` |
| `uat.enabled` | Whether this project has a deployed UAT environment to verify against | `true` or `false` |
| `uat.required_risk_classes` | Which changes get verified there | Defaults to `payment`, `destructive_migration`, `realtime`, `physical_ux`; `"*"` means every requirement |
| `approval.mode` | Whether the person who accepts must differ from the author | `dual_actor`, `solo_with_gap` |

One honest detail. The two `uat.enabled` and `uat.required_risk_classes` settings steer the agent that follows the Stage 3 blueprint. No validator enforces them. The human pack, in contrast, is enforced, as the next section shows. The approval gate on the release pull request is separate again: it is always on and it checks the approval, not the exercise.

The portal has its own setting on the other side: a project approval policy, either `independent` or `self_allowed_with_gap`. Under `independent` the portal refuses to let you approve your own release.

## Optional, and what that costs

Not every team wants this, and the product owner decides. `uat.human_pack` set to `never` means no pack is written, no placeholder or coverage check runs, and no human tester is asked for anything. `risk` (the default) writes it for MEDIUM risk and above, so low-risk changes skip it. `always` writes it for every requirement.

Choosing `never` has a compliance cost, and it is the project's to carry:

- There is no briefing, procedure or execution record, so none of the ISO/IEC/IEEE 29119-3 style test documentation for human acceptance exists, and there is no signed tester independence declaration.
- Any standard or customer that expects documented acceptance testing will find nothing to read for those releases.
- What it does not switch off is the portal's UAT readiness check. That check looks for a successful stage 4 cycle and does not read `uat.human_pack`, so a release still needs one before it can leave UAT review. With no pack, what that cycle holds is whatever the team records.

DevAudit does not judge the choice. It makes the choice explicit, keeps it in a committed file, and leaves the consequences to be read by whoever audits.

## How the pack is written

When a requirement qualifies, the agent writes the pack during Stage 3, from the requirement's acceptance criteria. There are three files, each from a template, each mapped to a recognised test document in ISO/IEC/IEEE 29119-3.

**The briefing** is written for a tester who does not know the system, the business or the environments. It holds the background in plain sentences; what changed and, just as important, what did not (so the tester does not report nearby behaviour as a defect); scope and known limits; the environment (URL, name, browser, data state); the accounts and how credentials are delivered, which is never in the file; the rules for the tester; and the entry and exit criteria.

**The procedure** is a table. Each step names an acceptance criterion, the account to use, a precondition, a click-by-click action, an exact expected result, the screenshot file to take and whether to stop if the step fails. There is at least one positive and one negative step for each testable criterion. An acceptance criterion that a person cannot test is not dropped: it goes in a second table with the reason and where it is covered instead.

**The execution record** is the blank form the tester completes: a header with the build under test and the tester; operator preparation (migrations applied, accounts created, data loaded, each initialled); a result row per step (actual result, pass, fail or blocked, evidence file, defect); deviations; a defect log with severity; a summary; the acceptance-criteria coverage; a recommendation to approve, approve with noted defects or reject; and a sign-off for the tester and the operator.

Writing three documents is the kind of work that gets skipped, so CI does not let it be skipped quietly. The compliance validator fails while any `REPLACE` placeholder remains in the pack. It also fails if an acceptance criterion from the requirement's alignment or plan file appears nowhere in the procedure. Requirements that are already released, superseded or abandoned are exempt, and for a bundle of requirements the pack lives on the core requirement.

## Who runs it

Not the agent, and not the author.

The pack states the rule to the tester: follow the procedure step by step, record what happened and not what you expected, and treat any step that does not behave exactly as written as a failure. Under `dual_actor`, the execution record carries a tester independence declaration: *I did not write, review or approve the change under test.* It is a declaration, signed by a person, and it is checked by the people reading it, not by software.

The agent's role stops at preparing the ground. Its skill never records or submits UAT. It writes the pack, leaves the form blank, runs `devaudit release check` (five read-only checks: working tree, integration branch, CI, ticket and portal) and hands the release over. For high and critical risk changes there is also a human approval of the plan itself before work starts.

If the project runs `solo_with_gap`, one person may do all of it. The skill then requires a control-gap risk entry and a "Sign-off (solo, recorded gap)" section on the release ticket, so the missing independence is written down and not hidden.

## How it is executed and recorded

The tester works through the procedure on the named build and fills in the execution record: the actual result of each step, the screenshot with the file name the step gave, and a defect entry for every failure or blocked step. That file is then committed to the integration branch through a pull request before the UAT approval, so the completed record lives in version control next to the code it tested. Landing it re-runs the release pull request's checks, which is the intended order: the record is part of what is checked.

The second record is in the portal. While a release is in `uat_review`, the approval panel has a form to record a UAT execution:

- the **tested SHA** (pre-filled with the latest commit) or a **build version**, one of which is required;
- a **checklist reference**, pointing at the procedure;
- an **evidence reference**, plus any files you attach, which are uploaded first, so that a failed upload stops the recording and does not leave a result without its evidence;
- **notes**;
- the outcome: **Record Passed UAT** or **Record Failed UAT**.

The portal enforces who may do this. The call must come from a signed-in person, not from a CI key; the person must be an admin or an uploader on the project; and the release must be in `uat_review`. A pipeline cannot claim that a person tested something.

Recording creates a stage 4 test cycle in the `uat` environment, kind `uat_execution`, named "Manual UAT execution", carrying the checklist and evidence references, and writes an audit event, `test_cycle.uat_execution_recorded`. A failed run is recorded as failed and stays visible.

## What the portal checks before it moves on

Recording is not approving. The two are separate steps, and the portal checks the first before it allows the second.

A release cannot be approved out of UAT review without a successful UAT cycle: the readiness check reports `uat_cycle_missing`, "No successful UAT cycle is recorded for this release approval", until a stage 4 cycle with a successful status exists. The same readiness check also blocks on unresolved required checks, on the release gate and on missing execution triage.

Then the approval itself. Approving needs the admin role. Under the `independent` policy a self-approval is refused. Every approval writes an event, `release.independently_approved` or `release.self_approved`, so a reader can see afterwards, without asking anyone, which kind it was.

A rejection takes the release to `uat_rejected`, with comments, and the path back is: fix, push, resubmit.

## Where the record ends up

Four places, each for a different reader.

- **Git.** The completed execution record and the briefing and procedure, committed on the integration branch. This is the version-controlled history of what was tested.
- **The portal's evidence store.** The pack files upload with the release: the briefing and procedure as `test_cases`, the execution record as `test_report`. Screenshots and write-ups attached to the UAT form are uploaded as UAT-environment evidence.
- **The portal's test cycles.** The "Manual UAT execution" cycle, linked to the release, with who recorded it, when, against which SHA or build.
- **The portal's audit log.** The recording event and the approval event, including whether approval was independent.

For a compliance officer this is the point. Asked "who accepted this release, on what basis and was it independent?", the answer is a set of linked records, not a recollection. It also maps onto the standards the project evidences: ISO/IEC/IEEE 29119 for test documentation, and SOC 2 CC8.1 and ISO 27001 A.8.32 for change approval.

## The benefits

- **A stranger can run it.** The pack is written for someone who does not know the system, so UAT does not depend on the author being in the room.
- **Acceptance criteria cannot be dropped.** The validator ties every criterion to a step or to a stated reason it cannot be tested by a person.
- **Independence is stated, not assumed.** The tester declares it, the portal policy enforces it, and an event records which kind of approval happened.
- **Evidence is created as the work happens.** The record is filled in during execution, so there is nothing to reconstruct before an audit.
- **A pipeline cannot pose as a person.** Recording needs a signed-in human with the right role.
- **Failures are kept.** A failed run is a record, with its defects, not a deleted attempt.
- **Weak setups say so.** A solo project gets a recorded gap, not a clean-looking approval.

## Honest limits

DevAudit records that a person said they tested something, against a named build, with the evidence they attached. It cannot know whether they tested it well.

- The tester's independence declaration is a declaration. The portal's `independent` policy is the part that is enforced, and it applies to the approver.
- `uat.enabled` and `uat.required_risk_classes` guide the agent and are not checked by a validator.
- The skill and the process documents expect a failed UAT to carry a remediation reference. The portal records the field if you give it, but does not refuse a failed result without one.
- The pack is generated by an agent from the acceptance criteria. A person should read the procedure before the tester does; the validator checks coverage, not quality.
- A project with no human testers available can set `uat.human_pack` to `never`. That is a legitimate choice, and it is the project's to defend (see "Optional, and what that costs").

## Try it

Pick a preset, decide how much human ceremony each change deserves, and the next requirement that qualifies comes with a briefing, a procedure and a blank execution record, and a portal form that will not let a pipeline sign for a person.

Compliance as a byproduct, not a project.

*DevAudit is in soft launch. The first sign-ups are working with us directly.*

**CTA:** "Try it on your own repository and set how much UAT each change gets → [devaudit.ai/onboarding](https://devaudit.ai/onboarding)"
