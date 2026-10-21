# The Advisory Nobody Asked For

**Long-form parent:** The Advisory Nobody Asked For: Why a Failing Dependency Audit Mid-Feature Is the Process Working
**Platform:** LinkedIn, Dev.to
**Read time:** ~2 minutes

---

You are two-thirds through a feature. CI goes red on the dependency audit. You did not touch a dependency.

It is the most irritating build failure there is. It is also the process working.

An advisory database is not frozen. A package three levels down gets a new CVE on Tuesday, and Monday's green build is red with no code change. Our own docs say it plainly: the audit fails on any unaccepted high or critical advisory, "including ones disclosed after the last push."

It happened to us this week in [DevAudit](https://devaudit.ai)'s portal: four new advisories on two transitive packages, none in code the feature touched. The fix is a small dependency PR with pinned overrides. One extra PR, and the feature stays about the feature.

**What the process does**
- The gate evaluates each high/critical advisory against the exact lockfile path and writes a record: ID, severity, package, installed version, what introduced it
- Fix it: a bump PR, classified by the real semver bump
- Or accept it, only when no compatible fix exists, and never quietly: a named advisory at one path, a reachability and impact record, an owner, a tracking issue and an expiry. When it expires the gate fails again, and `devaudit doctor` warns 14 days ahead

**Why it matters**
The same audit run is evidence for ISO 27001 A.8.28 and A.8.29, GDPR Art. 32 and EU AI Act Art. 15, and the gate outcome sits under SOC 2 CC7.2. The gate does not care whether a human or an AI agent added the package, which is where it earns its keep.

DevAudit produces the evidence; the auditor decides. The failed run, the fix and the green re-run are the audit pack.

Read the full article → devaudit.ai/blog/dependency-advisory-mid-feature

#DevSecOps #Compliance #SupplyChainSecurity
