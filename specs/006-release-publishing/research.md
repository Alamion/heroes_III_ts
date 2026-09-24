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
