/**
 * @metasession.co/devaudit-core — the pure shared core.
 *
 * Everything under `src/` (outside `src/node/`) is pure: no `node:` imports and no terminal.
 * The CLI and the portal both consume it. Later work packages of DevAudit-Installer#1116 add
 * the gap model, presets, the question registry and the local scan here.
 */

/** Version of the core's public contract. Raised when an exported shape changes incompatibly. */
export const CORE_API_VERSION = '1' as const;

export {
  RepoPathError,
  baseName,
  isDirectory,
  isFile,
  joinRepoPath,
  listDirectoryNames,
  listFileNames,
  normalizeRepoPath,
  pathExists,
  readJson,
  readText,
  type RepoReader,
} from './repo-reader.js';

export * from './detect/index.js';
