import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// DevAudit-Installer#1209 — the release's requirement scope is declared to the portal from the
// integration-branch registration only (the portal replaces the scope on each declaration).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): Promise<string> => fs.readFile(join(ROOT, rel), 'utf-8').then((t) => t.replace(/\r\n/g, '\n'));

const DECLARING = ['sdlc/files/ci/ci.yml.template', 'sdlc/files/ci/python/ci.yml.template'];
const NEVER_DECLARING = ['sdlc/files/ci/feature-e2e.yml.template', 'sdlc/files/ci/compliance-evidence.yml.template', 'sdlc/files/ci/post-deploy-prod.yml.template'];

describe('release scope declaration (#1209)', () => {
  it('upload-evidence.sh sends --declare-requirements as a JSON array and validates the ids', async () => {
    const script = await read('sdlc/files/_common/scripts/upload-evidence.sh');
    expect(script).toContain('--declare-requirements) DECLARED_REQUIREMENTS="$2"; shift 2 ;;');
    expect(script).toContain('"\\"declaredRequirementIds\\":[${DECLARED_JSON}]"');
    expect(script).toContain('^REQ-[A-Za-z0-9-]+$');
  });

  it.each(DECLARING)('%s declares the scope at registration, on push only', async (rel) => {
    const t = await read(rel);
    expect(t).toContain('bash scripts/release-declared-requirements.sh');
    expect(t).toContain('if [ "${{ github.event_name }}" = "push" ] && [ -f scripts/release-declared-requirements.sh ]; then');
    expect(t).toContain('${DECLARE[@]+"${DECLARE[@]}"}');
    // every declaration rides on a release_registration upload
    const registrations = t.split('release_registration README.md').length - 1;
    const declarations = t.split('${DECLARE[@]+"${DECLARE[@]}"}').length - 1;
    expect(declarations).toBe(registrations);
  });

  it.each(NEVER_DECLARING)('%s never declares a scope (it can see an older or partial list)', async (rel) => {
    const t = await read(rel);
    expect(t).not.toContain('--declare-requirements');
    expect(t).not.toContain('release-declared-requirements.sh');
  });

  it('the scope script is tested in template-lint', async () => {
    expect(await read('.github/workflows/template-lint.yml')).toContain('release-declared-requirements.test.sh');
  });
});
