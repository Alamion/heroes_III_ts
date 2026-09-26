# Quickstart: validating Releases and Publishing

Prerequisites: Node 22, yarn, the system Chromium (as for `yarn verify hosts`), `gh` logged in for
the end-to-end part. No game files are needed; real-file suites skip as usual.

## 1. Local, no network

```bash
yarn test                                   # semver, changelog parser, markup profiles, store texts, manifests
yarn package --host all                     # four archives in dist/packages/
yarn verify packages --no-build --reproducible   # + workshop-id, feedback, kde-webengine-fallback
yarn verify store-texts                     # limits and markup; report lists the headroom of each text
yarn release notes-draft                    # a Markdown draft on stdout, nothing written
yarn release check --tag v0.1.0 --local     # after bumping package.json and writing the 0.1.0 section
yarn release assets                         # dist/release/0.1.0/: archives, texts, SHA256SUMS
(cd dist/release/0.1.0 && sha256sum -c SHA256SUMS)
```

Expected: every command exits 0; `unzip -p …wallpaper-engine-0.1.0.zip project.json` shows
`"workshopid": "3808342201"`; the Lively `LivelyInfo.json` has `"Version": 100` and
`"Contact": "https://github.com/Alamion/heroes_III_ts/issues"`.

Negative checks (each exits 1 with the named code, nothing written):

```bash
yarn release check --tag v0.2.0 --local     # VERSION_MISMATCH
# empty the 0.1.0 section → CHANGELOG_EMPTY; add a table to it → MARKUP_UNSUPPORTED
# lengthen store_links past 8000 bytes in a scratch change → yarn verify store-texts fails naming the text
```

## 2. KDE without Qt WebEngine (real Plasma session)

```bash
yarn accept kde --simulate-missing-webengine
```

Expected: exit 0, the journal line `[h3dynam] webengine-missing` was seen, the screen showed the
message, the previous wallpaper came back. `yarn accept kde --apply` afterwards shows the map as
before (acceptance scenario US5-2).

## 3. End to end on GitHub (pre-release first)

1. One-time: Settings → Environments → `github-pages` → allow tags `v*`.
2. `git tag v0.1.0-rc.1 && git push origin v0.1.0-rc.1` (a `0.1.0` changelog section is enough).
3. The `release` run: checks, builds, publishes a **pre-release** with four archives,
   `SHA256SUMS` and five texts; the `pages` job is skipped; Pages still serves the previous build.
4. Re-run the workflow for the same tag: assets are replaced, the notes stay, sizes and hashes
   are unchanged.
5. Push a tag whose version differs from `package.json`: the run fails at `yarn release check`,
   no release appears.
6. The real release: `v0.1.0` → a final release, then Pages serves the panel footer "Version 0.1.0".
7. Follow `docs/releasing.md` for the Workshop and KDE Store updates, using only the attached texts.

Delete the test pre-release and its tag afterwards (`gh release delete v0.1.0-rc.1 --cleanup-tag`).
