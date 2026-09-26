---

description: "Task list for Releases and Publishing"
---

# Tasks: Releases and Publishing

**Input**: Design documents from `/specs/006-release-publishing/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md) (store research +
plan decisions R1–R11), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included. Constitution III requires a headless check for every rule, so test and check tasks
are part of the feature. Tests live in `test/tools/` (Vitest, Node); tag rules are tested against a
temporary git repository created in the test, never against this repository's tags.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1–US5)

## Path Conventions

Single project at the repository root: `src/adapters`, `packaging/kde/`, `tools/`, `test/`,
`.github/`, `docs/`. Tools may import from adapters only the files in
`TOOL_IMPORTABLE_ADAPTER_FILES` (`tools/checks/layers.ts`). Every CLI prints one JSON document on
stdout and uses the exit codes of `tools/shared/cli-runner.ts` (0 ok, 1 failure, 2 usage, 3 missing
prerequisite).

---

## Phase 1: Setup

**Purpose**: the command entry point and the one-time repository state.

- [X] T001 Add the script `"release": "node tools/release/cli.ts"` to `package.json` (keep `version` at `0.0.1` until T063) and create `tools/release/cli.ts` with `runCli('release', RELEASE_COMMANDS, argv)` from `tools/shared/cli-runner.ts`, registering the commands `check`, `assets`, `notes-draft` and `publish` as lazy `load` entries (modules added in later tasks), following the pattern of `tools/package/cli.ts`
- [X] T002 [P] Record in `specs/006-release-publishing/research.md` R9 that the owner changed the `github-pages` environment rule to allow `v*` tags on 2026-09-26 (the one-time step is done; `docs/releasing.md` still documents it for a fork or a new repository)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: project links, version arithmetic, archives for every host and the URL rule — every story
uses them.

**⚠️ CRITICAL**: no user story work starts before this phase is complete.

- [X] T003 Create `src/adapters/shared/project.ts` (DOM-free, no imports) with the constants of data-model "ProjectLinks": `REPOSITORY_URL = 'https://github.com/Alamion/heroes_III_ts'`, `ISSUES_URL`, `NEW_ISSUE_URL` (`…/issues/new/choose`), `RELEASES_URL`, `LATEST_RELEASE_URL`, `README_URL` (`…#readme`), `PAGES_URL = 'https://alamion.github.io/heroes_III_ts/'`, `WORKSHOP_ID: string | null = '3808342201'`, `KDE_STORE_URL: string | null = 'https://store.kde.org/p/2374098/'`, `AUTHOR = 'Alamion'`, plus `workshopUrl(): string | null` (`https://steamcommunity.com/sharedfiles/filedetails/?id=<id>`) and `projectUrls(): string[]` (every non-null URL above)
- [X] T004 Add `'src/adapters/shared/project.ts'` to `TOOL_IMPORTABLE_ADAPTER_FILES` in `tools/checks/layers.ts`, update the AGENTS.md sentence "from adapters they import only …" in the "Stack and Layout" section, and extend `test/tools/layers.test.ts` with a case that a tool importing `project.ts` passes
- [X] T005 [P] Create `tools/release/semver.ts`: `parseVersion(s)` → `{ major, minor, patch, prerelease: string[] }` (SemVer 2.0; reject build metadata `+…`, leading zeros and anything else with a typed `Error` naming the input), `compareVersions(a, b)` with SemVer precedence (numeric vs alphanumeric identifiers, pre-release before final), `formatVersion(v)`, `isPrerelease(v)`, `livelyVersion(v)` = `major*10000 + minor*100 + patch` throwing when `minor` or `patch` ≥ 100 (research R2)
- [X] T006 [P] Test `tools/release/semver.ts` in `test/tools/release-semver.test.ts`: parse/format round trip, the SemVer 2.0 precedence example chain (`1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0`), rejection of `v1.0.0`, `1.0`, `01.0.0`, `1.0.0+build`, and `livelyVersion` (`0.1.0` → 100, `1.2.3` → 10203, `0.100.0` throws)
- [X] T007 Change `artifactName` in `tools/package/cli.ts` so every host gets an archive: `heroes3-living-map-web-<v>.zip`, `heroes3-living-map-wallpaper-engine-<v>.zip`, `heroes3-living-map-lively-<v>.zip`, `heroes3-living-map-kde-<v>.tar.gz`; make `writePackage` write the archive for every host with `writeZip`/`writeTarGz` from `tools/shared/archive.ts` (the package folders stay); update `tools/checks/packages/index.ts` and `test/tools/packages-check.test.ts` wherever they assume folders for web and Wallpaper Engine (research R6)
- [X] T008 Replace the fixed `ALLOWED_URLS` in `tools/checks/packages/index.ts` `checkNoExternalUrls` with the XML namespaces plus exact matches of `projectUrls()` from `src/adapters/shared/project.ts` (a URL passes only when it equals one of them, ignoring a trailing `/`); add cases to `test/tools/packages-check.test.ts`: the issues URL passes, `https://example.com` and `https://github.com/someone-else` fail

**Checkpoint**: `yarn test`, `yarn package`, `yarn verify packages --no-build`, `yarn verify layers` pass; four archives exist in `dist/packages/`.

---

## Phase 3: User Story 1 — The maintainer cuts a release with one tag (Priority: P1) 🎯 MVP

**Goal**: a `v*` tag on `testing` runs every check and produces a GitHub Release with the packages,
checksums and changelog notes, and a final release redeploys Pages; invalid tags publish nothing.

**Independent Test**: [quickstart.md](quickstart.md) part 1 (local) and part 3 steps 2–6 (a pre-release
tag on GitHub, a re-run, a mismatching tag).

### Tests for User Story 1

- [X] T009 [P] [US1] Test the changelog parser in `test/tools/release-changelog.test.ts`: sections `## [X.Y.Z] - YYYY-MM-DD` found by version, `## [Unreleased]` ignored, missing section → `CHANGELOG_MISSING`, whitespace-only section → `CHANGELOG_EMPTY`, a pre-release (`0.2.0-beta.1`) falls back to the `0.2.0` section, a malformed heading date is an error naming the line
- [X] T010 [P] [US1] Test the tag rules in `test/tools/release-tags.test.ts` against a temporary git repository (`git init` in `mkdtempSync`, commits on a `testing` branch, a side branch, tags): each failure code of data-model "ReleaseTag" in order (`TAG_FORMAT`, `VERSION_MISMATCH`, `NOT_ON_TESTING`, `VERSION_NOT_HIGHER` for a final ≤ an existing final tag, pre-release allowed next to a newer final, `TAG_TAKEN`, `CHANGELOG_MISSING`/`CHANGELOG_EMPTY`, `LIVELY_VERSION_RANGE`), the success result (`livelyVersion`, `changelog`), and `--local` mode (tag absent, `HEAD`, local `testing`)
- [X] T011 [P] [US1] Test the asset writer in `test/tools/release-assets.test.ts` with a fake `dist/packages` tree and a synthetic changelog: file names of data-model "ReleaseAssets", `SHA256SUMS` in `sha256sum -c` format sorted by name and excluding itself, `release-notes.md` = changelog section + the "which file do I need" block, and byte-identical output on a second run

### Implementation for User Story 1

- [X] T012 [US1] Create `tools/release/changelog.ts`: `readChangelog(path)` → sections `{ version, date, body, line }`; `changelogSection(sections, version)` with the pre-release fallback and the failure codes of T009 (research R3, data-model "ChangelogSection")
- [X] T013 [US1] Create `tools/release/tags.ts`: git helpers through `execFileSync('git', …)` with a `cwd` parameter (`tagCommit`, `isAncestor(commit, ref)`, `listVersionTags()`), and `checkRelease({ tag, repoRoot, local, remoteRef })` implementing the ordered rules of data-model "ReleaseTag" using `semver.ts`, `changelog.ts` and `package.json`; returns `{ ok, tag, version, kind, livelyVersion?, changelog?, failure?: { code, message } }` with messages that name both values (e.g. "tag v0.2.0 but package.json says 0.1.0")
- [X] T014 [US1] Wire `check --tag vX.Y.Z [--local]` in `tools/release/cli.ts` to `checkRelease` (exit 1 with the result on failure, exit 2 without `--tag`) per [contracts/cli.md](contracts/cli.md)
- [X] T015 [US1] Create `tools/release/assets.ts`: `writeReleaseAssets({ repoRoot, version, packagesDir, outDir })` copies the four archives from `dist/packages/`, writes `release-notes.md` (changelog body + the block of T026 once it exists; until then a plain "Downloads" list of the four archives), and `SHA256SUMS`; fails with exit 3 naming the missing archive when `yarn package` has not run; wire `assets [--version] [--out dist/release] [--build]` in `tools/release/cli.ts` (`--build` runs `assemble`/`writePackage` for all hosts first)
- [X] T016 [US1] Create `tools/release/publish.ts` and wire `publish --tag vX.Y.Z --dir dist/release/X.Y.Z`: through `gh` (`execFileSync`, `GH_TOKEN` from the environment, exit 3 without `gh` or token) — `gh release view <tag> --json body,isPrerelease`; if it exists, `gh release upload <tag> <files…> --clobber` and `gh release edit <tag> --notes-file release-notes.md` only when `body` is empty (and `--prerelease` when the tag is one); otherwise `gh release create <tag> --verify-tag --title "Heroes 3 Living Map <version>" --notes-file release-notes.md [--prerelease]` then upload; never delete anything (FR-005, FR-006, FR-008). Upload every file of the directory except `release-notes.md`
- [X] T017 [P] [US1] Test `tools/release/publish.ts` in `test/tools/release-publish.test.ts` with an injected command runner (no real `gh`): existing release with notes → upload `--clobber`, no edit; existing release with empty body → edit; missing release → create with `--verify-tag`; pre-release tag → `--prerelease`; `release-notes.md` never uploaded
- [X] T018 [US1] Rename `.github/workflows/pages.yml` to `.github/workflows/ci.yml` and make it checks only per [contracts/release-workflow.md](contracts/release-workflow.md) "ci.yml": on push and pull_request to `testing` and `workflow_dispatch`, `contents: read`, steps install → `yarn build` → `yarn test` → `yarn package` → `yarn verify packages --no-build` → `yarn verify hosts --host web --no-build` → `yarn verify layers`; no Pages steps, no deploy job; header comment says Pages now deploys from releases (spec 006 FR-007 supersedes spec 004 FR-013a)
- [X] T019 [US1] Create `.github/workflows/release.yml` per [contracts/release-workflow.md](contracts/release-workflow.md): triggers `push: tags: ['v*']` and `workflow_dispatch` with required input `tag`; `TAG` resolved from either; concurrency `release-<tag>` without cancel; job `release` (`contents: write`, `H3_CHROMIUM: /usr/bin/google-chrome` as in ci.yml): checkout at the tag with `fetch-depth: 0`, `git fetch origin testing`, Node 22 + yarn cache, `yarn install --frozen-lockfile`, `yarn release check --tag $TAG`, `yarn build`, `yarn test`, `yarn package`, `yarn verify packages --no-build --reproducible`, `yarn verify hosts --no-build`, `yarn release assets`, `yarn release publish` with `GH_TOKEN: ${{ github.token }}`, `actions/upload-pages-artifact@v3` of `dist/packages/web` when not a pre-release; outputs `version`, `prerelease`; job `pages` (needs `release`, `if: needs.release.outputs.prerelease == 'false'`, `pages: write`, `id-token: write`, environment `github-pages`) with `actions/deploy-pages@v4`
- [X] T020 [US1] Create `CHANGELOG.md` at the repository root: a short header (format: one `## [X.Y.Z] - YYYY-MM-DD` section per version, written for users, Markdown subset of research R3) and an `## [Unreleased]` section; the `0.1.0` section itself is written in T062
- [X] T021 [US1] Run `yarn test test/tools/release-*` and quickstart part 1 up to `yarn release assets` with a scratch `0.1.0` section and version (revert both afterwards); fix failures

**Checkpoint**: locally, `yarn release check --tag v0.1.0 --local` passes only with a matching version and section, and `yarn release assets` writes the archives, notes and checksums. The GitHub run is exercised in T064.

---

## Phase 4: User Story 2 — A user downloads the wallpaper for their host (Priority: P1)

**Goal**: the release page names one package per host and ends with "which file do I need"; the README
points to the latest release and shows all hosts working; checksums verify.

**Independent Test**: read a generated `release-notes.md` and the README as a newcomer; `sha256sum -c
SHA256SUMS` in `dist/release/<v>/` passes.

- [X] T022 [P] [US2] Add the key `release_which_file` to both tables in `src/adapters/shared/strings.ts` (Markdown source with placeholders `{version}`, `{pages}`, `{workshop}`, `{kde_store}`, `{readme}`): one line per host — browser → `{pages}`; Wallpaper Engine → the Workshop page, or `heroes3-living-map-wallpaper-engine-{version}.zip` + README steps; Lively → drag `heroes3-living-map-lively-{version}.zip` into Lively; KDE → the KDE Store page or `kpackagetool6 -t Plasma/Wallpaper -i heroes3-living-map-kde-{version}.tar.gz`; checksums → `SHA256SUMS`. Keep the existing strings test (every key in en and ru) passing
- [X] T023 [US2] Create `tools/release/which-file.ts`: `whichFileBlock(version, lang)` fills `release_which_file` from `project.ts`, dropping the store link and keeping the package + README fallback for a host whose `WORKSHOP_ID`/`KDE_STORE_URL` is `null` (FR-014b); English block followed by the Russian block
- [X] T024 [P] [US2] Test `whichFileBlock` in `test/tools/release-which-file.test.ts`: all four archive names with the version, Workshop and KDE Store URLs present, and with a store constant overridden to `null` the line falls back to the package and README and contains no empty link or `null`
- [X] T025 [US2] Make `tools/release/assets.ts` append `whichFileBlock(version)` after the changelog body in `release-notes.md`, and add a line naming the repository's Issues as the place for suggestions and bug reports (uses `store_feedback` once T037 exists; until then `ISSUES_URL` directly); extend `test/tools/release-assets.test.ts`
- [X] T026 [US2] Update `README.md`: "Status" table shows all four hosts as working (Wallpaper Engine and Lively checked on Windows 2026-09-19 and 2026-09-25); "Getting started" gains a first paragraph linking the latest release (`https://github.com/Alamion/heroes_III_ts/releases/latest`), the Workshop page, the KDE Store page and the browser version; "Wallpaper Engine, Lively, KDE Plasma" replaces "Prebuilt packages are not published yet" with install steps from the release archives (Workshop subscribe; Lively drag the `.zip`; KDE "Get New Plugins…" or `kpackagetool6 -i` of the `.tar.gz`), keeping "build from source" as an alternative; add a "Feedback" line pointing to GitHub Issues
- [X] T027 [US2] Run `yarn release assets` with a scratch version and `sha256sum -c SHA256SUMS` inside `dist/release/<v>/`; revert the scratch version

**Checkpoint**: `release-notes.md` names every package and ends with the which-file block; README links resolve.

---

## Phase 5: User Story 3 — Store pages updated by hand from generated texts (Priority: P2)

**Goal**: Steam Workshop and KDE Store descriptions and change notes are generated in each store's
markup, within limits, and a checklist covers every manual step.

**Independent Test**: `yarn verify store-texts` passes; paste the generated texts into both stores'
editors (preview) following only `docs/releasing.md`.

### Tests for User Story 3

- [X] T028 [P] [US3] Test the markup converter in `test/tools/release-markup.test.ts`: each construct of the research R3 subset (`###` heading, `-` bullets with one nesting level, paragraphs, `**bold**`, `*italic*`, `` `code` ``, `[text](url)`) rendered to Markdown (unchanged), Steam BBCode (`[h2]`, `[list][*]…[/list]`, `[b]`, `[i]`, `[code]`, `[url=…]…[/url]`) and KDE BBCode (headings as `[b]…[/b]` on their own line, no `[h1]`/`[h2]`, no `[table]`); tables, images, HTML, `#`/`##` headings inside a section and a third list level each raise `MARKUP_UNSUPPORTED` naming the line
- [X] T029 [P] [US3] Test the store texts in `test/tools/release-store-texts.test.ts`: the Workshop title equals `APP_NAME`; both descriptions contain, in order, the English then the Russian block, each with `package_description`, `help_files`, `help_privacy`, the host help (`help_wallpaper_engine` / `help_kde` + `store_kde_requirements`), `store_links` and `store_feedback`; every URL is in `projectUrls()`; no word "official"; a text over its limit fails with the text name, the limit and the excess in UTF-8 bytes; a `null` store constant removes that store's link line

### Implementation for User Story 3

- [X] T030 [US3] Create `tools/release/markup.ts`: parse a changelog body into a small block list (heading, paragraph, list with nested list, inline spans) with line numbers and render it with the profiles `markdown`, `steam`, `kde`; plain strings from `strings.ts` go through the same inline renderer (links written as `{name}` placeholders are filled before rendering) (research R3)
- [X] T031 [US3] Wire the changelog markup check into `checkRelease` in `tools/release/tags.ts` (a section outside the subset fails with `MARKUP_UNSUPPORTED` before the build) and extend `test/tools/release-tags.test.ts`
- [X] T032 [US3] Add to both tables in `src/adapters/shared/strings.ts` the keys of [contracts/surfaces.md](contracts/surfaces.md) "New strings" that store texts need: `store_links` (`{repository}`, `{releases}`), `store_feedback` (`{issues}`; says store comments and reviews are not tracked), `store_kde_requirements` (Fedora `qt6-qtwebengine`, Debian/Ubuntu `qml6-module-qtwebengine`, Arch `qt6-webengine`); Russian translations written, not machine-literal; avoid the word "official"
- [X] T033 [US3] Create `tools/release/store-texts.ts`: `storeTexts(version, changelogBody)` → `{ name, store, kind, limit, content }[]` for `workshop-title.txt`, `workshop-description.bbcode`, `kde-store-description.bbcode`, `changenote-<v>.bbcode` (Steam) and `kde-changelog-<v>.bbcode`; descriptions = English block, a `----` separator line, Russian block (FR-012, research R5), each block: `package_description`, `help_files`, host help, `help_privacy`, `store_links`, the other store's page when set, `store_feedback`; `checkStoreText(text)` → limit in UTF-8 bytes, allowed tags per profile, balanced tags, URLs ⊂ `projectUrls()`
- [X] T034 [US3] Make `tools/release/assets.ts` write the five store texts into `dist/release/<v>/` (included in `SHA256SUMS`, uploaded by `publish`) and fail the command when any `checkStoreText` fails; extend `test/tools/release-assets.test.ts`
- [X] T035 [US3] Create `tools/checks/store-texts.ts` (`yarn verify store-texts`): builds the texts for the current version and for every changelog section, runs `checkStoreText`, writes `check-reports/store-texts/<time>/report.json` with each text's size, limit and headroom; register it in `tools/checks/cli.ts`, add it to `tools/checks/all.ts`, and add `yarn verify store-texts` to `.github/workflows/ci.yml` and `.github/workflows/release.yml` (before `yarn release assets`)
- [X] T036 [US3] Add a `yarn release texts [--out dist/release]` command in `tools/release/cli.ts` that writes only the store texts for the current version (for the maintainer between releases, e.g. after a description change)
- [X] T037 [US3] Write `docs/releasing.md` (FR-014, research R10): prepare (`yarn release notes-draft`, rewrite into `CHANGELOG.md`, bump `package.json`, `yarn release check --tag vX.Y.Z --local`, commit on `testing`); tag (local `git tag vX.Y.Z && git push origin vX.Y.Z`, or `gh release create vX.Y.Z --target testing --notes-file …`); pre-release tags (`-rc.N`, no Pages); watch the run and what each failure code means; Workshop update (unpack the WE archive over the editor's `myprojects` folder — it carries `workshopid` — never put `.lod`/`.h3m`/`maps.zip` there, Workshop → Share → "Publish update", paste `changenote-<v>.bbcode`, description from `workshop-description.bbcode` via "Edit title & description"; first publish: commit the id into `project.ts`); KDE Store update (replace the file, **set Version** — KNewStuff offers updates only when it changes — paste `kde-changelog-<v>.bbcode`, description from `kde-store-description.bbcode`; the form fields as recorded in research "Product form as filled"); store screenshots (constitution I as amended in T058); one-time settings (Pages environment allows `v*` tags); link it from `README.md` "Documentation"

**Checkpoint**: `yarn verify store-texts` passes and reports headroom; the checklist alone describes a full store update.

---

## Phase 6: User Story 4 — Every page sends feedback to GitHub Issues (Priority: P2)

**Goal**: every surface in [contracts/surfaces.md](contracts/surfaces.md) names the repository and the
Issues rule; issues open with forms.

**Independent Test**: `yarn verify packages` `feedback` check passes for all hosts; the web host
simulation sees the panel footer; opening a new issue on GitHub shows the two forms.

- [X] T038 [P] [US4] Update `tools/package/manifests/common.ts` `readme()`: a first line `Heroes 3 Living Map <version>` (pass the version in; update callers in `wallpaper-engine.ts`, `lively.ts`, `kde.ts`) and a footer after `help_privacy` with `store_links` and `store_feedback` filled from `project.ts` (plain text, URLs written out)
- [X] T039 [P] [US4] Update `tools/package/manifests/lively.ts` `livelyInfo(version)`: `Author: AUTHOR`, `Contact: ISSUES_URL`, `Version: livelyVersion(parseVersion(version))`; update `test/tools/manifests-lively.test.ts`
- [X] T040 [P] [US4] Update `tools/package/manifests/kde.ts` `metadataJson`: `Authors: [{ Name: AUTHOR }]`, `Website: REPOSITORY_URL`, `BugReportUrl: NEW_ISSUE_URL`; read the version through `packageVersion` from `tools/package/cli.ts` instead of its own `package.json` read; update `test/tools/manifests-kde.test.ts`
- [X] T041 [P] [US4] Update `tools/package/manifests/wallpaper-engine.ts` `projectJson()`: add `workshopid: WORKSHOP_ID` at the top level when it is not `null` (FR-014a); update `test/tools/manifests-wallpaper-engine.test.ts` (present with the id; absent when the constant is overridden to `null`)
- [X] T042 [US4] Add checks to `tools/checks/packages/index.ts`: `workshop-id` (WE `project.json` `workshopid` equals `WORKSHOP_ID`, or is absent when `null`), `feedback` (every readme contains `ISSUES_URL` and `REPOSITORY_URL`; Lively `Contact` = `ISSUES_URL` and `Author` = `AUTHOR`; KDE `Website`, `BugReportUrl`, `Authors[0].Name`; no `@` outside URLs in manifests and readmes — no e-mail, FR-017), `version` (readme first line and KDE/Lively metadata carry the package version); cover them in `test/tools/packages-check.test.ts`
- [X] T043 [P] [US4] Add `panel_version` (`Version {version}` / `Версия {version}`) and `panel_report` (`Report a problem` / `Сообщить о проблеме`) to both tables in `src/adapters/shared/strings.ts`
- [X] T044 [US4] Inject the version into the browser build: `define: { __H3_VERSION__: JSON.stringify(version) }` in `buildWeb` (`tools/package/build.ts`, version from `packageVersion`) and in `vite.config.ts` (dev harness, read from `package.json`); declare `declare const __H3_VERSION__: string` where the web adapter reads it (`src/adapters/web/main.ts` or a small `src/adapters/web/version.ts`)
- [X] T045 [US4] Add a footer to the panel in `src/adapters/web/panel.ts` after the keys line: `format(lang, 'panel_version', { version })` and a link `<a href={NEW_ISSUE_URL} target="_blank" rel="noopener">` with `panel_report`; style it in `src/adapters/web/panel.css` (small, muted like `.h3p-keys`); the CSP of `src/adapters/web/index.html` needs no change (navigation, not a fetch)
- [X] T046 [US4] Extend the web host simulation (`tools/checks/hosts/invariants.ts`, a new invariant 21 limited to the web driver, or the web panel tests if they exist) to assert the footer shows the package version and the link target is `NEW_ISSUE_URL`; update the invariant range in AGENTS.md ("invariants 1–20")
- [X] T047 [P] [US4] Create `.github/ISSUE_TEMPLATE/bug.yml` (name "Bug report"; fields: host dropdown Browser / Wallpaper Engine / Lively / KDE Plasma, required; version input, required, placeholder "0.1.0 — shown in the panel, the package readme or the store page"; map input; what happened textarea, required, with a note that screenshots can be pasted; what was expected textarea, required; OS input), `.github/ISSUE_TEMPLATE/suggestion.yml` (what and why, required; host dropdown, optional) and `.github/ISSUE_TEMPLATE/config.yml` (`blank_issues_enabled: false`) per [contracts/release-workflow.md](contracts/release-workflow.md)
- [X] T048 [US4] Run `yarn package`, `yarn verify packages --no-build`, `yarn verify hosts --host web --no-build`; fix failures

**Checkpoint**: every surface of the contracts table carries the repository and the Issues note; the `feedback` check guards it.

---

## Phase 7: User Story 5 — A KDE user without Qt WebEngine sees what to install (Priority: P3)

**Goal**: a missing Qt WebEngine QML module shows a readable message instead of a black desktop.

**Independent Test**: `yarn verify packages` `kde-webengine-fallback` passes; `yarn accept kde
--simulate-missing-webengine` exits 0 on a real Plasma session (quickstart part 2).

- [X] T049 [P] [US5] Add `kde_webengine_missing` to both tables in `src/adapters/shared/strings.ts` ([contracts/surfaces.md](contracts/surfaces.md): needs Qt WebEngine, install and restart Plasma, Fedora `qt6-qtwebengine`, Debian/Ubuntu `qml6-module-qtwebengine`, Arch `qt6-webengine`)
- [X] T050 [US5] Create `packaging/kde/contents/ui/WebView.qml`: move the `WebEngineView` from `main.qml` unchanged in behaviour (imports `QtQuick`, `QtWebEngine`, `"."` for `SharedProfile`), with properties `paused` and `configJson`, a signal `ready()` after `LoadSucceededStatus`, and functions `pushConfig(json)` / `pushPaused(paused)` calling `runJavaScript` as today
- [X] T051 [US5] Rewrite `packaging/kde/contents/ui/main.qml` per [contracts/surfaces.md](contracts/surfaces.md) "KDE shell": imports only `QtQuick`, `org.kde.plasma.plasmoid` and `"strings.js" as Strings` (no `QtWebEngine`, no `"."`); `Loader { id: view; source: "WebView.qml"; active: !root.onLockScreen }`; `pushConfig`/`pushPaused` go through `view.item` when `view.status === Loader.Ready`; when `view.status === Loader.Error`, a centred wrapped `Text` (light colour on the black background, width ~60 % of the screen) with `Strings.table(Qt.uiLanguage !== "" ? Qt.uiLanguage : Qt.locale().name).kde_webengine_missing`, and `console.log("[h3dynam] webengine-missing")` once; lock screen and watchers unchanged
- [X] T052 [US5] Package `WebView.qml` in `tools/package/manifests/kde.ts` (add it to the list copied from `packaging/kde/contents/ui/`) and update `test/tools/manifests-kde.test.ts`
- [X] T053 [US5] Add the `kde-webengine-fallback` check to `tools/checks/packages/index.ts` (research R7): `contents/ui/main.qml` has no `import QtWebEngine` and no `import "."`, contains a `Loader` with `source: "WebView.qml"` and a `Loader.Error` branch using `kde_webengine_missing`; `contents/ui/WebView.qml` exists and imports `QtWebEngine`; `contents/ui/strings.js` contains the three package names in both tables; cover pass and fail cases in `test/tools/packages-check.test.ts`
- [X] T054 [US5] Add `--simulate-missing-webengine` to `yarn accept kde` in `tools/accept/kde.ts`: build the KDE package into a temporary folder, replace `import QtWebEngine` in `contents/ui/WebView.qml` with `import QtWebEngineMissingForTest`, install/upgrade it (restart plasmashell as for any upgrade), apply it to `--screen` (default 0), wait up to 30 s for `[h3dynam] webengine-missing` in `journalctl --user -u plasma-plasmashell.service --since <start>`, then reinstall the real package and restore the previous plugin and settings like `--apply` does; exit 0 when the line appeared, 1 otherwise; document it in AGENTS.md "Commands"
- [ ] T055 [US5] Run `yarn package`, `yarn verify packages --no-build`, `yarn verify hosts --host kde --no-build`; on the owner's Plasma session run `yarn accept kde --simulate-missing-webengine` and then `yarn accept kde --apply` to confirm the map still shows with Qt WebEngine present (acceptance scenario US5-2); record the result in `specs/006-release-publishing/research.md` R7

**Checkpoint**: the fallback is structurally guarded in CI and seen once on a real session.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T056 [P] Implement `notes-draft [--since vX.Y.Z]` in `tools/release/changelog.ts` + `tools/release/cli.ts` (FR-010): `git log <last final tag or root>..HEAD --format=%s`, keep `feat`/`fix` subjects, strip `type(scope):` prefixes (`feat(005): x` → `x`), group under `### Added` / `### Fixed`, print `## [Unreleased]` Markdown on stdout, never write a file; test the subject transformation in `test/tools/release-changelog.test.ts`
- [X] T057 [P] Update `docs/architecture.md` with a "Releases" section: `tools/release/` modules, the two workflows, where versions, links and store ids live (`package.json`, `project.ts`), and how assets are named
- [X] T058 Amend `.specify/memory/constitution.md` to 1.4.0 (research R11): principle I's documentation-screenshot exception also allows the maintainer to upload such screenshots (same kind and size limits) to store pages; they MUST NOT enter packages, release assets or build output; Sync Impact Report on top (MINOR, dependent files: AGENTS.md "Local-Only Folders" note, `docs/releasing.md`); `Last Amended: 2026-09-26`
- [X] T059 Update `AGENTS.md`: "Current State" gains the release facts (tag-triggered `release.yml`, Pages only from final releases, `ci.yml` checks only, store items `3808342201` / `2374098` in `project.ts`, KDE Store updates need the product Version changed), "Commands" gains `yarn release check|assets|texts|notes-draft|publish`, `yarn verify store-texts`, `yarn accept kde --simulate-missing-webengine`; the "Platform Adapter Notes" KDE bullet mentions `WebView.qml` behind a `Loader`; "(GitHub Pages from `testing`)" becomes "(GitHub Pages from releases)"
- [X] T060 [P] Update `specs/004-platform-adapters/spec.md` FR-013a with a one-line note "Superseded by spec 006 FR-007: Pages deploys from final releases only"
- [X] T061 Run the full local gate: `yarn build`, `yarn test`, `yarn verify layers`, `yarn package`, `yarn verify packages --no-build --reproducible`, `yarn verify hosts --no-build`, `yarn verify store-texts`; fix failures
- [ ] T062 Write the `0.1.0` section of `CHANGELOG.md` for users (start from `yarn release notes-draft --since` the root; cover: animated adventure maps of RoE/AB/SoD and HotA 1.8 with terrain, objects, heroes, towns and shadows; browser, Wallpaper Engine, Lively and KDE Plasma 6; folder of maps with rotation and filters; random places; files stay local) in the research R3 subset, and ask the owner to review the wording before tagging
- [X] T063 Bump `package.json` `version` to `0.1.0`, run `yarn release check --tag v0.1.0 --local` and `yarn release assets`, review the generated `release-notes.md` and store texts with the owner; commit on the feature branch
- [ ] T064 After the owner merges the branch into `testing`: push a pre-release tag `v0.1.0-rc.1` and follow [quickstart.md](quickstart.md) part 3 steps 3–5 (pre-release with all assets, Pages untouched, a re-run keeps notes and hashes, a mismatching tag such as `v0.1.1-rc.1` fails at `yarn release check`); record the run time against SC-001 in `specs/006-release-publishing/research.md`; delete the test release and tag with `gh release delete v0.1.0-rc.1 --cleanup-tag` (owner confirms each tag push and deletion)
- [ ] T065 With the owner's go-ahead, tag `v0.1.0` (quickstart part 3 step 6), confirm the release page, `sha256sum -c`, and the Pages footer "Version 0.1.0"; the owner updates the Workshop item and the KDE Store product following `docs/releasing.md` (quickstart step 7) and reports anything the checklist missed, which is then added to it

---

## Phase 9: Check speed (SC-001) — added 2026-09-26

**Purpose**: `yarn verify hosts` for all hosts took 42 min locally (91 invariants, ~28 s each) with only
~3.5 min of CPU in the node process — the time goes into waiting, not work. The release run must stay
under 20 min (SC-001). Done before T063–T065 (owner decision 2026-09-26).

- [X] T066 Add timing to `tools/checks/hosts/`: per invariant the duration in the log line and the report (`ms`), and per wait helper (`loaded`, `folderShown`, `nextShown`, `idle`, and every `waitForFunction(...).catch(() => undefined)` in `tools/checks/hosts/invariants.ts`) a record when it ended by **timeout** instead of its condition (`timeouts: [{ where, ms }]` in the invariant result, a `warn` log line); the host report lists the slowest invariants
- [X] T067 Measure one full host (`yarn verify hosts --host web --no-build`) with T066, record in `specs/006-release-publishing/research.md` (new section "Check speed") where the time goes, and fix every wait that ends by timeout in the normal case (wrong condition, a condition that can never become true for that host, or a fixed wait longer than needed) in `tools/checks/hosts/invariants.ts` / `drivers.ts`, without weakening any invariant
- [X] T068 Add `--jobs N` to `yarn verify hosts` (default: half the CPU cores, at least 1; `--jobs 1` = today's order): invariants of a host run in a pool of N concurrent browser contexts on one browser; invariants that measure time or races (at least the pause/visibility, read-delay and `timeScale` ones — list them in a `serial: true` flag on the check) run alone after the pool; results keep the invariant order; document in AGENTS.md "Commands"
- [X] T069 Split host simulations across GitHub runners in `.github/workflows/release.yml`: a `hosts` job with `strategy.matrix.host: [web, wallpaper-engine, lively, kde]` (build, package that host, `yarn verify hosts --host ${{ matrix.host }} --no-build`), and the `release` job's publish step `needs` it; keep every other check before publishing (SC-002)
- [X] T070 Re-measure: all hosts locally with the default `--jobs` and the timeouts fixed; record before/after in research "Check speed" and the expected release run time; re-run `yarn test`, `yarn verify packages --no-build`, and confirm every invariant still passes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories.
- **US1 (Phase 3)** needs Phase 2 (archives, semver). It is the MVP and the only story that publishes.
- **US2 (Phase 4)** needs US1's `assets.ts` (T015) for the release notes; the README task (T026) is
  independent.
- **US3 (Phase 5)** needs Phase 2 (`project.ts`) and US1's `changelog.ts`/`assets.ts` (T012, T015) to
  attach texts; the converter and texts themselves are independent.
- **US4 (Phase 6)** needs Phase 2 only; T042 needs T038–T041; T045 needs T043–T044; T025 of US2 uses
  `store_feedback` from T032 when available.
- **US5 (Phase 7)** needs Phase 2 only; T051 needs T049–T050; T053 needs T051–T052; T055 needs a real
  Plasma session.
- **Polish (Phase 8)**: T061 after all stories; T062 → T063 → T064 → T065 in order, each with the owner.

### Within Each User Story

Tests first (they fail), then the modules they test, then CLI wiring, workflows and docs, then the
story's run task.

### Parallel Opportunities

- Phase 2: T005 ∥ T006 ∥ T003 (different files); T007 and T008 both touch the packages check — sequential.
- US1: T009 ∥ T010 ∥ T011 ∥ T017 (test files); T018 ∥ T020 (workflow vs changelog file).
- US3: T028 ∥ T029; T032 (strings) ∥ T030 (markup).
- US4: T038 ∥ T039 ∥ T040 ∥ T041 ∥ T043 ∥ T047.
- US4, US5 and the README task T026 can run alongside US1 once Phase 2 is done — they touch different files
  except `strings.ts` (T022, T032, T043, T049: edit sequentially or merge carefully).

### Parallel Example: User Story 4

```text
T038 readme header/footer        (tools/package/manifests/common.ts)
T039 Lively author/contact/version (tools/package/manifests/lively.ts)
T040 KDE website/bug URL/author   (tools/package/manifests/kde.ts)
T041 WE workshopid                (tools/package/manifests/wallpaper-engine.ts)
T047 issue forms                  (.github/ISSUE_TEMPLATE/)
then T042 packages checks, T043–T046 browser footer
```

---

## Implementation Strategy

### MVP (User Story 1)

Phases 1–3: a tag produces a checked GitHub Release with all four archives, checksums and changelog
notes, and Pages follows final releases. Stop and validate with quickstart part 1; the GitHub dry run
waits for T064.

### Incremental Delivery

1. Phase 2 → packages as archives, URL rule ready.
2. US1 → releases work (MVP).
3. US2 → the release page and README guide users.
4. US3 → store texts and the checklist (the next manual store update uses them).
5. US4 → feedback routing everywhere.
6. US5 → KDE fallback.
7. Polish → constitution, docs, CHANGELOG 0.1.0, dry run, `v0.1.0`.

### Notes

- Never push tags, create releases or delete them without the owner's confirmation (T064, T065).
- Never commit game files; tests use fake package trees and temporary git repositories.
- Commit after each phase with `feat(006): …` / `docs(006): …` messages.
