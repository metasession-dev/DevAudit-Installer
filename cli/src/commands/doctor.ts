import { execa } from 'execa';
import { logger } from '../lib/logger.js';

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

async function checkCommand(name: string, args: readonly string[]): Promise<CheckResult> {
  try {
    const result = await execa(name, args, { reject: false });
    const ok = result.exitCode === 0;
    const firstLine = result.stdout.split('\n')[0] ?? '';
    return { name, ok, detail: ok ? firstLine : `exited ${result.exitCode}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, ok: false, detail: message };
  }
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.versions.node;
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10);
  const ok = major >= 22;
  return { name: 'node', ok, detail: `v${version} (require >=22)` };
}

export async function runDoctor(): Promise<void> {
  const log = logger();
  log.info('Running devaudit doctor — checking required tools...\n');
  const checks: readonly CheckResult[] = [
    await checkNodeVersion(),
    await checkCommand('git', ['--version']),
    await checkCommand('gh', ['--version']),
    await checkCommand('jq', ['--version']),
    await checkCommand('curl', ['--version']),
  ];
  let allOk = true;
  for (const check of checks) {
    const marker = check.ok ? '✓' : '✗';
    if (!check.ok) allOk = false;
    log.log(`  ${marker} ${check.name.padEnd(8)} ${check.detail}`);
  }
  log.log('');
  if (allOk) {
    log.success('All required tools present.');
    process.exit(0);
  } else {
    log.error('One or more required tools are missing. Install them and re-run `devaudit doctor`.');
    process.exit(6);
  }
}
