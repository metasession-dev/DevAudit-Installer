# Reviewing sync conflicts (`.devaudit-new` files)

`devaudit update` never overwrites a managed file that has changed since
devaudit last wrote it (devaudit-installer#930). It leaves your file alone,
writes the new framework version next to it as `<path>.devaudit-new`, and
records the path as a conflict in `.devaudit/sync-manifest.json`. The
mechanism is described in
[consuming-projects.md § Sync conflicts](consuming-projects.md#sync-conflicts).
This page is the **review process**. Run it every time a sync reports
conflicts.

A conflict is not an error. It does mean your copy of that file no longer
gets framework fixes. Every update that leaves it unresolved widens the gap,
so resolve conflicts in the same PR that adopts the update.

## When to run it

| Trigger | Who |
| --- | --- |
| `devaudit update` prints `N file(s) have local modifications devaudit will not overwrite` | Whoever ran the update, in the adoption PR |
| `devaudit doctor` reports the `sync-conflicts` check with entries | The repository owner, before the next update |
| The release-validation gate lists `WARN conflicts` for a consumer ([release-validation-plan.md](release-validation-plan.md)) | The installer maintainer cutting the release (see [For installer maintainers](#for-installer-maintainers)) |

Target state: **zero unresolved conflicts after each adoption PR merges.** A
conflict carried over to a second update needs a written reason in the PR,
for example "waiting on installer#NNN".

## 1. List the conflicts

Any of these gives the same list:

```bash
devaudit doctor                                   # the sync-conflicts check
find . -name '*.devaudit-new' -not -path './node_modules/*'
jq -r '.files | to_entries[] | select(.value.conflict) | .key' .devaudit/sync-manifest.json
```

The update's own summary also separates two kinds:

- **write conflicts:** a `<path>.devaudit-new` exists next to the file.
- **stale-modified:** the framework no longer ships the file, but your copy
  changed, so devaudit kept it. There is no `.devaudit-new` file. Delete the
  file if nothing references it. That is the usual case, and the conflict
  clears on the next update. To keep it, move it to a path devaudit does not
  manage (for example under `scripts/local/`) and update anything that
  references it.

## 2. Diff each one

```bash
git diff --no-index -- <path> <path>.devaudit-new
```

Lines starting with `-` are yours. Lines starting with `+` are the new framework version.
For a CI workflow, also diff the template change itself. The
[installer CHANGELOG](../cli/CHANGELOG.md) names the issue behind each
change.

## 3. Classify and act

Give each path exactly one of these outcomes:

| # | What the diff shows | Action |
| --- | --- | --- |
| A | No change you meant to keep: an old framework version, a formatter difference, an edit someone made and forgot | **Take upstream:** `mv <path>.devaudit-new <path>` |
| B | A deliberate local change that an `sdlc-config.json` key already supports (runner, `app_env`, `e2e_*`, `database_*`, `paths_ignore`, ...) | Set the key, take upstream (`mv`), and re-run `devaudit update` to confirm the rendered file now carries your value |
| C | A deliberate local change with no config key | Capture it as a patch, then take upstream (below). Open, or link, an installer issue asking for a key, and name it in the `.patch.json` |
| D | Your change fixes a framework bug | Same as C, but the installer issue is a bug report. Delete the patch once the fix ships |
| E | A file that existed before onboarding at a devaudit-managed path | Migrate its content as described in [onboarding.md](onboarding.md), then take upstream |
| F | Unsure | Leave it. Do **not** delete the `.devaudit-new` file. Note the path in the PR and ask the owner of the file |

Capturing a deliberate change as a patch (outcomes C and D):

```bash
diff -u --label "a/<path>" --label "b/<path>" <path>.devaudit-new <path> \
  > .devaudit-patches/<name>.patch
cat > .devaudit-patches/<name>.patch.json <<'EOF'
{ "upstream_issue": "https://github.com/metasession-dev/DevAudit-Installer/issues/NNN",
  "reason": "<one line: why this project needs the change>" }
EOF
mv <path>.devaudit-new <path>
```

`update` re-applies the patch after every sync and records the patched
content, so the file reads as clean from then on. The patch rules are in
[consuming-projects.md § Temporary consumer patches](consuming-projects.md#temporary-consumer-patches).

**Don't:**

- Merge parts of `.devaudit-new` into your file by hand. The result matches
  neither version, so it stays a conflict on every sync.
- Edit `.devaudit/sync-manifest.json` to clear a conflict.
- Commit a `.devaudit-new` file. It is gitignored. Leaving it on disk is
  fine for outcome F.

## 4. Verify

```bash
devaudit update .            # conflicts you resolved no longer appear
devaudit doctor              # sync-conflicts lists only the F paths you kept
git status --short           # no *.devaudit-new left except F paths
```

A patch you just wrote should show as `applied: <name>.patch` in the update
output.

## 5. Record

Put a table in the adoption PR description. It is the audit trail for the
decision:

```markdown
| Path | Outcome | Note |
| --- | --- | --- |
| .github/workflows/ci.yml | C | runner label; patch + installer#NNN |
| scripts/validate-commits.sh | A | old local fix, superseded by installer#966 |
```

## For installer maintainers

The release-validation gate runs `update` on a throwaway clone of each
consumer and lists conflicts as `WARN` rows. Before the release, give each
consumer a one-line disposition in the gate results:

- Group the conflicted paths by file. If the release changes a file that
  consumers have in conflict, say so in the release notes: those consumers
  will not get that change until they resolve the conflict.
- The same local edit in several consumers is a missing config key. Open an
  installer issue for it instead of asking every consumer to patch.
- Conflicts never block a release. They need a disposition, not a fix.

Releases before v1.8.0 had a bug (devaudit-installer#988): on the **second**
update, a conflict recorded without a usable baseline could be overwritten.
From v1.8.0, a path recorded as a conflict is never written or removed until
it is resolved. If a consumer ran two updates on 1.7.4–1.7.6, check that its
earlier local changes are still present.
