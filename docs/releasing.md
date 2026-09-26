# Releasing

How a version of Heroes 3 Living Map is released, and how the two stores that cannot be updated
automatically are kept in step. The design is in [spec 006](../specs/006-release-publishing/).

What happens by itself: a tag `vX.Y.Z` on `testing` starts `.github/workflows/release.yml`. It checks
the rules below, builds and verifies everything, creates (or fills) the GitHub Release with the four
host archives, the store texts and `SHA256SUMS`, and — for a final version — redeploys GitHub Pages.
Nothing is published if any check fails.

What is done by hand: the Steam Workshop item and the KDE Store product. Lively has no store; its
archive on the release is the download.

## 1. Prepare the version

1. Draft the notes from the commits since the last release:
   ```bash
   yarn release notes-draft          # prints a Markdown draft; writes nothing
   ```
2. Rewrite it for users into a new section at the top of `CHANGELOG.md` (below `## [Unreleased]`):
   ```markdown
   ## [0.2.0] - 2026-10-15

   ### Added

   - Something people will notice, in their words
   ```
   Only this Markdown subset is allowed, because the same text becomes the store change notes:
   `###` headings, `-` bullets (one nested level, two or four spaces), paragraphs, `**bold**`,
   `*italic*`, `` `code` ``, `[text](url)`. Tables, images, HTML, numbered lists and code blocks fail
   the check.
3. Raise `version` in `package.json` (SemVer: fixes → patch, new features → minor). Minor and patch
   must stay below 100 (Lively's integer version is `major·10000 + minor·100 + patch`).
4. Check before tagging, on `testing` with the changes committed:
   ```bash
   yarn release check --tag v0.2.0 --local
   yarn release assets --build       # optional: look at dist/release/0.2.0/ (notes, store texts)
   ```

## 2. Tag

Either from a clone:

```bash
git checkout testing && git pull
git tag v0.2.0
git push origin v0.2.0
```

or with the GitHub CLI (the release is created first; the workflow fills it and keeps its notes):

```bash
gh release create v0.2.0 --target testing --title "Heroes 3 Living Map 0.2.0" --notes-file notes.md
```

A pre-release tag (`v0.2.0-rc.1`, `-beta.1`) makes a GitHub pre-release and leaves GitHub Pages alone.
It may use the section of its final version (`## [0.2.0]`).

## 3. Watch the run

Actions → **release**. The first step prints the rule check; a failure names its reason:

| Code | Meaning | Fix |
| --- | --- | --- |
| `TAG_FORMAT` | the tag is not `v` + SemVer | delete the tag, push the right one |
| `VERSION_MISMATCH` | the tag and `package.json` differ | tag the commit that has the version |
| `NOT_ON_TESTING` | the commit is not on `testing` | merge first, then tag |
| `VERSION_NOT_HIGHER` | a final version not above the last final release | raise the version |
| `CHANGELOG_MISSING` / `CHANGELOG_EMPTY` / `CHANGELOG_FORMAT` | no usable section | write it, commit, move the tag |
| `MARKUP_UNSUPPORTED` | the section uses Markdown outside the subset | simplify it |
| `LIVELY_VERSION_RANGE` | minor or patch ≥ 100 | use a new major/minor |

To move a tag after a failed run: `git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0`, fix,
tag again. A run can also be repeated from Actions → release → **Run workflow** with the tag: assets
are replaced with identical files, notes that are already on the release stay, and a missed Pages
deploy is done.

When it is green: the release page lists `heroes3-living-map-{web,wallpaper-engine,lively}-X.Y.Z.zip`,
`heroes3-living-map-kde-X.Y.Z.tar.gz`, `SHA256SUMS` and five store texts; the browser version's panel
shows `Version X.Y.Z` (final versions only).

## 4. Update the Steam Workshop item

Needs Windows with Wallpaper Engine, signed in to the Steam account that owns the item
([3808342201](https://steamcommunity.com/sharedfiles/filedetails/?id=3808342201)).

1. Download `heroes3-living-map-wallpaper-engine-X.Y.Z.zip` and the `*.bbcode` files from the release.
2. Unpack the archive over the editor's project folder
   (`…\steamapps\common\wallpaper_engine\projects\myprojects\heroes3-living-map\`). The package's
   `project.json` already carries `"workshopid": "3808342201"`, so the editor updates the item.
3. **Never keep game files in that folder** — `.lod`, `.h3m`, `maps.zip`: the editor uploads the whole
   folder. Test with a separate copy.
4. Wallpaper Engine → **Open wallpaper** → the project → **Workshop → Share Wallpaper on Workshop**
   ("Publish update"). Paste `changenote-X.Y.Z.bbcode` as the change note. Keep the age rating
   (Everyone) and the visibility.
5. When the description changed (new strings, new links): on the item's Steam page → **Edit title &
   description**, paste `workshop-description.bbcode`; the title is `workshop-title.txt`.
6. First publish of a new item only: the editor writes the new `workshopid` into its `project.json`;
   put it into `WORKSHOP_ID` in `src/adapters/shared/project.ts` and commit, so the next packages
   carry it.

## 5. Update the KDE Store product

Signed in on <https://store.kde.org/p/2374098/> (the opendesktop/Pling account that owns it) →
**Edit product**.

1. **Files**: upload `heroes3-living-map-kde-X.Y.Z.tar.gz`; delete or archive the previous file.
2. **Version**: set it to `X.Y.Z`. Plasma's "Get New Plugins…" offers an update only when this field
   (or the update date) changes — it does not read the package's own `metadata.json`.
3. **Changelog**: add an entry with `kde-changelog-X.Y.Z.bbcode`.
4. **Description** (when it changed): paste `kde-store-description.bbcode`. It uses only tags the
   store supports (no tables, no heading tags).
5. Save.

How the product form is filled (set once when the product was created, 2026-09-26):

| Field | Value |
| --- | --- |
| Category | Plasma 6 Wallpaper Plugins |
| Title | Heroes 3 Living Map |
| Tags | `heroes3`, `homm3`, `heroes-of-might-and-magic`, `hota`, `live-wallpaper`, `animated`, `map`, `game` |
| License | MIT |
| Product homepage | <https://alamion.github.io/heroes_III_ts/> |
| Source repository | <https://github.com/Alamion/heroes_III_ts> |
| Credit for CC-BY licenses | empty — nothing CC-licensed is shipped |
| Original or Modification | **Original** — the package holds only this project's code and procedural art |
| Logo / pictures | `preview.png` from a package (procedural art), or screenshots (below) |

## 6. Store screenshots

Screenshots of this project's own output — renders of a map made from your files, the kind kept in
`docs/img/` (≤ 2 MB each) — may be uploaded to the store pages (constitution I, 1.4.0). They never go
into the repository outside `docs/img/`, into packages, release assets or build output. Never upload
screenshots of the original game, its logos or its box art.

## One-time repository settings

- **Settings → Environments → `github-pages` → Deployment branches and tags**: allow tags matching
  `v*` (done 2026-09-26). Without it the `pages` job fails with "not allowed to deploy".
- **Settings → Pages → Source**: GitHub Actions.
- The workflow uses only `GITHUB_TOKEN` (`contents: write` for the release, `pages: write` for Pages);
  no store credentials exist anywhere.
