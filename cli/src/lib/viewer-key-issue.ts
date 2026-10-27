import { DevAuditClient } from './devaudit-api.js';
import { saveViewerKey } from './viewer-keys.js';

/**
 * devaudit-installer#1099 WP3b — issue the person's own viewer key with their PAT and save it.
 * Used by `doctor --fix` (tier B). `install` / `join` do the same inline (install/api-key.ts).
 *
 * The key value is saved to `viewer-keys.json` and never returned, logged or printed.
 */

export interface IssueOwnViewerKeyOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly slug: string;
  /** `viewer:<user email>:<hostname>` */
  readonly name: string;
  /** Revoke a live key with the same name first (it cannot be recovered; used for an invalid key). */
  readonly revokeExisting: boolean;
}

export type IssueOwnViewerKeyResult =
  | { readonly kind: 'issued'; readonly revoked: boolean }
  /** A live key with this name exists and `revokeExisting` was false: nothing was changed. */
  | { readonly kind: 'exists-live' }
  | { readonly kind: 'project-not-found' };

export async function issueOwnViewerKey(opts: IssueOwnViewerKeyOptions): Promise<IssueOwnViewerKeyResult> {
  const client = new DevAuditClient({ token: opts.token, baseUrl: opts.baseUrl });
  const project = await client.getProjectBySlug(opts.slug);
  if (!project) return { kind: 'project-not-found' };
  const live = (await client.listApiKeys(project.id)).filter((k) => k.name === opts.name && k.revoked_at === null);
  if (live.length > 0 && !opts.revokeExisting) return { kind: 'exists-live' };
  for (const key of live) {
    // eslint-disable-next-line no-await-in-loop
    await client.revokeApiKey(project.id, key.id);
  }
  const issued = await client.issueApiKey(project.id, opts.name, 'viewer');
  await saveViewerKey(opts.baseUrl, opts.slug, { key: issued.plainTextKey, name: opts.name, createdAt: new Date().toISOString() });
  return { kind: 'issued', revoked: live.length > 0 };
}
