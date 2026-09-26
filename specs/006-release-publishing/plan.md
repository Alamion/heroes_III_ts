# Implementation Plan: Releases and Publishing

**Branch**: `006-release-publishing` | **Date**: 2026-09-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-release-publishing/spec.md`

## Summary

The project gets versioned releases started by a `v*` tag, a GitHub Release with all four host
packages, checksums and ready-to-paste store texts, GitHub Pages redeployed only on final releases,
and one feedback channel (GitHub Issues) named on every surface. Stores stay manual.

- **Release tooling** (`tools/release/`, `yarn release …`) — the FR-003 rules as tested TypeScript
  (`check`), the asset set (`assets`), a changelog draft from commits (`notes-draft`) and the upload
  through `gh` (`publish`). SemVer and the Markdown-subset converter are own code (research R2, R3).
- **Workflows** — `release.yml` on tags (check → build → all checks → assets → release → Pages for
  final versions); `pages.yml` becomes `ci.yml`, checks only (research R1, R9).
- **Packages** — every host ships an archive named `heroes3-living-map-<host>-<version>`; WE
  `project.json` carries `workshopid`; readmes and manifests carry the version, author `Alamion`,
  repository and issues links; the URL check allows exactly the project's links (R4, R6, R8).
- **Store texts** — generated from `strings.ts` + `project.ts` + `CHANGELOG.md` in Steam and KDE
  BBCode, English then Russian, checked against limits and markup by `yarn verify store-texts` (R5).
- **KDE** — the web view moves behind a `Loader`, so a missing Qt WebEngine shows a message with the
  packages to install instead of a black desktop (R7).
- **Docs and governance** — `CHANGELOG.md` (0.1.0), `docs/releasing.md`, README release links and host
  status, issue forms, constitution 1.4.0 (store screenshots, R11).

Out of scope: automatic Workshop/KDE Store uploads, a Lively gallery, new wallpaper features.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `erasableSyntaxOnly`), Node 22 for tools; QML (Qt 6 /
Plasma 6) for the KDE shell; GitHub Actions YAML. Unchanged stack.

**Primary Dependencies**: none added, runtime or dev. `gh` (preinstalled on GitHub runners) is used
only by `yarn release publish` in CI. Actions: `actions/checkout@v4`, `actions/setup-node@v4`,
`actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4` (already used).

**Storage**: files only — `CHANGELOG.md`, `src/adapters/shared/project.ts` (links, Workshop id, KDE
Store URL), `dist/release/<version>/` (git-ignored).

**Testing**: Vitest for semver, tag rules (against a temporary git repository), changelog parsing,
markup profiles, store texts, manifests and the KDE QML structure; `yarn verify packages
--reproducible`, `yarn verify store-texts`, `yarn verify hosts`; `yarn accept kde
--simulate-missing-webengine` on a real session; an end-to-end pre-release tag on GitHub
([quickstart.md](quickstart.md)).

**Target Platform**: GitHub Actions `ubuntu-latest` (release, Pages); packages for browser, Wallpaper
Engine, Lively, KDE Plasma 6; developed on Linux.

**Project Type**: live wallpaper (static web app + host packages) with release tooling.

**Performance Goals**: tag to finished release and Pages in < 20 min (SC-001); today's CI run is the
reference, the release run adds all-host simulations and the reproducibility build.

**Constraints**: nothing published before every check passes (SC-002); re-runs idempotent (FR-008);
no game content in any asset (FR-009); store texts within limits counted in UTF-8 bytes; runtime JS
budget unchanged (the panel footer adds a few hundred bytes).

**Scale/Scope**: one release per few weeks, 4 archives + 5 texts + checksums per release, ~0.5 MB.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

| Principle | Status | How |
| --- | --- | --- |
| I. User-supplied assets only | Pass, with an amendment | Packages and release assets are built only from repository sources; the packages check (game extensions, no external content) runs on the release build (FR-009). Store screenshots of the project's own renders need principle I extended — amendment 1.4.0 in this feature (FR-019, research R11), approved by the owner on 2026-09-24. No names or icons imply affiliation; texts avoid "official". |
| II. Fidelity | Pass | Rendering is untouched. |
| III. Script-verifiable | Pass | Every rule is a command with JSON output and unit tests; new checks `store-texts`, `workshop-id`, `feedback`, `kde-webengine-fallback`; the KDE fallback also has a real-session acceptance mode. The visible browser change (panel footer) is covered by the web host simulation. |
| IV. Screen-bound performance | Pass | No per-frame work added. The KDE `Loader` changes only how the view is created. |
| V. Platform-agnostic core, Linux-first | Pass | Core untouched; all tooling runs on Linux; GitHub runners are Linux; Windows stores are updated by hand from generated texts. |
| VI. Layers | Pass | `project.ts` is a DOM-free file in `adapters/shared`, added to the files tools may import (`TOOL_IMPORTABLE_ADAPTER_FILES`); release tooling lives in `tools/`; `yarn verify layers` enforces it. |
| VII. Honest failure | Pass | Each failed release rule has a code and a message (data-model); the KDE shell reports a missing module instead of a black screen. |
| VIII. Lean dependencies | Pass | No new dependency; SemVer and the BBCode converter are small own modules (research R2, R3). |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/006-release-publishing/
├── spec.md
├── plan.md              # This file
├── research.md          # store research + plan decisions R1–R11
├── data-model.md        # Version, ReleaseTag, ChangelogSection, ProjectLinks, ReleaseAssets, StoreText
├── quickstart.md        # Validation guide
├── contracts/
│   ├── cli.md               # yarn release check|assets|notes-draft|publish, yarn verify store-texts, changed commands
│   ├── release-workflow.md  # ci.yml, release.yml, issue forms
│   └── surfaces.md          # every user-facing surface, new strings, KDE shell structure
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/adapters/shared/project.ts          # NEW links, WORKSHOP_ID, KDE_STORE_URL, AUTHOR
src/adapters/shared/strings.ts          # store_*, kde_webengine_missing, panel_version, panel_report, release_which_file
src/adapters/web/panel.ts, panel.css    # footer: version + "Report a problem"
src/adapters/web/main.ts, vite.config.ts  # __H3_VERSION__ define (web build and dev harness)
packaging/kde/contents/ui/main.qml      # Loader + missing-module message
packaging/kde/contents/ui/WebView.qml   # NEW the WebEngineView moved out of main.qml
tools/release/cli.ts                    # NEW yarn release check|assets|notes-draft|publish
tools/release/semver.ts                 # NEW parse/compare, livelyVersion
tools/release/tags.ts                   # NEW tag rules over git (ancestry, existing tags)
tools/release/changelog.ts              # NEW section parser, draft from commits
tools/release/markup.ts                 # NEW Markdown subset → Markdown / Steam BBCode / KDE BBCode
tools/release/store-texts.ts            # NEW Workshop/KDE texts, change notes, limits
tools/release/assets.ts                 # NEW dist/release/<v>/, SHA256SUMS, release-notes.md
tools/package/cli.ts                    # artifactName for every host, archives for web and WE
tools/package/manifests/*.ts            # workshopid, author, contact, website, bug URL, Lively Version, readme header/footer, WebView.qml
tools/checks/packages/index.ts          # URL allowlist from project.ts, workshop-id, feedback, kde-webengine-fallback
tools/checks/store-texts.ts             # NEW yarn verify store-texts (+ cli.ts, all.ts)
tools/checks/layers.ts                  # project.ts importable by tools
tools/accept/kde.ts                     # --simulate-missing-webengine
.github/workflows/ci.yml                # renamed from pages.yml, checks only
.github/workflows/release.yml           # NEW
.github/ISSUE_TEMPLATE/bug.yml, suggestion.yml, config.yml   # NEW
CHANGELOG.md                            # NEW, 0.1.0 section
docs/releasing.md                       # NEW release checklist (FR-014)
README.md, AGENTS.md, docs/architecture.md   # release links, host status, commands
.specify/memory/constitution.md         # 1.4.0
package.json                            # version 0.1.0, "release" script
test/tools/release-*.test.ts            # semver, tags (temp git repo), changelog, markup, store texts, assets
test/tools/manifests-*.test.ts, packages-check.test.ts   # updated
```

**Structure Decision**: the existing single-project layout; release tooling gets its own
`tools/release/` next to `tools/package/`. No new top-level source folder.

## Implementation Order (for /speckit-tasks)

1. Foundations: `project.ts`, layers rule, SemVer, archives for every host, URL allowlist.
2. US1: tag rules, changelog parser, assets, publish, `release.yml`, `ci.yml`, Pages from releases.
3. US2: artifact names, "which file do I need" block, README links and status, checksums.
4. US3: markup profiles, store texts, `yarn verify store-texts`, `docs/releasing.md`.
5. US4: readme/manifest feedback fields, panel footer, issue forms, packages `feedback` check.
6. US5: KDE `Loader` + message, structural check, `accept --simulate-missing-webengine`.
7. Polish: constitution 1.4.0, CHANGELOG 0.1.0, version bump, AGENTS/architecture, the pre-release
   dry run on GitHub, then `v0.1.0`.

## Risks

- **Run time** (SC-001): all-host simulations plus the reproducibility build may approach 20 min on a
  shared runner. Mitigation: measure on the pre-release run; host simulations can move to a parallel
  job that `publish` needs.
- **Pages environment rule**: tags are not allowed to deploy by default — a one-time setting in the
  checklist; the first run fails loudly otherwise.
- **Store markup and limits unverified** (KDE `[h1]`, Steam counting bytes or characters): the stricter
  reading is enforced (research R3, R5); the owner previews the first paste of each text.
- **Workshop item and editor**: the editor may rewrite `project.json` fields on "Publish update";
  the checklist tells the maintainer to keep `workshopid`, and the package already carries it.
- **Reproducibility across runners**: a re-run on a newer runner image could change Vite output;
  `--clobber` still replaces assets consistently, and the lockfile pins the build tools.

## Post-Design Constitution Re-check

Re-checked against [data-model.md](data-model.md) and [contracts/](contracts/): no dependency added,
no runtime cost beyond the panel footer, no game content in any asset, every rule has a headless
check. Principle I needs the 1.4.0 amendment, which is part of this feature and owner-approved.
Still **Pass**; no Complexity Tracking entries.

## Complexity Tracking

None.
