# Soft Launch: Take DevAudit for a Test Drive

> **Primary persona:** Developers, engineering leads, founders, auditors, and contributors
> **Funnel stage:** Launch / awareness
> **Format:** Launch note (~1400 words)
> **Cross-links:** [/onboarding](https://devaudit.ai/onboarding) · [/sdlc](https://devaudit.ai/sdlc) · [/compliance](https://devaudit.ai/compliance) · [README](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md)

---

DevAudit is entering soft launch.

This is the stage where the right thing to do is not pretend everything is finished. It is the stage where we want real teams, real auditors, and real contributors to push on the product surface and tell us where the workflow is still rough, where the evidence model is still incomplete, and where the docs still assume too much.

So this is the invitation.

## Where this started

DevAudit did not start as a grand plan to build a compliance platform.

It started in a much more ordinary place: I was tasked with carrying out QA across multiple projects at the same time, and it was obvious that doing all of that manually was going to cap out quickly.

The practical idea was simple enough: use AI agents to do as much of the work as possible while I still provided the direction, guidance, oversight, and review.

The hard question came immediately after that: how do you make that repeatable and consistent instead of turning it into a pile of one-off prompts and wishful thinking?

That led first to the usual foundation work. Write the strategy. Write the policy. Define what "good" is supposed to look like. Once those documents existed, the next step felt obvious too: use AI to implement them wherever that was genuinely possible instead of leaving them as static process paperwork.

After several iterations, DevAudit was what came out of that.

The code might be fine. The tests might even be fine. But the review story was fuzzy. Which requirement was this tied to? Which artifacts actually proved the release? Which bits came from CI, which bits came from a human, and which bits were just assumed? And once AI agents started taking on more of the implementation work, those questions got sharper rather than softer.

That is why DevAudit ended up where it is now.

Not as "yet another policy folder," and not as "just a portal," and not as "just a CLI." It turned into three connected parts because one part on its own was never enough:

- the **SDLC framework**, so the workflow itself has structure
- the **CLI and CI layer**, so the structure is actually applied in a repo instead of living in a slide deck
- the **portal**, so releases, evidence, and approvals can be reviewed in one place without reconstructing the story by hand

That shape was earned the hard way. We got there by seeing what was still missing when only one of those pieces existed.

At its core, the thing we were trying to build was not "AI writes code." It was a process to **develop, test, and ship code in a way that stays consistent across different frameworks and still leaves behind a reviewable evidence trail**.

## Who this is for

We want feedback from four groups in particular:

1. **Developers** who want to see whether an AI-assisted SDLC can stay practical instead of ceremonial.
2. **Engineering leads, CTOs, and founders** who need a release process that creates audit evidence without turning delivery into theater.
3. **Auditors and compliance reviewers** who can tell us where the release record, evidence mapping, or control story is still thin.
4. **Contributors** who prefer to improve a system by opening issues and sending pull requests instead of waiting for a polished roadmap.

## What DevAudit is today

DevAudit has three pillars:

- the SDLC framework that gets installed into a consuming repo
- the CLI and CI workflows that generate and upload release evidence
- the portal that displays release state, evidence, and approvals

The claim is straightforward: compliance should come out of the way the team already ships software, not from an after-the-fact document scramble.

That claim is only worth anything if the workflow holds up under real use.

And that is exactly why we are doing a soft launch instead of pretending this should be a one-way broadcast.

We want to see whether the thing is actually useful in the hands of people who were not in the room while it was being built.

## What we want you to test

If you are a developer or engineering lead:

- install the framework into a project
- walk a requirement through the tracked path
- inspect whether the generated artifacts are truthful
- tell us where the process feels too heavy, too vague, or too easy to misuse

If you are an auditor or compliance reviewer:

- inspect the release record in the portal
- tell us what evidence is missing, mislabeled, or too weak to support the claimed control
- point out where a clause is technically mapped but operationally under-proved

If you are a contributor:

- open issues where the docs or workflow are misleading
- submit PRs where the fix is straightforward
- propose better wording, better guardrails, or better evidence structure

If you are just curious where the rough edges still are, that is useful too. Soft launch is exactly the stage where "this part feels awkward" is actionable feedback.

## The most valuable feedback

The highest-signal feedback is specific.

Examples:

- “This release screen still does not make it obvious whether a missing artifact is required for tracked work or intentionally skipped for housekeeping.”
- “This workflow says onboarding is thirty seconds here and ten minutes there.”
- “This control mapping is present, but the evidence shown would not satisfy my review.”
- “This article links to a doc that does not exist.”
- “I understand why you built it this way, but this step still feels heavier than the risk justifies.”

That kind of feedback is what makes the product more trustworthy.

## What contributors should know

This is an open invitation to contribute.

If you want to improve the installer, docs, workflow templates, or supporting content:

- open an issue
- explain the problem concretely
- send a pull request if you already know the fix

We are actively looking for contributors who care about:

- release truthfulness
- evidence quality
- workflow ergonomics
- agent/operator handoff quality
- control mapping accuracy

You do not need to agree with every design choice to contribute something useful. Clear disagreement, backed by a better implementation or a better explanation, is valuable here.

## What auditors should know

We are especially interested in feedback from auditors and compliance practitioners.

Not generic “looks good” feedback. Real feedback such as:

- which evidence categories are missing
- which artifacts need stronger provenance
- where the release lifecycle is ambiguous
- where a framework clause needs a different proof shape
- where the portal should distinguish CI evidence from operator-authored evidence more clearly

If an approval flow, incident trail, or requirement-evidence mapping would raise questions in a real review, we want to know now.

That includes the uncomfortable feedback. If the release record would make you stop and ask for more proof, that is the right signal for this stage.

## Where to start

Start with the surface that matches your role:

- **Try the framework:** [devaudit.ai/onboarding](https://devaudit.ai/onboarding)
- **Read the workflow model:** [devaudit.ai/sdlc](https://devaudit.ai/sdlc)
- **Review the standards/control story:** [devaudit.ai/compliance](https://devaudit.ai/compliance)
- **Inspect the installer repo:** [DevAudit-Installer README](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md)

If you are coming at this from first principles, the quickest way to understand the current shape is:

1. read the SDLC overview
2. look at the onboarding path
3. inspect one release in the portal

That sequence usually makes the "why is it built like this?" question answer itself.

## Soft launch means this part matters

Soft launch is not a euphemism for “done.”

It means the product is real enough to use, and early enough that serious feedback can still change the shape of the system.

If you want a better way to ship software with a reviewable audit trail, this is the right time to engage with it.

Try it. Break the assumptions. Tell us what is still missing.

If the process holds up, that is useful evidence.

If it does not, that is even more useful.

---

*Take the test drive → [devaudit.ai/onboarding](https://devaudit.ai/onboarding)*

*Open an issue or PR → [github.com/metasession-dev/DevAudit-Installer](https://github.com/metasession-dev/DevAudit-Installer)*
