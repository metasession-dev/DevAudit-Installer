/**
 * devaudit-installer#1089 — opt-in timing lines on stderr, for finding which step of a slow
 * command (a loaded Windows runner) takes the time. Off unless the named environment variable
 * is `1`; stdout (and so `--json`) is never touched.
 */
export function makeTimer(envVar: string, tag: string): <T>(label: string, fn: () => Promise<T>) => Promise<T> {
  return async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    if (process.env[envVar] !== '1') return fn();
    const started = Date.now();
    try {
      return await fn();
    } finally {
      process.stderr.write(`[${tag}] ${label}: ${Date.now() - started}ms\n`);
    }
  };
}
