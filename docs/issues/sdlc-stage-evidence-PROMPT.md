Read the file `docs/issues/sdlc-stage-evidence-IMPLEMENTATION.md` in full. It contains 7 tasks labelled T1 through T7 (plus T6b). Execute every task in order, exactly as written. Do not skip any task. Do not improvise or make decisions beyond what the guide specifies.

Rules (also stated in the guide — repeat for safety):
- Edit ONLY files under `sdlc/`, `scripts/`, and `cli/src/`. Never edit `cli/sdlc/` or `cli/scripts/` — those are auto-generated snapshots.
- Use the exact stage numbers given in each task. Do not choose your own.
- Each task gives you the exact file path, the exact text to find, and the exact replacement. Apply them verbatim.
- T6 creates a new file (`sdlc/files/ci/feature-e2e.yml.template`). T6b adds one line to an existing array in `cli/src/update/ci-templates.ts`. Both are required.
- T7 adds a test case to `scripts/upload-evidence.test.sh` following the existing test style in that file.

After completing all tasks, run the verification commands from the "Verification" section of the guide:

```
bash -n scripts/upload-evidence.sh
bash scripts/upload-evidence.test.sh
test -f sdlc/files/ci/feature-e2e.yml.template && echo "OK feature-e2e template"
grep -n "sdlc-stage" scripts/upload-evidence.sh sdlc/files/ci/*.template
grep -n "feature-e2e.yml.template" cli/src/update/ci-templates.ts
npm --prefix cli run build
npm --prefix cli test
```

All of these must pass. If any fail, read the error, fix your edit, and re-run until green. Do not mark the work done until every verification command succeeds.

Do not attempt any portal-side work. That is a separate repository and is out of scope for this task.
