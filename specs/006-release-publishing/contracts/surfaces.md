# Contract: User-facing surfaces (FR-004, FR-015, FR-017, FR-018)

| Surface | Version | Repository | Issues note | Store links |
| --- | --- | --- | --- | --- |
| Workshop description (`workshop-description.bbcode`) | — | yes | yes | KDE Store, releases |
| KDE Store description | — | yes | yes | Workshop, releases |
| Release notes (block after the changelog) | title | yes | yes | Workshop, KDE Store, Pages |
| Package readme (every host) | header line | yes | yes | releases |
| Lively `LivelyInfo.json` | `Version` (integer) | — | `Contact` = issues | — |
| KDE `metadata.json` | `Version` | `Website` | `BugReportUrl` = new-issue chooser | — |
| WE `project.json` | — | — | — | `workshopid` |
| Browser panel footer | `v<version>` | — | "Report a problem" → new-issue chooser | — |
| README | badge-free text link to latest release | yes | yes | Workshop, KDE Store, Pages |

Author everywhere: `Alamion`; no e-mail anywhere (a packages check greps for `@` in
manifests and readmes outside URLs).

## New strings (en and ru, `src/adapters/shared/strings.ts`)

| Key | Content (en) |
| --- | --- |
| `store_links` | `Source code, README and downloads: {repository} · releases: {releases}` |
| `store_feedback` | `Suggestions and bug reports go to GitHub Issues only: {issues}. Comments and reviews on store pages are not tracked.` |
| `store_kde_requirements` | `Requires Qt WebEngine for QML: Fedora qt6-qtwebengine, Debian/Ubuntu qml6-module-qtwebengine, Arch qt6-webengine.` |
| `kde_webengine_missing` | `Heroes 3 Living Map needs Qt WebEngine. Install it and restart Plasma: Fedora — qt6-qtwebengine; Debian/Ubuntu — qml6-module-qtwebengine; Arch — qt6-webengine.` |
| `panel_version` | `Version {version}` |
| `panel_report` | `Report a problem` |
| `release_which_file` | the "which file do I need" block (Markdown source, links as placeholders) |

The texts avoid the word "official" (`checkNoAffiliation`).

## KDE shell (`packaging/kde/contents/ui/`)

- `main.qml`: imports `QtQuick`, `org.kde.plasma.plasmoid`, `"strings.js" as Strings`; no
  `QtWebEngine`, no `"."`. `Loader { id: view; source: "WebView.qml"; active: !onLockScreen }`.
  On `view.status === Loader.Error`: a centred `Text` with `Strings.table(lang).kde_webengine_missing`
  on the black background, and `console.log("[h3dynam] webengine-missing")` once.
- `WebView.qml`: the current `WebEngineView` with `SharedProfile`; exposes `pushConfig(json)` and
  `pushPaused(bool)`; reports readiness through a signal.
- `strings.js` (generated into `contents/ui/`, today read only by `config.qml`) is now also read by
  `main.qml`, so the message follows the desktop language.
