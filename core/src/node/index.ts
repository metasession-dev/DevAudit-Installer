/**
 * @metasession.co/devaudit-core/node — the Node-only helpers of the core.
 *
 * This is the only place under `core/src/` that may import `node:` modules. It holds
 * `fsRepoReader`, a file-system `RepoReader`.
 */

export { fsRepoReader } from './fs-repo-reader.js';

/** Marker that the Node entry point is built and importable. */
export const CORE_NODE_ENTRY = true as const;
