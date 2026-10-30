import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { NOT_ASKED, PRESETS, PRESET_IDS, SELF_APPROVAL_CLAUSES, askedConfigKeys, renderPresetsMarkdown, type PresetId } from '@metasession.co/devaudit-core';
import { CONFIG_KEYS, validateConfigKeyValue } from '../src/lib/repo-config-keys.js';
import { setConfigPath } from '../src/lib/config-path.js';
import { renderAll } from './helpers/render-workflows.js';

// DevAudit-Installer#1116 WP5 — the presets and the question registry are data in the core. These tests
// tie that data to the CLI: every configuration key is asked or declared, every preset value is one
// `configure set` accepts, docs/presets.md is the data's rendering, and each preset generates the
// workflows its "what runs when" table describes.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

beforeAll(() => {
  process.env['DEVAUDIT_INSTALLER_ROOT'] = ROOT;
});

describe('every configuration key is asked by a question or declared as not asked', () => {
  const keys = CONFIG_KEYS.map((k) => k.key);
  const asked = new Set(askedConfigKeys());

  it('no key is left out', () => {
    const unaccounted = keys.filter((key) => !asked.has(key) && !(key in NOT_ASKED));
    expect(unaccounted, 'add the key to a question\'s writes in core/src/registry.ts, or to NOT_ASKED with a reason').toEqual([]);
  });

  it('a question writes only keys that exist (project_slug is set by install and is not a configure key)', () => {
    const installOnly = ['project_slug'];
    expect([...asked].filter((key) => !keys.includes(key) && !installOnly.includes(key))).toEqual([]);
  });

  it('NOT_ASKED names no key that does not exist and none that a question writes', () => {
    expect(Object.keys(NOT_ASKED).filter((key) => !keys.includes(key))).toEqual([]);
    expect(Object.keys(NOT_ASKED).filter((key) => asked.has(key))).toEqual([]);
  });
});

describe('the configuration a preset writes is accepted by `configure set`', () => {
  for (const id of PRESET_IDS) {
    it(`preset ${id}`, () => {
      for (const [key, value] of Object.entries(PRESETS[id].config)) {
        const result = validateConfigKeyValue(key, String(value));
        expect(result.error, `${id}: ${key}=${String(value)}`).toBeUndefined();
        expect(result.value, `${id}: ${key}`).toEqual(value);
      }
    });
  }
});

describe('docs/presets.md', () => {
  it('is the rendering of the preset data (run `npm run docs:presets` in cli/ after changing core/src/presets.ts)', async () => {
    // A Windows checkout may turn the line endings into CRLF; the content is what must match.
    const committed = (await fs.readFile(resolve(ROOT, 'docs', 'presets.md'), 'utf-8')).replace(/\r\n/g, '\n');
    expect(committed).toBe(renderPresetsMarkdown());
  });
});

describe('the compliance lines (until the open framework registry lands)', () => {
  // The clause ids section 4 cites. Once contracts/frameworks/*.json exists this list is read from it (WP9).
  const KNOWN_CLAUSES = ['SOC2.CC8.1', 'ISO27001.A.8.32'];

  it('every clause a preset cites is a clause id the specification names', () => {
    for (const id of PRESET_IDS) for (const control of PRESETS[id].controls) expect(KNOWN_CLAUSES, `${id} cites ${control}`).toContain(control);
    expect([...SELF_APPROVAL_CLAUSES]).toEqual(KNOWN_CLAUSES);
  });

  it('dual_actor goes with the independent portal policy, and the reverse', () => {
    for (const id of PRESET_IDS) {
      expect(PRESETS[id].config['approval.mode'] === 'dual_actor', id).toBe(PRESETS[id].portalPolicy === 'independent');
    }
  });

  it('A and B (self_allowed_with_gap) list both clauses as a recorded gap; C and D list none', () => {
    for (const id of ['A', 'B'] as PresetId[]) {
      expect(PRESETS[id].portalPolicy).toBe('self_allowed_with_gap');
      expect(PRESETS[id].controls).toEqual(KNOWN_CLAUSES);
    }
    for (const id of ['C', 'D'] as PresetId[]) {
      expect(PRESETS[id].portalPolicy).toBe('independent');
      expect(PRESETS[id].controls).toEqual([]);
    }
  });
});

interface Workflow {
  readonly on?: Record<string, unknown>;
}

/** The config a preset writes, as the nested object `sdlc-config.json` holds. */
function configOf(id: PresetId): Record<string, unknown> {
  let cfg: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(PRESETS[id].config)) cfg = setConfigPath(cfg, key, value);
  return cfg;
}

/** The `tier=` the pull_request case of the regression workflow selects. */
function pullRequestTier(workflow: string): string | undefined {
  const block = /\n\s+pull_request\)([\s\S]*?);;/.exec(workflow)?.[1];
  return block ? /echo "tier=(\w+)"/.exec(block)?.[1] : undefined;
}

describe('each preset generates the workflows its "what runs when" table describes', { timeout: 240_000 }, () => {
  it('A: there is no e2e-regression.yml, so critical and full never run automatically', async () => {
    const wf = await renderAll('node', configOf('A'));
    expect(Object.keys(wf)).not.toContain('e2e-regression.yml');
    expect(wf['ci.yml']).toBeDefined(); // smoke still gates every pull request
    expect(wf['periodic-review.yml']).toBeDefined(); // the quarterly review runs in every preset
    expect(wf['check-release-approval.yml']).toBeDefined(); // the approval gate is always on
  });

  it('B: the release pull request selects critical; after deploy and nightly the full pack runs', async () => {
    const wf = await renderAll('node', configOf('B'));
    const regression = wf['e2e-regression.yml']!;
    const on = (yamlLoad(regression) as Workflow).on ?? {};
    expect(Object.keys(on).sort()).toEqual(['deployment_status', 'pull_request', 'schedule', 'workflow_dispatch']);
    expect(on['pull_request']).toEqual({ branches: ['main'] });
    expect(pullRequestTier(regression)).toBe('critical');
    expect(regression).toContain("- cron: '0 2 * * *'");
    expect(regression).toContain('deployment_status|schedule)');
  });

  it('C: the release pull request selects the full regression; after deploy and nightly it runs again', async () => {
    const regression = (await renderAll('node', configOf('C')))['e2e-regression.yml']!;
    const on = (yamlLoad(regression) as Workflow).on ?? {};
    expect(Object.keys(on).sort()).toEqual(['deployment_status', 'pull_request', 'schedule', 'workflow_dispatch']);
    expect(pullRequestTier(regression)).toBe('full');
    expect(regression).toContain("- cron: '0 2 * * *'");
  });

  it('D: the same as C but with no deployment_status trigger, because post_deploy_full_regression is false', async () => {
    const regression = (await renderAll('node', configOf('D')))['e2e-regression.yml']!;
    const on = (yamlLoad(regression) as Workflow).on ?? {};
    expect(Object.keys(on).sort()).toEqual(['pull_request', 'schedule', 'workflow_dispatch']);
    expect(pullRequestTier(regression)).toBe('full');
    expect(regression).toContain("- cron: '0 2 * * *'");
  });

  it('the production-review setting reaches post-deploy only for A (released) and not for B, C, D (prod_review)', async () => {
    // The workflow reads the value at run time from sdlc-config.json, so what the preset writes is the contract.
    expect(PRESETS.A.config['production_review.terminal_status']).toBe('released');
    for (const id of ['B', 'C', 'D'] as PresetId[]) expect(PRESETS[id].config['production_review.terminal_status']).toBe('prod_review');
  });
});
