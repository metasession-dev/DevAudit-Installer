#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const sentinelPath = path.join(process.cwd(), '.sdlc-implementer-invoked');
const watchStatePath = path.join(process.cwd(), '.sdlc-pr-watch.json');
const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const DEFAULT_MAX_POLLS = 40;
const DEFAULT_FLAKY_PATTERNS = [
    'playwright',
    'e2e',
    'regression',
    'smoke',
    'flaky',
    'retry',
];
const RELEASE_APPROVAL_STATUSES = new Set([
    'uat_approved',
    'release_approved',
    'prod_review',
    'prod_approved',
    'released',
]);

const phaseMap = {
    '1': '1-plan-requirement.raw.md',
    '2': '2-implement-and-test.raw.md',
    '3': '3-compile-evidence.raw.md',
    '4': '4-submit-for-review.raw.md',
    '5': '5-deploy-main.raw.md',
    'issue': 'implementing-an-sdlc-issue.raw.md'
};

function getOption(name) {
    const inline = args.find(arg => arg.startsWith(`--${name}=`));
    if (inline) return inline.split('=').slice(1).join('=');
    const index = args.indexOf(`--${name}`);
    if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('--')) {
        return args[index + 1];
    }
    return null;
}

function hasFlag(name) {
    return args.includes(`--${name}`);
}

function printUsageAndExit() {
    console.error("❌ ERROR: Missing required configuration property. Execution syntax: devaudit-sdlc --phase=<1-5|issue> | --watch-pr=<number>");
    process.exit(1);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeState(value) {
    return String(value || '').trim().toLowerCase();
}

function isPendingState(value) {
    const state = normalizeState(value);
    return ['queued', 'in_progress', 'pending', 'waiting', 'requested', 'startup_failure', 'expected'].includes(state);
}

function isPassingState(value) {
    const state = normalizeState(value);
    return ['success', 'passed', 'pass', 'completed', 'neutral', 'skipped'].includes(state);
}

function isFailingState(value) {
    const state = normalizeState(value);
    return ['failure', 'failed', 'error', 'timed_out', 'cancelled', 'action_required'].includes(state);
}

function isReleaseApprovalState(value) {
    return RELEASE_APPROVAL_STATUSES.has(normalizeState(value));
}

function isReleaseGateCheck(check) {
    const haystack = `${check.name || ''} ${check.workflow || ''}`.toLowerCase();
    return haystack.includes('release approval') || haystack.includes('uat approval');
}

function isFlakyCheck(check, patterns) {
    const haystack = `${check.name || ''} ${check.workflow || ''}`.toLowerCase();
    return patterns.some(pattern => haystack.includes(pattern));
}

function extractRunId(link) {
    const match = String(link || '').match(/\/actions\/runs\/(\d+)/);
    return match ? match[1] : null;
}

function formatCheckName(check) {
    return check.workflow ? `${check.workflow} / ${check.name}` : String(check.name || 'unnamed-check');
}

function loadJsonFile(filePath, fallbackValue) {
    if (!fs.existsSync(filePath)) return fallbackValue;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_error) {
        return fallbackValue;
    }
}

function saveJsonFile(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function detectInvocationContext() {
    const invokedBySkill = !!(process.env.DEVAUDIT_SKILL_NAME || process.env.DEVAUDIT_SKILL_INVOKED);
    const invokedByAgent = !!(process.env.DEVAUDIT_AGENT || process.env.AI_AGENT_ID);
    return {
        invokedBySkill,
        invokedByAgent,
        initializedBy: invokedBySkill ? 'skill' : invokedByAgent ? 'native-agent' : 'cli',
        agentType: invokedBySkill
            ? (process.env.DEVAUDIT_SKILL_NAME || 'skill')
            : (invokedByAgent ? (process.env.DEVAUDIT_AGENT || 'native-agent') : 'manual'),
    };
}

function resolveReqId() {
    return getOption('req') || process.env.DEVAUDIT_REQ_ID || null;
}

function appendPhaseRecord(phase) {
    const blueprintPath = path.join(__dirname, '..', 'blueprints', phaseMap[phase]);
    const context = detectInvocationContext();
    const reqId = resolveReqId();

    const newRecord = {
        activatedAt: new Date().toISOString(),
        currentPhase: phase,
        initializedBy: context.initializedBy,
        status: 'active',
        reqId: reqId,
        agentType: context.agentType,
    };

    let phaseHistory = [];
    if (fs.existsSync(sentinelPath)) {
        try {
            const existingContent = fs.readFileSync(sentinelPath, 'utf8');
            const parsed = JSON.parse(existingContent);
            if (Array.isArray(parsed)) {
                phaseHistory = parsed;
            } else {
                console.warn('⚠️ WARNING: Sentinel file contained a legacy single-object format. Migrating to array format.');
                phaseHistory = [parsed];
            }
        } catch (_parseError) {
            console.warn('⚠️ WARNING: Sentinel file was corrupt or in legacy plain-text format. Overwriting with fresh phase history.');
            phaseHistory = [];
        }
    }

    phaseHistory.push(newRecord);
    saveJsonFile(sentinelPath, phaseHistory);

    console.log(`\n✅ SDLC Gateway Initialized: Appended phase ${phase} record to sentinel at ${sentinelPath}`);
    console.log(`🚀 Phase ${phase} orchestration active. Your local git commit gates are now open.`);
    console.log(`📋 Phase history: ${phaseHistory.map(r => r.currentPhase).join(' → ')}`);
    console.log(`👤 Initialized by: ${context.initializedBy}${reqId ? ` (REQ-${reqId})` : ''}`);

    if (fs.existsSync(blueprintPath)) {
        console.log(`\n--- PHASE EXECUTION MANIFEST ---`);
        const content = fs.readFileSync(blueprintPath, 'utf8');
        console.log(content);
    }
}

function runBlueprintView(phase) {
    const blueprintPath = path.join(__dirname, '..', 'blueprints', phaseMap[phase]);
    if (!fs.existsSync(blueprintPath)) {
        console.error("❌ ERROR: Target operational asset blueprint could not be resolved.");
        process.exit(1);
    }
    console.log(fs.readFileSync(blueprintPath, 'utf8'));
}

function runGhJson(ghArgs) {
    const ghCommand = process.env.DEVAUDIT_GH_BIN || 'gh';
    const result = process.env.DEVAUDIT_GH_BIN
        ? spawnSync(process.execPath, [ghCommand, ...ghArgs], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: process.env,
        })
        : spawnSync(ghCommand, ghArgs, {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: process.env,
        });
    if (result.error) {
        throw new Error(`gh ${ghArgs.join(' ')} failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || `gh ${ghArgs.join(' ')} exited ${result.status}`).trim());
    }
    const stdout = (result.stdout || '').trim();
    return stdout ? JSON.parse(stdout) : null;
}

function runGh(ghArgs) {
    const ghCommand = process.env.DEVAUDIT_GH_BIN || 'gh';
    const result = process.env.DEVAUDIT_GH_BIN
        ? spawnSync(process.execPath, [ghCommand, ...ghArgs], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: process.env,
        })
        : spawnSync(ghCommand, ghArgs, {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: process.env,
        });
    if (result.error) {
        throw new Error(`gh ${ghArgs.join(' ')} failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || `gh ${ghArgs.join(' ')} exited ${result.status}`).trim());
    }
    return result.stdout || '';
}

function resolveRepoFromGh() {
    const repo = runGh(['repo', 'view', '--json', 'nameWithOwner']);
    const parsed = JSON.parse(repo);
    if (!parsed || !parsed.nameWithOwner) {
        throw new Error('Unable to resolve current GitHub repository nameWithOwner.');
    }
    return parsed.nameWithOwner;
}

async function resolvePortalStatus(baseUrl, projectSlug, releaseVersion, apiKeyEnvName) {
    if (!baseUrl || !projectSlug || !releaseVersion) return null;
    const apiKey = process.env[apiKeyEnvName || 'DEVAUDIT_API_KEY'];
    if (!apiKey) return null;

    const url = `${baseUrl.replace(/\/$/, '')}/api/ci/releases/resolve?projectSlug=${encodeURIComponent(projectSlug)}&versionPrefix=${encodeURIComponent(releaseVersion)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
        });
        if (!response.ok) return null;
        const body = await response.json();
        return normalizeState(body && body.latest && body.latest.status);
    } catch (_error) {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function loadWatchState() {
    const parsed = loadJsonFile(watchStatePath, { watches: {} });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { watches: {} };
    }
    if (!parsed.watches || typeof parsed.watches !== 'object' || Array.isArray(parsed.watches)) {
        parsed.watches = {};
    }
    return parsed;
}

function getOrCreateWatch(state, key, seed) {
    if (!state.watches[key]) {
        state.watches[key] = {
            prNumber: seed.prNumber,
            repo: seed.repo,
            reqId: seed.reqId || null,
            releaseVersion: seed.releaseVersion || null,
            projectSlug: seed.projectSlug || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pollCount: 0,
            reruns: {},
            releaseGateReruns: 0,
            lastClassification: null,
            lastSummary: null,
            lastPortalStatus: null,
            history: [],
        };
    }
    return state.watches[key];
}

function recordWatchHistory(watch, kind, summary, action) {
    watch.updatedAt = new Date().toISOString();
    watch.lastClassification = kind;
    watch.lastSummary = summary;
    watch.history = Array.isArray(watch.history) ? watch.history : [];
    watch.history.push({
        at: watch.updatedAt,
        kind,
        summary,
        action: action || null,
    });
    if (watch.history.length > 25) {
        watch.history = watch.history.slice(-25);
    }
}

function classifyPrStatus(pr, checks, portalStatus, watch, options) {
    const failingChecks = checks.filter(check => isFailingState(check.state || check.bucket));
    const pendingChecks = checks.filter(check => isPendingState(check.state || check.bucket));
    const releaseGate = checks.find(isReleaseGateCheck) || null;

    if (normalizeState(pr.state) !== 'open') {
        return {
            kind: 'terminal',
            exitCode: 0,
            summary: `PR #${watch.prNumber} is ${normalizeState(pr.state) || 'not open'}. Watch complete.`,
        };
    }

    if (pr.isDraft) {
        return {
            kind: 'waiting',
            exitCode: 2,
            summary: `PR #${watch.prNumber} is still a draft. Waiting for ready-for-review.`,
        };
    }

    if (normalizeState(pr.reviewDecision) === 'changes_requested') {
        return {
            kind: 'blocked',
            exitCode: 3,
            summary: `PR #${watch.prNumber} has changes requested. Human action required before resume.`,
        };
    }

    if (releaseGate && (isPendingState(releaseGate.state || releaseGate.bucket) || isFailingState(releaseGate.state || releaseGate.bucket))) {
        if (portalStatus && isReleaseApprovalState(portalStatus)) {
            const runId = extractRunId(releaseGate.link);
            if (runId && watch.releaseGateReruns < 3) {
                return {
                    kind: 'action',
                    exitCode: 4,
                    summary: `Release approval is already ${portalStatus} on the portal. Re-running ${formatCheckName(releaseGate)}.`,
                    action: { type: 'rerun-release-gate', runId, checkName: formatCheckName(releaseGate) },
                };
            }
            return {
                kind: 'blocked',
                exitCode: 3,
                summary: `Release approval is ${portalStatus} on the portal, but ${formatCheckName(releaseGate)} is still not green and cannot be auto-rerun further.`,
            };
        }
        return {
            kind: 'waiting',
            exitCode: 2,
            summary: `Release approval gate is not green yet. Portal status is ${portalStatus || 'unknown'}; waiting for review/approval on the portal.`,
        };
    }

    for (const check of failingChecks) {
        if (!isReleaseGateCheck(check) && isFlakyCheck(check, options.flakyPatterns || DEFAULT_FLAKY_PATTERNS)) {
            const runId = extractRunId(check.link);
            const checkKey = formatCheckName(check);
            const priorReruns = Number((watch.reruns || {})[checkKey] || 0);
            if (runId && priorReruns < 2) {
                return {
                    kind: 'action',
                    exitCode: 4,
                    summary: `Detected likely flaky failure in ${checkKey}. Re-running workflow.`,
                    action: { type: 'rerun-flaky', runId, checkName: checkKey },
                };
            }
        }
    }

    if (failingChecks.length > 0) {
        return {
            kind: 'blocked',
            exitCode: 3,
            summary: `PR #${watch.prNumber} has failing checks that need code fixes: ${failingChecks.map(formatCheckName).join(', ')}.`,
        };
    }

    if (pendingChecks.length > 0) {
        return {
            kind: 'waiting',
            exitCode: 2,
            summary: `PR #${watch.prNumber} still has pending checks: ${pendingChecks.map(formatCheckName).join(', ')}.`,
        };
    }

    if (normalizeState(pr.reviewDecision) !== 'approved') {
        return {
            kind: 'blocked',
            exitCode: 3,
            summary: `All checks are green, but PR #${watch.prNumber} still needs human review/approval.`,
        };
    }

    return {
        kind: 'ready',
        exitCode: 0,
        summary: `PR #${watch.prNumber} is approved and all observed checks are green. Ready for merge.`,
    };
}

function performWatchAction(repo, watch, decision) {
    if (!decision.action) return;
    runGh(['run', 'rerun', decision.action.runId, '--repo', repo]);
    if (decision.action.type === 'rerun-release-gate') {
        watch.releaseGateReruns = Number(watch.releaseGateReruns || 0) + 1;
    } else {
        watch.reruns = watch.reruns || {};
        watch.reruns[decision.action.checkName] = Number(watch.reruns[decision.action.checkName] || 0) + 1;
    }
}

async function watchPullRequest() {
    const prNumber = getOption('watch-pr');
    if (!prNumber) printUsageAndExit();

    const repo = getOption('repo') || resolveRepoFromGh();
    const reqId = resolveReqId();
    const releaseVersion = getOption('release') || (reqId ? `REQ-${reqId}` : null);
    const baseUrl = getOption('base-url') || process.env.DEVAUDIT_BASE_URL || null;
    const projectSlug = getOption('project-slug') || process.env.DEVAUDIT_PROJECT_SLUG || null;
    const apiKeyEnvName = getOption('api-key-env') || 'DEVAUDIT_API_KEY';
    const pollIntervalSeconds = Number.parseInt(getOption('poll-interval-seconds') || String(DEFAULT_POLL_INTERVAL_SECONDS), 10);
    const maxPolls = Number.parseInt(getOption('max-polls') || String(DEFAULT_MAX_POLLS), 10);
    const once = hasFlag('once');
    const flakyPatterns = (getOption('flaky-patterns') || '')
        .split(',')
        .map(pattern => pattern.trim().toLowerCase())
        .filter(Boolean);

    const state = loadWatchState();
    const watchKey = `${repo}#${prNumber}`;
    const watch = getOrCreateWatch(state, watchKey, {
        prNumber: Number(prNumber),
        repo,
        reqId,
        releaseVersion,
        projectSlug,
    });
    watch.repo = repo;
    watch.reqId = reqId || watch.reqId || null;
    watch.releaseVersion = releaseVersion || watch.releaseVersion || null;
    watch.projectSlug = projectSlug || watch.projectSlug || null;

    const options = {
        flakyPatterns: flakyPatterns.length > 0 ? flakyPatterns : DEFAULT_FLAKY_PATTERNS,
    };

    let pollsRemaining = once ? 1 : maxPolls;
    while (pollsRemaining > 0) {
        watch.pollCount = Number(watch.pollCount || 0) + 1;

        let pr;
        let checks;
        try {
            pr = runGhJson(['pr', 'view', String(prNumber), '--repo', repo, '--json', 'state,isDraft,reviewDecision']);
            checks = runGhJson(['pr', 'checks', String(prNumber), '--repo', repo, '--json', 'name,state,link,workflow,bucket']) || [];
            if (!Array.isArray(checks)) checks = [];
        } catch (error) {
            recordWatchHistory(watch, 'error', `Failed to inspect PR state: ${error.message}`);
            saveJsonFile(watchStatePath, state);
            console.error(`❌ SYSTEM ERROR: ${error.message}`);
            process.exit(1);
        }

        const portalStatus = await resolvePortalStatus(baseUrl, projectSlug || watch.projectSlug, releaseVersion || watch.releaseVersion, apiKeyEnvName);
        watch.lastPortalStatus = portalStatus || watch.lastPortalStatus || null;

        const decision = classifyPrStatus(pr || {}, checks, portalStatus, watch, options);
        if (decision.kind === 'action') {
            try {
                performWatchAction(repo, watch, decision);
                recordWatchHistory(watch, decision.kind, decision.summary, decision.action);
                saveJsonFile(watchStatePath, state);
                console.log(`🔁 ${decision.summary}`);
            } catch (error) {
                recordWatchHistory(watch, 'error', `Auto-rerun failed: ${error.message}`, decision.action);
                saveJsonFile(watchStatePath, state);
                console.error(`❌ SYSTEM ERROR: ${error.message}`);
                process.exit(1);
            }
            if (once) {
                process.exit(decision.exitCode);
            }
        } else {
            recordWatchHistory(watch, decision.kind, decision.summary);
            saveJsonFile(watchStatePath, state);
            const prefix = decision.kind === 'ready' ? '✅' : decision.kind === 'blocked' ? '⛔' : '⏳';
            console.log(`${prefix} ${decision.summary}`);
            if (decision.kind === 'ready' || decision.kind === 'blocked' || decision.kind === 'terminal') {
                process.exit(decision.exitCode);
            }
            if (once) {
                process.exit(decision.exitCode);
            }
        }

        pollsRemaining -= 1;
        if (pollsRemaining <= 0) break;
        await sleep(pollIntervalSeconds * 1000);
    }

    recordWatchHistory(watch, 'waiting', `Polling limit reached after ${watch.pollCount} observations. Re-run the watcher to continue monitoring.`);
    saveJsonFile(watchStatePath, state);
    console.log(`⏳ Polling limit reached after ${watch.pollCount} observations. Re-run the watcher to continue monitoring.`);
    process.exit(2);
}

async function main() {
    const phase = getOption('phase');
    const viewOnly = hasFlag('view');
    const watchPr = getOption('watch-pr');

    if (!phase && !watchPr) {
        printUsageAndExit();
    }

    if (watchPr) {
        await watchPullRequest();
        return;
    }

    if (!phaseMap[phase]) {
        console.error(`❌ ERROR: Invalid phase argument [${phase}]. Supported options: 1, 2, 3, 4, 5, issue`);
        process.exit(1);
    }

    if (viewOnly) {
        runBlueprintView(phase);
        return;
    }

    try {
        appendPhaseRecord(phase);
    } catch (error) {
        console.error("❌ SYSTEM ERROR: Failed to instantiate workspace sentinel tracking state:", error.message);
        process.exit(1);
    }
}

main();
