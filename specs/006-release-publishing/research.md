# Research: Releases and Publishing

Pre-spec research, 2026-09-24 (web sources; the store sites store.kde.org / pling.com sit behind an
anti-bot wall and could not be read directly — points marked *unverified* come from secondary
sources). `/speckit-plan` extends this file with design decisions.

## Hosts and their stores

| Host | Store | Moderation | Upload API / CI | Decision |
| --- | --- | --- | --- | --- |
| Wallpaper Engine | Steam Workshop (app 431960) | none before publishing; reports afterwards; curated "Approved" tag is a quality mark only | steamcmd `workshop_build_item` exists, **never confirmed for WE items** | by hand, through the WE editor |
| KDE Plasma 6 | store.kde.org, category 715 "Plasma 6 Wallpaper Plugins" | none before publishing; audits and reports afterwards | **no upload API**; only an HTML-scraping script | by hand |
| Lively | none (gallery never shipped) | — | — | `.zip` on the GitHub Release |
| Browser | GitHub Pages | — | Actions (already used) | CI on release tags |

### Steam Workshop (Wallpaper Engine)

- Normal path: WE editor → "Share wallpaper on Workshop": title, description, genre, age rating
  (mandatory, must match content), visibility. After the first publish the editor writes `workshopid`
  into `project.json`; later publishes become "Publish update".
  <https://docs.wallpaperengine.io/en/scene/first/publishing.html>
- Preview: jpg/png/gif, ≤ 256×256 (WE requests 128×128), ≤ 1 MB (< 500 KB recommended), all-ages.
- Limits (Steamworks constants): title 128 characters, description 8000; change notes presumably the
  same (inferred). Markup: Steam BBCode.
  <https://github.com/SteamRE/open-steamworks/blob/master/Open%20Steamworks/RemoteStorageCommon.h>
- No localisation of the Workshop title/description through the editor or steamcmd (Steam's UGC API
  has `SetItemUpdateLanguage`, steamcmd's VDF does not) → one text, English then Russian.
- Rules: Valve's Workshop rules, shown in the editor (Steam → Workshop Rules); no published rule found
  against a renderer that needs user-supplied game files; WE's copyright cases are about redistributed
  assets. Avoid official logos in title and preview (constitution I already requires this).
- Automation, for later: `steamcmd +workshop_build_item item.vdf` (keys `appid`, `publishedfileid`,
  `contentfolder`, `previewfile`, `changenote`; omitted keys stay unchanged, so the description can be
  left alone). Action `m00nl1ght-dev/steam-workshop-deploy@v4` (v1–v3 disabled over a security issue).
  The uploading account must own WE and be the item's owner or contributor; Steam Guard needs a TOTP
  `shared_secret` or a cached `config.vdf` that expires. Credentials would sit in repository secrets —
  pin actions by SHA. Unverified: whether items updated by steamcmd stay fully compatible with WE, and
  whether the editor and steamcmd overwrite each other's uploads.
  <https://partner.steamgames.com/doc/features/workshop/implementation>,
  <https://github.com/marketplace/actions/steam-workshop-deploy>, <https://github.com/game-ci/steam-deploy>

### KDE Store

- Category 715 "Plasma 6 Wallpaper Plugins" (<https://store.kde.org/browse?cat=715>). Local
  `/usr/share/knsrcfiles/wallpaperplugin.knsrc` (Fedora 43): `Categories=Plasma Wallpaper Plugin6`,
  `ContentWarning=Executables`, `Uncompress=kpackage`, `KPackageStructure=Plasma/Wallpaper`.
- `Uncompress=kpackage` accepts zip or tar → the current `.tar.gz` fits; `metadata.json` at the root.
- **Updates**: KNewStuff marks an entry updateable when the store product's version or updated date
  differs from the one recorded at install (`src/attica/atticarequester.cpp` in KDE/knewstuff); it does
  not read the local `metadata.json`. So each release: replace the file, set the product version,
  add a changelog entry.
- No upload API (OCS API is read/install). Community script
  `ruinivist/kde-6-widget-starter/scripts/pling_upload.py` logs in through the web form, scrapes the
  edit page, deletes old files and uploads — fragile, no 2FA, may be blocked by the anti-bot wall.
  opendesktop once announced linking files on github.com (2017); unverified today.
- Description: BBCode (`[b] [i] [code] [url=] [img] [list][*] [quote] [h1]`), no tables. Fill the
  license and source-repository fields (MIT, GitHub URL). *Unverified*: screenshot gallery details.
- Product form as filled on 2026-09-26 (product 2374098), for the release checklist:
  - Description: none was ready for the first publish (the owner copied the Workshop one); FR-011
    generates it from now on.
  - Tags: free-form; use `heroes3`, `homm3`, `heroes-of-might-and-magic`, `hota`, `live-wallpaper`,
    `animated`, `map`, `game`.
  - Product homepage: the browser version on GitHub Pages; the source-repository field holds the
    GitHub repository.
  - "Credit for CC-BY licenses": empty. The product is MIT; the only CC BY-SA material the project
    uses (`vcmi-hota-mod/` data) is kept out of shipped builds.
  - "Original or Modification": **Original**. The field is about the uploaded file being a changed
    copy of someone else's work (a theme, a picture). The package holds only this project's own code
    and procedural preview art and no game content; the game is what it reads, like any fan engine.
    Ported MIT code (H3M layouts, the HotA LOD scheme) is credited in `THIRD_PARTY_NOTICES.md` and does
    not make the product a modification.
- No dependency field; common practice is a "Requirements" section naming Qt WebEngine per
  distribution — Fedora `qt6-qtwebengine`, Debian/Ubuntu `qml6-module-qtwebengine`, Arch
  `qt6-webengine` — plus an in-wallpaper message when the QML import fails (as the Wallpaper Engine KDE
  plugin does, <https://github.com/catsout/wallpaper-engine-kde-plugin>).

### Lively

- The online gallery never shipped: `rocksdanister/lively-gallery` archived 2022-08-12; maintainer
  2023-03-29: "Gallery is not released". Lively itself is maintained (v2.2.1.0, 2025-09-18).
  <https://github.com/rocksdanister/lively/discussions/1651>
- Distribution practice: a `.zip` with `LivelyInfo.json` at its root, dragged into the Lively window;
  GitHub Releases (as the maintainer's own wallpapers) or the LivelyWallpaper DeviantArt group.
- No install-from-URL or `lively://` handler (search of the default branch). The CLI works with local
  paths only.
- `LivelyInfo.json` has an integer `Version` ("wallpaper version", default 0), unused without the
  gallery; derive it from SemVer (e.g. `major*10000 + minor*100 + patch`) so it only grows. `Contact`
  is empty today and `Author` is a placeholder.

## Release automation options

| Option | Verdict |
| --- | --- |
| Tag-triggered workflow (`push: tags: ['v*']`) + `gh release create/upload` | **chosen**: simplest, full control |
| release-please | rejected: prints spec-number scopes as `**005:**` in notes; release created with `GITHUB_TOKEN` does not trigger other workflows |
| changesets | rejected: a hand-written file per change duplicates commit messages |
| "version changed in package.json" trigger | rejected: fragile diff check, becomes the tag trigger with extra steps |
| post-commit hook that tags version bumps | rejected (owner, 2026-09-24): not run on merge/rebase, `--amend` leaves the tag behind, tags are not pushed by default, hooks need `core.hooksPath` per clone |
| GitHub generated notes (`.github/release.yml`) | rejected: lists merged PRs only; this repo commits directly |

Notes for the plan:

- A release created by the GitHub CLI before the tag run exists already → the workflow must upload
  to it (`gh release upload --clobber`) rather than create it, and keep its notes.
- Pages today (`.github/workflows/pages.yml`) deploys on every push to `testing`; spec 004 FR-013a is
  superseded (FR-007).
- The package build already reads the version from `package.json` (`tools/package/cli.ts`) and has a
  reproducibility check (`yarn verify packages --reproducible`) → SHA256SUMS and safe re-runs.

## One source for the texts

- `src/adapters/shared/strings.ts` already holds, in English and Russian, `package_description`,
  `help_files`, `help_privacy` and per-host help (`help_wallpaper_engine`, `help_lively`,
  `help_kde`); `tools/package/manifests/common.ts` assembles the package readme from them. Store
  texts extend the same source with a few keys (repository, feedback-to-issues, KDE requirements).
- Markdown → Steam BBCode converters exist as dev dependencies (`@gmod-workshop/steamdown`,
  `@bscotch/steam-bbcode`, `markdown-to-bbcode`), needed only for the changelog section → change note;
  the Bannerlord/BUTR mod ecosystem syncs README → Workshop the same way.
- Keep store pages short: what it is, which files, host quirks, links to README / Releases / Issues.
  The long material lives only in the README.

## Legal and content

- Package previews are already procedural art with no game imagery (`tools/package/previews.ts`).
- Store-page screenshots of the map are renders of game files uploaded to a third-party service;
  constitution I allows them only in `docs/img/` → amendment (FR-019), owner agreed 2026-09-24.

## Plan decisions (`/speckit-plan`, 2026-09-26)

Measured in the code before deciding: `yarn package` writes archives only for Lively (`.zip`) and KDE
(`.tar.gz`) and folders for web and Wallpaper Engine (`tools/package/cli.ts` `artifactName`); the zip
and tar writers are already deterministic (`tools/shared/archive.ts`); `yarn verify packages` fails on
any absolute URL except two XML namespaces (`checkNoExternalUrls`) and on the word "official"
(`checkNoAffiliation`); the KDE shell imports `QtWebEngine` in `main.qml` itself, so a missing module
fails the whole wallpaper before any QML runs; the Pages workflow deploys on every push to `testing`;
tools may import only `settings.ts` and `strings.ts` from adapters (`TOOL_IMPORTABLE_ADAPTER_FILES`).

### R1. One release workflow, checks as code

- **Decision**: `.github/workflows/release.yml`, triggered by `push: tags: ['v*']` and by
  `workflow_dispatch` with a `tag` input (re-runs, a missed Pages deploy). Three jobs: `release`
  (verify → build → check → assets → publish), `pages` (needs `release`, skipped for pre-releases).
  Every rule of FR-003 lives in `tools/release/` as TypeScript (`yarn release check --tag vX.Y.Z`),
  so it runs the same locally and in CI and is unit-tested; the workflow only calls commands.
  `.github/workflows/pages.yml` becomes `ci.yml`: the same checks on pushes to `testing` and on pull
  requests, no deploy (FR-007).
- **Rationale**: YAML logic cannot be tested locally; the repository already has a CLI runner with
  exit codes and JSON output. A tag push by a person (not by `GITHUB_TOKEN`) triggers workflows, and
  `gh release create` from the CLI creates the tag through the API as the user, which triggers too.
- **Alternatives**: one workflow for CI and release with `if:` branches (harder to read, easy to
  deploy by mistake); a reusable action from the marketplace for releases (`softprops/action-gh-release`)
  — `gh` is preinstalled on runners and does create/upload/`--clobber` directly.

### R2. Version rules

- **Decision**: a ~60-line SemVer parser/comparator in `tools/release/semver.ts` (no dependency).
  Checks: tag = `v` + `package.json` version; `git merge-base --is-ancestor <commit> origin/testing`
  (checkout with `fetch-depth: 0`); a **final** version must be greater than every existing final
  `v*` tag other than itself; a pre-release skips that comparison (spec edge case: allowed next to a
  newer final) but must not equal an existing tag of another commit; `CHANGELOG.md` has a non-empty
  section for the version. Existing tags are read from git, not from the Releases API, so a check
  needs no token and a deleted release cannot unlock an old version.
- Lively's integer `Version` = `major × 10000 + minor × 100 + patch`; minor and patch ≥ 100 fail the
  check (they would break monotonicity).
- **Alternatives**: the `semver` npm package (a dev dependency for 60 lines); the Releases API for
  "latest release" (needs a token, ignores tags without releases).

### R3. Changelog format and conversion

- **Decision**: `CHANGELOG.md` with `## [X.Y.Z] - YYYY-MM-DD` sections (an optional
  `## [Unreleased]` on top is ignored). Section bodies use a small Markdown subset: `###` headings,
  `-` bullets (one nesting level), paragraphs, `**bold**`, `*italic*`, `` `code` ``, `[text](url)`.
  Own converter `tools/release/markup.ts` renders that subset to Markdown (GitHub, unchanged), Steam
  BBCode and KDE Store BBCode; anything outside the subset is an error naming the line, which is
  what makes FR-013's markup check possible.
- Steam profile: `[h2]` for headings, `[list][*]…[/list]`, `[b] [i] [code] [url=…]…[/url]`. KDE
  profile: headings as `[b]…[/b]` on their own line (the `[h1]` support noted above is unverified),
  otherwise the same tags; never `[table]` (FR-012).
- Draft helper `yarn release notes-draft`: `git log <last final tag>..HEAD`, keeps `feat`/`fix`
  subjects, strips the spec scope (`feat(005): x` → `x`), groups into "Added"/"Fixed", prints Markdown
  to stdout; never writes or publishes (FR-010).
- **Alternatives**: `@bscotch/steam-bbcode` / `markdown-to-bbcode` — general converters that accept
  any Markdown and silently degrade tables and images; the store check needs the opposite.

### R4. Project links in one module

- **Decision**: `src/adapters/shared/project.ts` (DOM-free constants): repository, issues, new-issue
  chooser, releases, latest release, Pages URLs, `WORKSHOP_ID = '3808342201'`,
  `KDE_STORE_URL = 'https://store.kde.org/p/2374098/'`, `workshopUrl()`. It joins
  `TOOL_IMPORTABLE_ADAPTER_FILES` (the packager, the store texts and the checks read it; the browser
  panel links to issues). `checkNoExternalUrls` allows exactly these URLs; every other URL still
  fails. An unset store value is `null`; texts leave the line out (FR-014b); the check rejects empty
  strings and `example`/`TODO` placeholders.
- **Rationale**: FR-014a/b ask for these values "next to the settings"; `settings.ts` is about user
  settings, `strings.ts` about language — a third small file keeps both clean.

### R5. Store texts from the string table

- **Decision**: new keys in `strings.ts` (en and ru): `store_links` (repository, README, releases),
  `store_feedback` (issues only), `store_kde_requirements` (Qt WebEngine: Fedora `qt6-qtwebengine`,
  Debian/Ubuntu `qml6-module-qtwebengine`, Arch `qt6-webengine`), `kde_webengine_missing`. Store
  texts reuse `package_description`, `help_files`, `help_privacy`, `help_wallpaper_engine`,
  `help_kde`, joined English then Russian (FR-012). Strings stay plain text with `{url}`
  placeholders; the markup profile wraps links. `tools/release/store-texts.ts` builds
  `workshop-title.txt`, `workshop-description.bbcode`, `kde-store-description.bbcode`,
  `changenote-<version>.bbcode` (Steam; the KDE changelog takes the same text through the KDE
  profile, `kde-changelog-<version>.bbcode`).
- Limits (FR-013): title ≤ 128, descriptions and change notes ≤ 8000. Steamworks names them
  `cch…Max` over UTF-8 buffers, so whether Steam counts characters or bytes is unverified; the check
  counts **UTF-8 bytes** of the BBCode source, the stricter reading (Cyrillic takes two bytes, and
  the Russian half is about half of every text). `yarn verify store-texts` fails naming the text,
  the limit and the excess, and reports the headroom of each text when it passes.
- Store pages with pictures (FR-012a, 2026-09-26): templates in `docs/store/` (layout + one text per
  language, placeholders filled from `strings.ts`), four inline pictures from `docs/img/` linked at the
  release tag. The first build was 28 bytes over the Workshop limit; shortening `help_wallpaper_engine`
  (it repeated the file list of `help_files`) left 976 bytes of headroom for the Workshop text and
  1423 for the KDE text.

### R6. Every shipped archive is named and zipped

- **Decision**: `artifactName` gives every host an archive:
  `heroes3-living-map-web-<v>.zip`, `…-wallpaper-engine-<v>.zip`, `…-lively-<v>.zip`,
  `…-kde-<v>.tar.gz`, all through the deterministic writers. The folders stay for local use.
  `SHA256SUMS` (the `sha256sum -c` format) covers the four archives and the store texts.
- `project.json` gets `workshopid` when `WORKSHOP_ID` is set (FR-014a); the packages check compares
  it with the constant.

### R7. KDE without Qt WebEngine

- **Decision**: `main.qml` imports only `QtQuick`, `org.kde.plasma.plasmoid` and `strings.js`; the
  web view moves to `WebView.qml` (imports `QtWebEngine` and `"."` for `SharedProfile`) and is loaded
  through `Loader { source: "WebView.qml" }`. On `Loader.Error` the shell shows a centred message
  from `kde_webengine_missing` in the desktop language and logs `[h3dynam] webengine-missing`. The
  pause and settings calls go through functions of the loaded item.
- Verification: no Qt runtime exists in CI (and locally only `qt6-qtdeclarative` without the `qml`
  tool), so the case is covered by (a) a structural check in `yarn verify packages` — `main.qml`
  has no `QtWebEngine` import, loads `WebView.qml` by `source`, has an error branch, and the message
  names all three packages in both languages — and (b) `yarn accept kde --simulate-missing-webengine`
  on a real Plasma session: installs a variant whose `WebView.qml` imports a module that does not
  exist, applies it and waits for the log line in the journal, then restores. FR-018's "host
  simulation" is read as these two checks (the host simulations drive the page in Chromium, not QML).
- Implementation note: `main.qml` also stops importing `"."`, because the `SharedProfile` singleton in
  that folder imports `QtWebEngine`; it is imported by `WebView.qml` only. The message uses the
  generated `strings.js` (desktop language), and the check `kde-webengine-fallback` in `yarn verify
  packages` guards the structure.
- **Alternatives**: `Qt.createQmlObject` with an inline import (same effect, harder to read);
  shipping a `qmltestrunner` test (needs `qt6-qtdeclarative-devel` and Plasma's QML modules in CI).

### R8. Feedback surfaces

- Package readmes gain a header line with the version and a footer with `store_links` and
  `store_feedback` (FR-004, FR-015). Lively: `Author: 'Alamion'`, `Contact:` the issues URL,
  `Version:` the integer of R2. KDE `metadata.json`: `Authors: [{ Name: 'Alamion' }]`, `Website`: the
  repository, `BugReportUrl`: the new-issue chooser (both are standard `KPluginMetaData` keys). The
  Wallpaper Engine surface is the Workshop description (store text) and the readme; `project.json`'s
  `description` stays the short package description the editor pre-fills.
- Browser panel: a footer line `v<version> · Report a problem` linking the new-issue chooser in a
  new tab (`rel="noopener"`). The version reaches the web build through a Vite `define`
  (`__H3_VERSION__`, also defined by the dev harness config).
- Issue forms: `.github/ISSUE_TEMPLATE/bug.yml` (host dropdown, version, map, what happened, expected,
  screenshot), `suggestion.yml`, `config.yml` with `blank_issues_enabled: false`.

### R9. Pages from releases only

- `release.yml`'s `pages` job uploads `dist/packages/web` of the same run (the tree the web archive
  was made from) with `actions/upload-pages-artifact` and deploys with `actions/deploy-pages`.
- One-time repository setting: the `github-pages` environment's deployment branch rule must allow
  tags `v*` (it allowed `testing` only); the checklist names this step, and the first run fails with
  a clear "not allowed to deploy" otherwise. **Done by the owner on 2026-09-26.**
- Actions are pinned by major tag as today (`checkout@v4`, `setup-node@v4`, Pages actions); no
  third-party action receives a secret — `GITHUB_TOKEN` with `contents: write` is used by `gh` only.

### R10. Release checklist and README

- `docs/releasing.md`: prepare (`yarn release notes-draft`, edit `CHANGELOG.md`, bump `package.json`,
  `yarn release check --tag vX --local`), tag (`git tag vX && git push origin vX`, or
  `gh release create vX --target testing --notes-file …`), watch the run, Workshop update (unpack
  over the editor's project folder, "Publish update", paste `changenote-*.bbcode`), KDE Store update
  (replace the file, set Version, add the changelog, how each form field is filled — the list
  above), screenshots (constitution I as amended), one-time settings (Pages environment rule).
- README: status table shows all four hosts working; "Getting started" links the latest release,
  the Workshop and KDE Store pages; the "Prebuilt packages are not published yet" paragraph goes.

### R11. Constitution amendment

- 1.3.1 → **1.4.0** (MINOR: the documentation-screenshot exception is extended): screenshots of the
  project's own output, the `docs/img/` kind and size limits, MAY be uploaded by the maintainer to
  store pages; they MUST NOT enter packages, release assets or build output. The packages check
  already rejects images other than the generated previews; the release asset list is fixed by R6.

## Check speed (T066–T070, 2026-09-26)

`yarn verify hosts` for all four hosts took **42 min** locally (91 invariants, one after another) with
only ~3.5 min of CPU in the node process: the time went into waiting. A release run with it could not
meet SC-001 (< 20 min).

Measured with per-invariant timing and a profile of every wait by call site (T066; `timing` in the
report, a `warn` line for each wait that ends by its timeout):

- **The cause**: `loaded()` in `tools/checks/hosts/invariants.ts` waited until *every* file slot was
  `loaded`, including the HotA slot, which these invariants never supply. The condition could not
  become true, so each call ran into its 60 s timeout and the invariant then passed on its later
  checks. 10 of 24 web invariants lost 60 s each (11 min 43 s → **1 min 54 s** for the web host after
  waiting only for the three supplied slots). No invariant was weakened: the same state is checked
  right after the wait, as before.
- Invariant 19 (map interval counts visible time only) failed once under the profiler: a map switch
  that had started while visible could finish within the fixed 150 ms after the pause. It now waits
  until the running switch has finished before it starts counting; the rule it checks — no *new*
  switch while hidden — is unchanged.
- Invariant 16 (100 map switches with frame sampling and memory) takes ~29 s of real work and stays.
- `--jobs N` (T068, default half the cores): invariants of a host run in a pool of browser contexts;
  the ones that measure time, frames or races run alone afterwards (`serial: true`: 1, 3, 4, 6, 8, 13,
  16, 19 — 4 and 6 have millisecond thresholds that a loaded CPU exceeds). Lively's driver copies
  files into its shared `userfiles/` folder atomically (temp file + rename), since parallel invariants
  copy the same names.
- Result, all hosts locally (20 cores, `--jobs 10`): **42 min → 5 min**, 91 of 91 pass, no wait ends
  by timeout (two consecutive runs).
- CI (T069): `release.yml` runs the rules first (`check`), then the host simulations as a matrix of
  four runners (`hosts`, ~2 min each on 4-core runners with `--jobs 2`) in parallel with `build`
  (type-check, tests, packages with `--reproducible`, store texts, assets); `release` publishes only
  after both, and `pages` follows. Expected tag-to-release time: ~10 min, within SC-001; to be
  confirmed on the first pre-release run (T064).

## First releases (T064, T065, 2026-09-26)

- `v0.1.0-rc.1`: release run 1 min 51 s (check 13 s; four host runners ~60 s each in parallel with
  build ~70 s; publish 18 s); 91 of 91 host invariants and 470 tests passed on the runners; a
  pre-release with 4 archives, 5 texts and `SHA256SUMS`, all checksums valid; Pages skipped.
- Re-run by `workflow_dispatch` for the same tag: a line added to the notes by hand survived, and
  `SHA256SUMS` was identical — the packages are byte-identical across runners (FR-008, SC-007).
- `v0.1.1-rc.1` with `package.json` at `0.1.0-rc.1`: stopped at `check` with `VERSION_MISMATCH`
  ("tag v0.1.1-rc.1 but package.json says 0.1.0-rc.1"); every other job skipped, no release (SC-002).
  The test tags and the pre-release were deleted afterwards.
- `v0.1.0`: release run 1 min 52 s including the Pages deploy (SC-001: < 20 min); `/releases/latest`
  points to it; the Pages bundle carries `0.1.0`; the four store pictures resolve at the tag
  (`raw.githubusercontent.com/.../v0.1.0/docs/img/...`, HTTP 200).
- KDE without Qt WebEngine on the owner's session: the message shows (owner, 2026-09-26). The first
  `accept --simulate-missing-webengine` run missed the journal line because the Loader fails during
  creation; fixed in `main.qml` (the message reports itself) and in the journal window.

