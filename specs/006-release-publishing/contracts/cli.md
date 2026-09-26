# Contract: Commands

All commands print one JSON document on stdout, log to stderr, and use the project exit codes
(0 ok, 1 failure, 2 usage, 3 missing prerequisite). New script in `package.json`:
`"release": "node tools/release/cli.ts"`.

## `yarn release check --tag vX.Y.Z [--local]`

Runs the ReleaseTag validation of [data-model.md](../data-model.md) in order.

- Without `--local` the tag must exist and the ancestry check uses `origin/testing`.
- `--local` (before tagging): the tag need not exist; the commit is `HEAD`; ancestry uses the
  local `testing` branch.

```json
{ "ok": false, "tag": "v0.1.0", "version": "0.1.0", "kind": "final",
  "failure": { "code": "VERSION_NOT_HIGHER", "message": "0.1.0 is not higher than the released 0.1.0 (v0.1.0)" } }
```

On success `failure` is absent and the result carries `livelyVersion` and `changelog` (the section
body, Markdown).

## `yarn release assets [--version X.Y.Z] [--out dist/release]`

Assumes `yarn package --host all` has run (or runs it with `--build`). Writes ReleaseAssets into
`<out>/<version>/`. Fails (1) when a store text is over its limit or a changelog section uses
unsupported markup — the same rules as `yarn verify store-texts`. Output lists every file with its
size and SHA-256.

## `yarn release notes-draft [--since vX.Y.Z]`

Prints a Markdown draft of the next changelog section to stdout (`## [Unreleased]`, "Added",
"Fixed"), built from `feat`/`fix` commit subjects since the last final tag, spec scopes removed.
Never writes files.

## `yarn release publish --tag vX.Y.Z --dir dist/release/X.Y.Z` (CI)

Needs `gh` and `GH_TOKEN`. `gh release view` → exists: `gh release upload --clobber` of every asset,
and `gh release edit --notes-file release-notes.md` only when the body is empty; missing:
`gh release create <tag> --verify-tag --title "Heroes 3 Living Map <version>"
--notes-file release-notes.md [--prerelease]` then upload. Never deletes a release or a tag.

## `yarn verify store-texts`

Generates the store texts in memory from the current strings, ProjectLinks and every changelog
section, and checks: limits (UTF-8 bytes), markup profile (only the allowed tags, balanced),
required content (FR-012: the feedback note, the repository link, the no-game-files sentence, the
per-host quirks, English before Russian), URLs ⊂ ProjectLinks. Report in
`check-reports/store-texts/<time>/report.json` with each text's size and headroom. Part of
`yarn verify all`.

## Changed commands

- `yarn package`: every host writes an archive (research R6); WE `project.json` carries `workshopid`
  when set; readmes carry version, links and the feedback note.
- `yarn verify packages`: `no-external-urls` allows ProjectLinks; new checks `workshop-id` (WE),
  `feedback` (readme and manifest fields per host), `kde-webengine-fallback` (research R7).
- `yarn accept kde --simulate-missing-webengine`: installs the variant, applies it to the screen,
  waits up to 30 s for `[h3dynam] webengine-missing` in the plasmashell journal, restores the
  previous plugin and settings; exit 0 when the line appears.
