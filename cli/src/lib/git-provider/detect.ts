import { execa } from 'execa';
import type { GitProviderName } from './types.js';

interface DetectResult {
  readonly provider: GitProviderName;
  readonly host: string;
}

export async function detectProvider(cwd: string): Promise<DetectResult> {
  const res = await execa('git', ['remote', 'get-url', 'origin'], { cwd, reject: false });
  if (res.exitCode !== 0) {
    throw new Error(
      'No `origin` git remote configured. Initialise the repo and add a remote before running this command.',
    );
  }
  const url = res.stdout.trim();
  return classifyRemoteUrl(url);
}

export function classifyRemoteUrl(url: string): DetectResult {
  if (/github\.com[/:]/.test(url)) return { provider: 'github', host: 'github.com' };
  if (/gitlab\.com[/:]/.test(url)) return { provider: 'gitlab', host: 'gitlab.com' };
  if (/bitbucket\.org[/:]/.test(url)) return { provider: 'bitbucket', host: 'bitbucket.org' };
  const hostMatch = url.match(/^(?:https?:\/\/|git@)([^:/]+)/);
  return { provider: 'self-hosted', host: hostMatch?.[1] ?? 'unknown' };
}
