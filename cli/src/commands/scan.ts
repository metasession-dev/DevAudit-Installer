import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  assembleReport,
  detectFacts,
  evaluateFramework,
  missingCount,
  renderBadge,
  renderHtml,
  renderSarif,
  renderText,
  type FrameworkFile,
  type ScanReport,
} from '@metasession.co/devaudit-core';
import { fsRepoReader } from '@metasession.co/devaudit-core/node';
import { defaultGh, type GhRunner } from '../lib/deploy-detect.js';
import { resolveInstallerRoot } from '../lib/installer-root.js';
import { resolveRepoRoot } from '../lib/git-root.js';
import { emitJsonResult, isJsonMode, logger } from '../lib/logger.js';
import { CACHE_DIR } from '../lib/paths.js';
import * as prompts from '../lib/prompt.js';
import { readSdlcConfig } from '../lib/sdlc-config.js';
import { clackAsker } from '../install/test-config.js';
import { clackGuidedAsker } from '../install/prompts.js';
import { LOCAL_FIXES, NOT_A_TERMINAL_LINE, runAccountStep, type AccountStepDeps } from './scan-account.js';
import type { GuidedAsker } from '../install/guided.js';
import { buildScanContext, loadFrameworks } from '../lib/scan-context.js';

/**
 * DevAudit-Installer#1116 WP10 — `devaudit scan`: what a repository is set up to evidence, per clause of the
 * selected standards, read from files only. The default report and `--local` make no network request; `--github`
 * adds read-only repository posture through `gh`. Exit codes: 0 report produced (also with `--ci` when at or under
 * `--max-missing`), 1 `--ci` and more clauses `missing`, or the repository could not be read, 2 invalid flags.
 * It reports readiness, never "compliant".
 */

export const SCAN_EXIT_OVER_BUDGET = 1;
export const SCAN_EXIT_INVALID = 2;

export interface ScanOptions {
  readonly path?: string;
  readonly framework?: string;
  readonly local?: boolean;
  readonly github?: boolean;
  readonly json?: boolean;
  readonly html?: string;
  readonly sarif?: string;
  readonly badge?: string;
  readonly out?: string;
  readonly ci?: boolean;
  readonly maxMissing?: string;
}

export interface ScanDeps {
  readonly installerRoot?: string;
  readonly ask?: GuidedAsker;
  readonly gh?: GhRunner;
  readonly say?: (line: string) => void;
  readonly cacheDir?: string;
  /** Test seam: replaces the terminal check for the framework question. */
  readonly interactive?: boolean;
  /** Test seam: whether stdin and stdout are terminals and `CI` is unset (the account offer needs it). */
  readonly terminal?: boolean;
  /** Test seam for the account step (WP11). */
  readonly account?: Partial<AccountStepDeps>;
}

const COMPLIANCE_CHOICES = [
  { value: 'soc-2', label: 'SOC 2' },
  { value: 'iso-27001', label: 'ISO 27001' },
  { value: 'iso-29119', label: 'ISO 29119' },
  { value: 'gdpr', label: 'GDPR' },
  { value: 'eu-ai-act', label: 'EU AI Act' },
];

/** The cache file of a repository's last scan, so `install` can reuse it. */
export function cacheFileFor(repoRoot: string, cacheDir: string = CACHE_DIR): string {
  return join(cacheDir, 'scans', `${createHash('sha256').update(repoRoot).digest('hex')}.json`);
}

async function releaseBranchReviews(repoRoot: string, branch: string, gh: GhRunner): Promise<number | null> {
  const r = await gh(['api', `repos/{owner}/{repo}/branches/${branch}/protection`, '--jq', '.required_pull_request_reviews.required_approving_review_count // 0'], repoRoot);
  if (r.exitCode !== 0) return null;
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export async function runScan(options: ScanOptions, deps: ScanDeps = {}): Promise<number> {
  const log = logger();
  const say = deps.say ?? ((l: string) => log.log(l));
  const json = Boolean(options.json) || isJsonMode();

  // ---- flags ----------------------------------------------------------------------------------------------
  if (options.local && options.github) {
    log.error('--local never contacts GitHub and --github reads the repository posture through it; use one or the other.');
    return SCAN_EXIT_INVALID;
  }
  let maxMissing = 0;
  if (options.maxMissing !== undefined) {
    if (!options.ci) {
      log.error('--max-missing is only used with --ci.');
      return SCAN_EXIT_INVALID;
    }
    if (!/^\d+$/.test(options.maxMissing)) {
      log.error('--max-missing must be a whole number, for example --max-missing 2.');
      return SCAN_EXIT_INVALID;
    }
    maxMissing = Number(options.maxMissing);
  }

  // ---- the repository and the registry ---------------------------------------------------------------------
  let repoRoot: string;
  try {
    repoRoot = await resolveRepoRoot(resolve(options.path ?? process.cwd()));
    await fs.access(repoRoot);
  } catch (err) {
    log.error(`Cannot read the repository: ${(err as Error).message}`);
    return SCAN_EXIT_OVER_BUDGET;
  }
  const installerRoot = deps.installerRoot ?? (await resolveInstallerRoot());
  let registry: FrameworkFile[];
  try {
    registry = await loadFrameworks(installerRoot);
  } catch (err) {
    log.error((err as Error).message);
    return SCAN_EXIT_OVER_BUDGET;
  }
  const known = registry.map((f) => f.code);

  // ---- which standards ---------------------------------------------------------------------------------------
  const cfg = (await readSdlcConfig(repoRoot)) as unknown as Record<string, unknown> | null;
  const configured = Array.isArray(cfg?.['compliance_frameworks']) ? (cfg!['compliance_frameworks'] as unknown[]).filter((f): f is string => typeof f === 'string') : [];
  let codes: string[];
  if (options.framework !== undefined) {
    codes = options.framework.split(',').map((c) => c.trim()).filter((c) => c !== '');
    const unknown = codes.filter((c) => !known.includes(c));
    if (unknown.length > 0) {
      log.error(`Unknown standard ${unknown.join(', ')}. Known: ${known.join(', ')}.`);
      return SCAN_EXIT_INVALID;
    }
  } else {
    const interactive = deps.interactive ?? (!options.ci && !json && prompts.nonInteractiveReason(json) === null);
    if (interactive) {
      const ask = deps.ask ?? clackGuidedAsker;
      codes = (await ask.multiselect('Which standards do you want to see?', COMPLIANCE_CHOICES.filter((c) => known.includes(c.value)), configured)).filter((c) => known.includes(c));
    } else {
      codes = configured.filter((c) => known.includes(c));
    }
  }
  const selected = registry.filter((f) => codes.includes(f.code));

  // ---- evaluate ----------------------------------------------------------------------------------------------
  const reader = fsRepoReader(repoRoot);
  const ctx = await buildScanContext(reader, repoRoot, installerRoot);
  const results = [];
  for (const framework of selected) results.push(await evaluateFramework(framework, ctx));
  const facts = await detectFacts(reader);
  let report: ScanReport = assembleReport({ facts, frameworks: selected, results });

  if (options.github) {
    const branch = facts.branches.release ?? 'main';
    const reviews = await releaseBranchReviews(repoRoot, branch, deps.gh ?? defaultGh);
    if (reviews !== null) {
      const extra = `The release branch (${branch}) requires ${reviews} approving review${reviews === 1 ? '' : 's'}.`;
      report = {
        ...report,
        suggestionReason: `${report.suggestionReason} ${extra}`,
        gaps:
          reviews === 0
            ? [
                ...report.gaps,
                {
                  id: 'scan:github:release-branch-reviews',
                  source: 'scan',
                  check: 'github',
                  subject: `${branch} required reviews`,
                  title: 'The release branch needs no approving review',
                  why: `${extra} Anyone with write access can merge to it without a review, so change management rests on process alone.`,
                  controls: [],
                  options: [{ id: 'guidance', label: `Require at least one approving review on ${branch} in the repository settings, or run \`devaudit install\`.`, tier: 'C', consequence: 'Prints the steps; DevAudit changes nothing for you.' }],
                },
              ]
            : report.gaps,
      };
    }
  }

  // ---- outputs -----------------------------------------------------------------------------------------------
  const writes: Array<[string, string]> = [];
  if (options.html) writes.push([resolve(options.html), renderHtml(report)]);
  if (options.sarif) writes.push([resolve(options.sarif), renderSarif(report)]);
  if (options.badge) writes.push([resolve(options.badge), renderBadge(report)]);
  if (options.out) {
    const dir = resolve(options.out);
    writes.push([join(dir, 'scan-report.json'), `${JSON.stringify(report, null, 2)}\n`]);
    writes.push([join(dir, 'scan.html'), renderHtml(report)]);
    writes.push([join(dir, 'scan.sarif'), renderSarif(report)]);
    writes.push([join(dir, 'scan-badge.svg'), renderBadge(report)]);
  }
  for (const [file, content] of writes) {
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  // The last report is cached outside the repository so `install` can reuse it.
  const cache = cacheFileFor(await fs.realpath(repoRoot).catch(() => repoRoot), deps.cacheDir);
  await fs.mkdir(dirname(cache), { recursive: true });
  await fs.writeFile(cache, `${JSON.stringify(report, null, 2)}\n`);

  if (json) emitJsonResult(report as unknown as Record<string, unknown>);
  else {
    say(renderText(report));
    for (const [file] of writes) say(`Wrote ${file}`);
  }

  // ---- the account step (WP11): after the report, never with --json, --ci or without a terminal -----------
  if (!json && !options.ci) {
    if (options.local) {
      say(LOCAL_FIXES);
    } else if (!(deps.terminal ?? prompts.nonInteractiveReason(false) === null)) {
      say(NOT_A_TERMINAL_LINE);
    } else {
      const base = ((cfg?.['devaudit'] as { base_url?: string } | undefined)?.base_url ?? process.env['DEVAUDIT_BASE_URL'] ?? 'https://devaudit.ai').replace(/\/$/, '');
      await runAccountStep(
        { report, cacheFile: cache, repoRoot, baseUrl: base, cfg },
        { say, ask: { confirm: (m, i) => clackAsker.confirm(m, i), select: (m, o, i) => clackAsker.select(m, o, i) }, ...deps.account },
      );
    }
  }

  if (options.ci && missingCount(report) > maxMissing) {
    log.error(`${missingCount(report)} clauses are missing (more than --max-missing ${maxMissing}).`);
    return SCAN_EXIT_OVER_BUDGET;
  }
  return 0;
}
