/**
 * Commitlint configuration for Metasession SDLC.
 *
 * Enforces:
 * - Conventional Commits format (feat, fix, docs, test, refactor, chore, …).
 * - Requirement traceability: **implementation** commits (feat / fix /
 *   refactor / perf) MUST cite a requirement via `[REQ-XXX]` in the subject
 *   or a `Ref: REQ-XXX` trailer (ERROR). Housekeeping types (docs, chore, ci,
 *   build, test, compliance, revert) are exempt. This is the local half of
 *   the "no implementation without a requirement" rule; `validate-commits.sh`
 *   enforces the same at PR CI (which `--no-verify` can't skip). Work starts
 *   from a requirement, which starts from an issue — run the `sdlc-implementer`
 *   skill, whose Phase 1 assigns the REQ from the originating issue.
 * - Co-Authored-By trailer (warning — not every commit is AI-generated).
 *
 * Install:
 *   npm install --save-dev @commitlint/cli @commitlint/config-conventional
 *   cp this file to your project root as commitlint.config.mjs
 */

const IMPLEMENTATION_TYPES = ['feat', 'fix', 'refactor', 'perf'];

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
    // Implementation commits must trace to a requirement (ERROR)
    'requirement-ref-for-impl': [2, 'always'],
    // AI-authored commits should be attributed (warning)
    'trailer-co-authored-by': [1, 'always'],
  },
  plugins: [
    {
      rules: {
        'requirement-ref-for-impl': ({ type, raw }) => {
          // Only implementation work is requirement-gated; housekeeping is exempt.
          if (!IMPLEMENTATION_TYPES.includes(type)) return [true];
          const hasRef =
            /\[REQ-\d{3,}\]/i.test(raw) || /Ref:\s*REQ-\d{3,}/i.test(raw);
          return [
            hasRef,
            `"${type}" is an implementation commit and must cite a requirement: ` +
              `add [REQ-XXX] to the subject or a "Ref: REQ-XXX" trailer. Work must ` +
              `start from a requirement (which starts from an issue) — run the ` +
              `sdlc-implementer skill to assign one. Housekeeping types ` +
              `(docs/chore/ci/build/test/compliance/revert) are exempt.`,
          ];
        },
        'trailer-co-authored-by': ({ raw }) => {
          const hasCoAuthor = /Co-Authored-By:/i.test(raw);
          return [
            hasCoAuthor,
            'AI-generated commits should include a "Co-Authored-By:" tag',
          ];
        },
      },
    },
  ],
  helpUrl: 'https://www.conventionalcommits.org/',
};
