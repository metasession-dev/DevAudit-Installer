/**
 * Commitlint configuration for Metasession SDLC.
 *
 * Enforces:
 * - Conventional Commits format (feat, fix, docs, test, refactor, chore, compliance, security)
 * - Co-Authored-By tag presence (warning — not every commit is AI-generated)
 * - Ref: REQ-XXX trailer presence (warning — trivial commits skip requirements)
 *
 * Install:
 *   npm install --save-dev @commitlint/cli @commitlint/config-conventional
 *   cp this file to your project root as commitlint.config.mjs
 */

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow SDLC-specific commit types beyond the conventional set
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'test',
        'refactor',
        'chore',
        'compliance',
        'security',
        'perf',
        'ci',
        'build',
        'revert',
      ],
    ],
    // Warn (not error) when body is missing — some commits are one-liners
    'body-empty': [1, 'never'],
  },
  plugins: [
    {
      rules: {
        'trailer-ref-requirement': ({ raw }) => {
          // Warn if Ref: REQ-XXX is missing — trivial commits don't need it
          const hasRef = /Ref:\s*REQ-\d+/i.test(raw);
          return [
            hasRef,
            'Commit should include "Ref: REQ-XXX" for tracked requirements',
          ];
        },
        'trailer-co-authored-by': ({ raw }) => {
          // Warn if Co-Authored-By is missing — not every commit is AI-generated
          const hasCoAuthor = /Co-Authored-By:/i.test(raw);
          return [
            hasCoAuthor,
            'AI-generated commits should include a "Co-Authored-By:" tag',
          ];
        },
      },
    },
  ],
  // Apply custom rules as warnings (level 1), not errors
  // Override in your project if you want stricter enforcement
  helpUrl: 'https://www.conventionalcommits.org/',
};
