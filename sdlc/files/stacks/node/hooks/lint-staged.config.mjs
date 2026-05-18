/**
 * lint-staged configuration for Metasession SDLC node-stack consumers.
 *
 * Runs on staged files only via the pre-commit husky hook:
 *   - TS/JS sources: ESLint --fix then Prettier --write
 *   - Other files:   Prettier --write
 *
 * Consumer projects can override by replacing this file. The sync script
 * re-copies it on every run, so persistent local overrides should live
 * in a separate file (.lintstagedrc.json, etc.) which takes precedence.
 */

export default {
  '*.{ts,tsx,js,jsx}': ['eslint --fix', 'prettier --write'],
  '*.{json,css,md,yml,yaml}': ['prettier --write'],
};
