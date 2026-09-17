/**
 * Commitlint configuration for Metasession SDLC.
 *
 * Enforces:
 * - Conventional Commits format (feat, fix, docs, test, refactor, chore, …).
 * - Requirement traceability: **implementation** commits (feat / fix /
 *   refactor / perf) MUST cite a requirement via `[REQ-XXX]` in the subject
 *   or a `Ref: REQ-XXX` trailer (ERROR). Housekeeping types (docs, style, chore, ci,
 *   build, test, compliance, revert) are exempt. This is the local half of
 *   the "no implementation without a requirement" rule; `validate-commits.sh`
 *   enforces the same at PR CI (which `--no-verify` can't skip). Work starts
 *   from a requirement, which starts from an issue — run the `sdlc-implementer`
 *   skill, whose Phase 1 assigns the REQ from the originating issue.
 * - Co-Authored-By trailer (warning — not every commit is AI-generated).
 * - `body-max-line-length` / `footer-max-line-length` (from
 *   config-conventional, 100 chars each) are overridden to exempt
 *   `Sdlc-Implementer-Sentinel:` trailer lines — devaudit-installer#814.
 *   That trailer carries a JSON phase-history array (sdlc-implementer
 *   skill Phase 2 step 7 / devaudit#775) that legitimately grows past 100
 *   chars after a couple of phases; the portal parses its JSON content
 *   directly, so reformatting it to fit under 100 chars would require a
 *   matching change to the portal's parser, not just here. This line lands
 *   in the parsed `body`, not `footer`, under conventional-changelog's
 *   default parser (verified empirically — the trailer paragraph doesn't
 *   trigger footer detection), so both rules are overridden defensively;
 *   every other body/footer line still gets the normal 100-char check.
 *
 * Install:
 *   npm install --save-dev @commitlint/cli @commitlint/config-conventional
 *   cp this file to your project root as commitlint.config.mjs
 */

const IMPLEMENTATION_TYPES = ['feat', 'fix', 'refactor', 'perf'];

// devaudit-installer#814 — shared by the body/footer max-line-length
// overrides below.
function maxLineLengthExceptSentinel(section, sectionName) {
  const MAX_LENGTH = 100;
  if (!section) return [true];
  const tooLong = section
    .split('\n')
    .filter(
      (line) =>
        line.length > MAX_LENGTH && !line.startsWith('Sdlc-Implementer-Sentinel:'),
    );
  return [
    tooLong.length === 0,
    `${sectionName}'s lines must not be longer than ${MAX_LENGTH} characters ` +
      '(Sdlc-Implementer-Sentinel: trailers are exempt — devaudit-installer#814)',
  ];
}

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
        'style',
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
    // devaudit-installer#814 — disable config-conventional's default
    // body/footer-max-line-length; the '*-except-sentinel' rules below
    // replace them with the same 100-char check minus the
    // Sdlc-Implementer-Sentinel: exemption.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'body-max-line-length-except-sentinel': [2, 'always', 100],
    'footer-max-line-length-except-sentinel': [2, 'always', 100],
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
              `(docs/style/chore/ci/build/test/compliance/revert) are exempt.`,
          ];
        },
        'trailer-co-authored-by': ({ raw }) => {
          const hasCoAuthor = /Co-Authored-By:/i.test(raw);
          return [
            hasCoAuthor,
            'AI-generated commits should include a "Co-Authored-By:" tag',
          ];
        },
        'body-max-line-length-except-sentinel': ({ body }) =>
          maxLineLengthExceptSentinel(body, 'body'),
        'footer-max-line-length-except-sentinel': ({ footer }) =>
          maxLineLengthExceptSentinel(footer, 'footer'),
      },
    },
  ],
  helpUrl: 'https://www.conventionalcommits.org/',
};
