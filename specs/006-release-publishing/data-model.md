# Data Model: Releases and Publishing

Build-time and repository data only; the wallpaper runtime gains two constants (links, version).

## Version

| Field | Type | Rule |
| --- | --- | --- |
| `major`, `minor`, `patch` | integer ≥ 0 | from `package.json` `version`, the only source (FR-001) |
| `prerelease` | string[] | dot-separated identifiers after `-`; empty for a final version |
| `livelyVersion` | integer | `major·10000 + minor·100 + patch`; `minor`, `patch` < 100 or the check fails |

Ordering: SemVer 2.0 precedence (a pre-release sorts before its final). Build metadata (`+…`) is
rejected: tags must be comparable.

## ReleaseTag

| Field | Rule |
| --- | --- |
| `name` | `v` + Version string; any other `v*` tag fails the check |
| `commit` | must be an ancestor of (or equal to) `origin/testing` |
| `kind` | `final` or `prerelease` (from Version) |

Validation (FR-003, in order; the first failure stops the run and is named):
`TAG_FORMAT` → `VERSION_MISMATCH` (tag ≠ `package.json`) → `NOT_ON_TESTING` →
`VERSION_NOT_HIGHER` (final only: ≤ an existing final tag) → `TAG_TAKEN` (same name on another commit)
→ `CHANGELOG_MISSING` / `CHANGELOG_EMPTY` → `MARKUP_UNSUPPORTED` (section outside the subset) →
`LIVELY_VERSION_RANGE`. The build and the existing checks follow; their failure also stops the run
before publishing.

## ChangelogSection

| Field | Rule |
| --- | --- |
| `version` | heading `## [X.Y.Z] - YYYY-MM-DD` (pre-releases: `## [X.Y.Z-beta.1] - …`) |
| `date` | ISO date |
| `body` | Markdown subset (research R3), non-empty after trimming |

A pre-release without its own section MAY use the section of its final version (same core), so a
beta can be tagged before the final notes are written; if neither exists the check fails.

## ProjectLinks (`src/adapters/shared/project.ts`)

| Constant | Value |
| --- | --- |
| `REPOSITORY_URL` | `https://github.com/Alamion/heroes_III_ts` |
| `ISSUES_URL` | `…/issues` |
| `NEW_ISSUE_URL` | `…/issues/new/choose` |
| `RELEASES_URL`, `LATEST_RELEASE_URL` | `…/releases`, `…/releases/latest` |
| `PAGES_URL` | `https://alamion.github.io/heroes_III_ts/` |
| `README_URL` | `…#readme` |
| `WORKSHOP_ID` | `'3808342201'` or `null` |
| `KDE_STORE_URL` | `'https://store.kde.org/p/2374098/'` or `null` |
| `AUTHOR` | `'Alamion'` |

`workshopUrl()` → `https://steamcommunity.com/sharedfiles/filedetails/?id=<id>` or `null`.
`allowedUrls()` → the exact set `checkNoExternalUrls` accepts besides the XML namespaces.

## ReleaseAssets (`dist/release/<version>/`)

| File | Source |
| --- | --- |
| `heroes3-living-map-web-<v>.zip` | web package tree |
| `heroes3-living-map-wallpaper-engine-<v>.zip` | WE package tree (with `workshopid`) |
| `heroes3-living-map-lively-<v>.zip` | Lively package tree |
| `heroes3-living-map-kde-<v>.tar.gz` | KDE package tree |
| `workshop-title.txt`, `workshop-description.bbcode`, `kde-store-description.bbcode` | StoreText |
| `changenote-<v>.bbcode`, `kde-changelog-<v>.bbcode` | ChangelogSection via markup profiles |
| `release-notes.md` | ChangelogSection + the standard "which file do I need" block |
| `SHA256SUMS` | SHA-256 of every file above except itself, sorted by name |

`release-notes.md` is used only when the GitHub Release has no notes yet (FR-005); it is not an
uploaded asset.

## StoreText

| Field | Rule |
| --- | --- |
| `store` | `steam` or `kde` |
| `kind` | `title`, `description`, `changenote` |
| `markup` | Steam BBCode / KDE BBCode profile (research R3) |
| `limit` | title 128, others 8000 — UTF-8 bytes |
| `content` | English block, separator, Russian block (descriptions); change notes as written in the changelog |

Every URL inside must be one of ProjectLinks; a store link whose constant is `null` is omitted.

## State: a release run

```text
tag pushed / dispatched
  → checked (FR-003 rules) ─fail→ stopped, nothing published
  → built + checked (tests, packages --reproducible, hosts, store-texts) ─fail→ stopped
  → assets written
  → release created (or found) → assets uploaded with --clobber → notes set only if empty
  → final? → Pages deployed : done (pre-release)
```

A re-run from any state repeats all steps; uploads replace assets with byte-identical files and an
existing release keeps its notes (FR-008).
