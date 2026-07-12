# Soft Launch: Take DevAudit for a Test Drive

> **Primary persona:** Developers, engineering leads, founders, auditors, and contributors
> **Funnel stage:** Launch / awareness
> **Format:** Launch note (~1400 words)
> **Cross-links:** [/onboarding](https://devaudit.ai/onboarding) · [/sdlc](https://devaudit.ai/sdlc) · [/compliance](https://devaudit.ai/compliance) · [README](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md)

---

DevAudit is entering soft launch.

This is the stage where the right thing to do is not pretend everything is finished. It is the stage where we want real teams, real auditors, and real contributors to push on the product surface and tell us where the workflow is still rough, where the evidence model is still incomplete, and where the docs still assume too much.

So this is the invitation.

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

## The most valuable feedback

The highest-signal feedback is specific.

Examples:

- “This release screen still does not make it obvious whether a missing artifact is required for tracked work or intentionally skipped for housekeeping.”
- “This workflow says onboarding is thirty seconds here and ten minutes there.”
- “This control mapping is present, but the evidence shown would not satisfy my review.”
- “This article links to a doc that does not exist.”

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

## What auditors should know

We are especially interested in feedback from auditors and compliance practitioners.

Not generic “looks good” feedback. Real feedback such as:

- which evidence categories are missing
- which artifacts need stronger provenance
- where the release lifecycle is ambiguous
- where a framework clause needs a different proof shape
- where the portal should distinguish CI evidence from operator-authored evidence more clearly

If an approval flow, incident trail, or requirement-evidence mapping would raise questions in a real review, we want to know now.

## Where to start

Start with the surface that matches your role:

- **Try the framework:** [devaudit.ai/onboarding](https://devaudit.ai/onboarding)
- **Read the workflow model:** [devaudit.ai/sdlc](https://devaudit.ai/sdlc)
- **Review the standards/control story:** [devaudit.ai/compliance](https://devaudit.ai/compliance)
- **Inspect the installer repo:** [DevAudit-Installer README](https://github.com/metasession-dev/DevAudit-Installer/blob/main/README.md)

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
