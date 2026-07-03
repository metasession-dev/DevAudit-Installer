#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let phase = null;
let viewOnly = args.includes('--view');

const phaseArg = args.find(arg => arg.startsWith('--phase='));
if (phaseArg) {
    phase = phaseArg.split('=')[1];
} else {
    const phaseIndex = args.indexOf('--phase');
    if (phaseIndex !== -1 && args[phaseIndex + 1]) {
        phase = args[phaseIndex + 1];
    }
}

if (!phase) {
    console.error("❌ ERROR: Missing required configuration property. Execution syntax: devaudit-sdlc --phase=<1-5|issue>");
    process.exit(1);
}

const phaseMap = {
    '1': '1-plan-requirement.raw.md',
    '2': '2-implement-and-test.raw.md',
    '3': '3-compile-evidence.raw.md',
    '4': '4-submit-for-review.raw.md',
    '5': '5-deploy-main.raw.md',
    'issue': 'implementing-an-sdlc-issue.raw.md'
};

const targetBlueprint = phaseMap[phase];
if (!targetBlueprint) {
    console.error(`❌ ERROR: Invalid phase argument [${phase}]. Supported options: 1, 2, 3, 4, 5, issue`);
    process.exit(1);
}

const blueprintPath = path.join(__dirname, '..', 'blueprints', targetBlueprint);
const sentinelPath = path.join(process.cwd(), '.sdlc-implementer-invoked');

if (viewOnly) {
    if (!fs.existsSync(blueprintPath)) {
        console.error("❌ ERROR: Target operational asset blueprint could not be resolved.");
        process.exit(1);
    }
    const content = fs.readFileSync(blueprintPath, 'utf8');
    console.log(content);
    process.exit(0);
}

try {
    // Detect the invoking agent type (devaudit-installer#278):
    // - 'skill' when invoked via a skill mechanism (Claude Code Skill, etc.)
    // - 'native-agent' when invoked directly by the native agent (Cursor, Windsurf, etc.)
    // - 'cli' when invoked manually from the terminal
    const invokedBySkill = !!(process.env.DEVAUDIT_SKILL_NAME || process.env.DEVAUDIT_SKILL_INVOKED);
    const invokedByAgent = !!(process.env.DEVAUDIT_AGENT || process.env.AI_AGENT_ID);
    const initializedBy = invokedBySkill ? 'skill' : invokedByAgent ? 'native-agent' : 'cli';

    // Extract REQ ID from args or environment (devaudit-installer#278)
    let reqId = null;
    const reqArg = args.find(arg => arg.startsWith('--req='));
    if (reqArg) {
        reqId = reqArg.split('=')[1];
    } else if (process.env.DEVAUDIT_REQ_ID) {
        reqId = process.env.DEVAUDIT_REQ_ID;
    }

    const newRecord = {
        activatedAt: new Date().toISOString(),
        currentPhase: phase,
        initializedBy: initializedBy,
        status: 'active',
        reqId: reqId,
        agentType: invokedBySkill ? (process.env.DEVAUDIT_SKILL_NAME || 'skill') : (invokedByAgent ? (process.env.DEVAUDIT_AGENT || 'native-agent') : 'manual'),
    };

    // Read existing sentinel and append, or create new array
    let phaseHistory = [];
    if (fs.existsSync(sentinelPath)) {
        try {
            const existingContent = fs.readFileSync(sentinelPath, 'utf8');
            const parsed = JSON.parse(existingContent);
            if (Array.isArray(parsed)) {
                phaseHistory = parsed;
            } else {
                // Legacy single-object format — migrate it into the array
                console.warn('⚠️ WARNING: Sentinel file contained a legacy single-object format. Migrating to array format.');
                phaseHistory = [parsed];
            }
        } catch (parseError) {
            // Corrupt or plain-text sentinel — start fresh
            console.warn('⚠️ WARNING: Sentinel file was corrupt or in legacy plain-text format. Overwriting with fresh phase history.');
            phaseHistory = [];
        }
    }

    phaseHistory.push(newRecord);
    fs.writeFileSync(sentinelPath, JSON.stringify(phaseHistory, null, 2), 'utf8');

    console.log(`\n✅ SDLC Gateway Initialized: Appended phase ${phase} record to sentinel at ${sentinelPath}`);
    console.log(`🚀 Phase ${phase} orchestration active. Your local git commit gates are now open.`);
    console.log(`📋 Phase history: ${phaseHistory.map(r => r.currentPhase).join(' → ')}`);
    console.log(`👤 Initialized by: ${initializedBy}${reqId ? ` (REQ-${reqId})` : ''}`);

    if (fs.existsSync(blueprintPath)) {
        console.log(`\n--- PHASE EXECUTION MANIFEST ---`);
        const content = fs.readFileSync(blueprintPath, 'utf8');
        console.log(content);
    }
} catch (error) {
    console.error("❌ SYSTEM ERROR: Failed to instantiate workspace sentinel tracking state:", error.message);
    process.exit(1);
}
