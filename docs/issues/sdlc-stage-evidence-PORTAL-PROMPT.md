You are working in the `metasession-dev/devaudit` repository (the DevAudit compliance portal — a Next.js + Prisma + PostgreSQL app). A companion document has been provided with exact implementation instructions.

Read the file `docs/issues/sdlc-stage-evidence-PORTAL-IMPLEMENTATION.md` in full. It contains 12 tasks labelled P1 through P12. Execute every task in order, exactly as written. Do not skip any task. Do not improvise or make decisions beyond what the guide specifies.

Rules (also stated in the guide — repeated for safety):
- The guide gives you exact file paths, exact text to find, and exact replacements. Apply them verbatim.
- Run `npx prisma format` and `npx prisma generate` after editing `prisma/schema.prisma` (Task P1).
- Task P5 requires installing `adm-zip` (`npm install adm-zip` and `npm install -D @types/adm-zip`). If you find server-side ZIP extraction problematic, the guide offers a simpler client-side alternative using `fflate` — that is acceptable.
- Task P7, P8, P9 create new files. Task P5b creates a new API route file. Task P12b, P12c create new test files. All other tasks edit existing files.
- Do NOT modify `lib/validators/screenshot-filename.ts` — it is already gated on `evidenceType === 'screenshot'` and does not affect the new `playwright_report_bundle` type.
- Do NOT make `sdlcStage` a required field. It must remain optional.
- Do NOT edit `supabase/migrations/` — the portal uses Prisma migrations. Only create `prisma/migrations/20_sdlc_stage/`.
- Do NOT remove or rename any existing evidence types.

After completing all tasks, run the verification commands from the "Verification" section of the guide:

```
npx prisma format
npx prisma generate
npx tsc --noEmit
npm test
node -e "const { VALID_EVIDENCE_TYPES } = require('./lib/config/evidence-types'); console.log(VALID_EVIDENCE_TYPES.includes('playwright_report_bundle') ? 'OK' : 'MISSING')"
test -f prisma/migrations/20_sdlc_stage/migration.sql && echo "OK migration"
```

All of these must pass. If any fail, read the error, fix your edit, and re-run until green. Do not mark the work done until every verification command succeeds.

Context — what this feature does and why:
The DevAudit-Installer repository (the producer) is simultaneously adding an `--sdlc-stage` flag to its evidence upload script and CI templates. This portal-side work makes the portal accept, store, and render that new field. The portal must ship first (tolerant-read: missing `sdlcStage` → stored as `null`, no breaking change). The feature also adds a new `playwright_report_bundle` evidence type so the portal can extract and inline-render full Playwright ZIP reports, plus a stage-aware completeness matrix and AC-proof vs run-context evidence classification.
