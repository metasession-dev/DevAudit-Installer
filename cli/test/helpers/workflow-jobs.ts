/**
 * DevAudit-Installer#1335 — the generated ci.yml holds what used to be several workflows (the gates, the feature E2E,
 * the release provenance), so a test that pinned one of them reads that job's section of ci.yml instead.
 */

/** The text of job `jobId` in a rendered workflow: from its `  <id>:` line to the next job (or the end). */
export function jobSection(workflow: string, jobId: string): string {
  const jobsAt = workflow.indexOf('\njobs:\n');
  if (jobsAt < 0) throw new Error('no jobs: block in the workflow');
  const body = workflow.slice(jobsAt + '\njobs:\n'.length);
  const re = /^ {2}([A-Za-z0-9_-]+):\s*$/gm;
  const starts: Array<{ id: string; at: number }> = [];
  for (let m = re.exec(body); m; m = re.exec(body)) starts.push({ id: m[1]!, at: m.index });
  const i = starts.findIndex((s) => s.id === jobId);
  if (i < 0) throw new Error(`job ${jobId} not found (jobs: ${starts.map((s) => s.id).join(', ')})`);
  const end = i + 1 < starts.length ? starts[i + 1]!.at : body.length;
  return body.slice(starts[i]!.at, end);
}

/** The feature E2E part of ci.yml: the scope-decision job and the feature E2E job, as feature-e2e.yml was. */
export function featureJobs(workflow: string): string {
  return `${jobSection(workflow, 'e2e-scope-decision')}${jobSection(workflow, 'feature-e2e')}`;
}
