/**
 * @metasession.co/devaudit-core/node — the Node-only helpers of the core.
 *
 * This is the only place under `core/src/` that may import `node:` modules. It holds
 * `fsRepoReader` (a file-system `RepoReader`), added by a later work package of
 * DevAudit-Installer#1116. Until then it exports only a marker, so the `./node` entry point
 * exists in the published tarball.
 */

/** Marker that the Node entry point is built and importable. */
export const CORE_NODE_ENTRY = true as const;
