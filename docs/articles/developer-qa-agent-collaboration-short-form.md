# Humans Decide, the Agent Does the Work

**Long-form parent:** Humans Decide, the Agent Does the Work: How DevAudit Splits an SDLC Between Developer, QA and a Coding Agent
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

Handing a ticket to a coding agent is easy. Deciding what it may do alone is the hard part.

Two answers go wrong. Let the agent do everything, including approving its own work, and you have one actor and no second pair of eyes. Do everything yourself, and the agent is just a faster keyboard.

Here is the split we use in [DevAudit](https://devaudit.ai): people decide, the agent does the work.

**The agent**
- Triages the issue and writes the implementation plan: acceptance criteria, risk class, threat model
- Writes failing tests first, then the code, running the gates cheapest first
- Compiles the evidence and prepares the release pull request
- After sign-off, merges, watches the deploy and checks production smoke

**You and your QA reviewer**
- Confirm the path and read the plan (approve it for high-risk changes)
- Do UAT in the portal: record it, then approve or request changes
- Decide what happens when a gate fails: fix it, or accept it with a written exception
- Approve Production and mark the release as released

**The line is built in, not requested.** The agent is not given the uploader key (CI only) or your personal access token. It reads release state with a read-only key. So it has nothing that approves a release, records UAT or uploads evidence, however it is prompted.

Nothing is skipped. What you save is the typing and the paperwork: plans, requirement rows, evidence folders, release descriptions, keeping track of where you are. What stays is the judgement, recorded under your own login.

Read the full article → devaudit.ai/blog/developer-qa-agent-collaboration

#AIEngineering #SDLC #DevOps
