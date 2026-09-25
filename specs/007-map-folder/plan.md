# Implementation Plan: Map Folder and Map Rotation

**Branch**: `007-map-folder` | **Date**: 2026-09-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-map-folder/spec.md`

## Summary

A second map source: a folder of maps (or a `.zip` of them) instead of one map. The wallpaper picks a random
usable map at start, optionally moves on every N minutes of visible time or on "Next map now", never repeats a
map before the cycle ends, filters by map size class and level count, and swaps maps without an empty frame.

- **Hosts** — each bridge turns its `mapfolder` value into a *catalogue*: Wallpaper Engine and KDE list a
  `file://` folder through Chromium's own directory listing (measured, [research](research.md) R2), Lively reads a
  `.zip` chosen with its `folderDropdown` (it has no folder property and serves the page from a virtual host),
  the browser takes a picked or dropped folder and remembers it. A `.zip` works on every host.
- **Controller** — a DOM-free rotation (seeded shuffle, cycle without repeats, filter re-evaluation) and a
  lazy picker that reads one header at a time, so the first map costs one listing, one header and one load.
  An active-time map timer and a `nextMap()` action join the existing place timer and `newRandomPlace()`.
- **Engine** — `prepareMap` builds the next map's world and object layer off the renderer while the current map
  keeps animating; `showPreparedMap` swaps terrain, objects and camera in one step. Today's `loadMap` shows the
  new terrain without objects for the whole object build (research R6), which the spec forbids.
- **Core** — `readMapSummary` (size, levels, title, HotA) from a 64 KB inflated prefix, a typed size-class table,
  a bounds-checked ZIP reader (stored/deflate) without dependencies.
- **Cache** — the decode cache gets an 8-map LRU for worlds and object atlases (research R10); without it a
  rotation would store up to 128 MB per map in IndexedDB forever.
- **Settings** — the three keys reserved by spec 004 become real (`mapsource`, `mapfolder`, `maprotation`), plus
  `mapsizemin`, `mapsizemax`, `mapunderground` and the action `mapnext`; `viewinterval` goes to 1440 minutes.
  Existing installs validate to `mapsource = single` and behave exactly as before.

Out of scope: campaigns and saves, cross-fade transitions, sequential order, one map shared across screens
(spec Assumptions and Clarifications).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `erasableSyntaxOnly`), ES2022; Node 22 for tooling. Unchanged.

**Primary Dependencies**: none at runtime (constitution VIII). The ZIP reader is ~150 lines of own code on top of
the existing inflate helper (`DecompressionStream('deflate-raw')`). Dev: Vite, Vitest, `playwright-core` 1.63
(directory `setInputFiles` for the browser folder input).

**Storage**: IndexedDB — remembered folder in `h3dynam-files` (new keys, same store); decode cache `h3dynam`
gains the `recent` store (`CACHE_SCHEMA` 9). Host settings as today.

**Testing**: Vitest (Node) for core parsers, rotation and controller rules; `yarn verify hosts` (Playwright +
system Chromium, SwiftShader) for host drivers; `yarn verify budget` for start-up and memory; `test/real` suites
over the local map folders, skipping without them.

**Target Platform**: browser (GitHub Pages), Wallpaper Engine (CEF), Lively (WebView2), KDE Plasma 6
(QtWebEngine 6.10); developed and verified on Linux.

**Project Type**: live wallpaper (static web app + host packages).

**Performance Goals**: first map of a folder within the warm-start budget (≤ 2 s; HotA case ≤ 3 s); a switch
causes no empty frame and returns to the idle cadence after it; idle frame cost unchanged.

**Constraints**: total memory ≤ 300 MB including the peak of a switch (one GPU atlas + one prepared CPU atlas);
0 frames and no timers while hidden (the map timer included); Wallpaper Engine reads only inside the wallpaper
folder; hosts send settings in batches (coalesced as today).

**Scale/Scope**: folders up to 5 000 maps and 4 levels of sub-folders; the owner's folders: 225 maps / 8.6 MB
(Complete), 453 with HotA maps; map sizes 36–252.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

| Principle | Status | How |
| --- | --- | --- |
| I. User-supplied assets only | Pass | Maps come from the user's folder; the browser keeps copies only in its own IndexedDB on the user's machine (like the single map today). Tests use the synthetic H3M generator and `writeZip`; real-folder tests skip without files. |
| II. Fidelity | Pass | Rendering of a map is unchanged; the switch is an instant replacement (no effect added over the classic look). Rotation is an extra of the wallpaper, not a change of the game's look. |
| III. Script-verifiable | Pass | Rotation uses the seeded RNG and the injected clock; unit tests + host invariants 14–20 + budget folder case + real-folder suites; new inspection CLIs `yarn h3 map summary` and `yarn h3 map catalogue`. |
| IV. Screen-bound performance | Pass, with a watched risk | Nothing per map-size is added per frame. Preparation runs in the worker; the swap uploads once. The map timer stops while hidden. The decode cache stays keyed by identity and is now bounded. Risk: peak memory during a switch with two large HotA atlases — measured by the budget folder case; if it exceeds 300 MB, the prepared atlas is uploaded page by page after the old one is freed (still no empty frame: the old frame stays presented until the swap frame). |
| V. Platform-agnostic core | Pass | ZIP reader, map summary and size classes are DOM-free core code; listing parsing and rotation are DOM-free shared adapter code; host specifics stay in bridges and QML. All checks run on Linux; Windows questions WE-F1/F2, LV-F1 go to the Windows session, as in spec 004. |
| VI. Layers | Pass | `core/data` (sizes) → `core/formats` (zip, summary) → `runtime` (engine prepare/show, cache LRU, file-kind summary) → `adapters/shared` (catalogue, rotation, controller) → host bridges. `yarn verify layers` enforces it. |
| VII. Robust parsing | Pass | ZIP and summary readers are bounds-checked with typed errors; ZIP64/encryption/unknown methods are explicit `UNSUPPORTED` errors; a broken map is skipped and logged, never fatal; problem messages only when nothing can be shown. |
| VIII. Lean dependencies | Pass | No runtime dependency added; the runtime JS budget (≤ 100 KB gz) is checked by `yarn verify budget`. |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/007-map-folder/
├── plan.md              # This file
├── research.md          # R1–R13: host folder access, listing format (measured), ZIP, summary, switch, cache
├── data-model.md        # MapSource, CatalogueSource/Entry, MapSummary, MapFilter, Rotation, PreparedMap
├── quickstart.md        # Validation guide
├── contracts/
│   ├── settings.md      # New settings, action, manifests per host, strings
│   ├── engine-api.md    # prepareMap/showPreparedMap, worker, cache LRU, core readers, CLIs
│   └── host-bridge.md   # Controller additions, per-host catalogue, invariants 14–20
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/core/data/map-sizes.ts              # NEW size classes S..G, sizeClassOf
src/core/formats/zip/zip.ts             # NEW ZIP reader (stored, deflate-raw), typed errors
src/core/formats/h3m/summary.ts         # NEW readMapSummary from an inflated prefix
src/runtime/file-kind.ts                # + summarizeMapFile
src/runtime/engine.ts                   # + prepareMap, showPreparedMap, discardPreparedMap, stats.preparedMaps
src/runtime/protocol.ts, worker.ts      # openMap keep:'add', dropMap; worker keeps shown + prepared worlds
src/runtime/cache.ts, cache-key.ts      # CACHE_SCHEMA 9, 'recent' store, 8-map LRU
src/core/render/webgl-renderer.ts       # swap terrain + objects in one call, release old resources
src/adapters/shared/settings.ts         # new keys, 'folder' def type, mapnext action, viewinterval max 1440
src/adapters/shared/strings.ts          # en/ru strings (contracts/settings.md)
src/adapters/shared/messages.ts         # FOLDER_EMPTY, FOLDER_FILTERED, FOLDER_UNREADABLE
src/adapters/shared/catalogue.ts        # NEW listing parser, recursive file:// listing, ZIP catalogue, file-list catalogue
src/adapters/shared/rotation.ts         # NEW seeded cycle, filter evaluation (DOM-free)
src/adapters/shared/controller.ts       # folder source, picker, map timer (active time), nextMap, snapshot.folder
src/adapters/shared/remembered-files.ts # remembered folder (browser)
src/adapters/wallpaper-engine/main.ts   # mapfolder, mapnext
src/adapters/lively/main.ts             # mapfolder (.zip), mapnext
src/adapters/kde/main.ts                # mapfolder, mapnext counter
src/adapters/web/main.ts, panel.ts      # folder button, folder/zip drop, source control, current map, N key
packaging/kde/contents/ui/main.qml      # configJson lists new keys (FolderListModel fallback only if KDE-F1 fails)
tools/package/manifests/*.ts            # folder def per host, conditions, action
tools/inspect/                          # yarn h3 map summary | catalogue
tools/checks/hosts/                     # drivers: folders, zip, directory input; invariants 14–20
tools/checks/budget/                    # folder case (synthetic always, owner's Maps folder when present)
tools/checks/packages/                  # KDE configJson key coverage
test/core/formats/zip.test.ts, h3m-summary.test.ts, data/map-sizes.test.ts
test/adapters/catalogue.test.ts, rotation.test.ts, controller-folder.test.ts, settings.test.ts (updated)
test/browser/engine-prepare.test.ts     # prepare/show guarantees, no empty frame, gpuBytes stable
test/real/map-folder.test.ts            # full cycles over local folders with filters (skips without files)
test/fixtures/synthetic/                # map-folder generator (sizes/levels/broken files), zip via writeZip
README.md, AGENTS.md, docs/architecture.md  # folder source per host (WE: game/maps; Lively: .zip)
```

**Structure Decision**: the existing single-project layout; new code sits in the layer that owns it (see
Constitution Check VI). No new top-level folders.

## Implementation Order (for /speckit-tasks)

1. Core readers and data (sizes, summary, ZIP) + CLIs — independent, unit-tested.
2. Engine prepare/show + worker + renderer swap + cache LRU — browser tests for the no-empty-frame guarantee.
3. Settings, strings, messages, manifests (+ packages check) — upgrade path validated first (SC-006).
4. Catalogue + rotation + controller folder source (US1), then map timer and `nextMap` (US2), then filters (US3).
5. Host bridges and browser panel/remembered folder (US4); KDE on the real session (KDE-F1).
6. Host invariants 14–20, budget folder case, real-folder suites; README/AGENTS/architecture docs.

## Risks

- **Listing on the real hosts** (WE-F1, KDE-F1): measured only in desktop Chromium. Mitigation: `.zip` works
  everywhere; KDE has the QML `FolderListModel` fallback; WE is answered in the Windows session.
- **Peak memory on a switch** with large HotA object atlases (up to 128 MB each): measured by the budget folder
  case; fallback described in Constitution Check IV.
- **Cache LRU and several screens**: two instances on one origin share the cache; eviction by use time keeps the
  maps both screens show (8 slots ≫ number of screens).

## Post-Design Constitution Re-check

Re-checked against [data-model.md](data-model.md) and [contracts/](contracts/): no new runtime dependency, all new
parsers typed and bounded, the map timer obeys the hidden/paused rule, every visible behaviour has a headless
check (invariants 14–20, budget folder case, unit suites). Still **Pass**; no Complexity Tracking entries.

## Complexity Tracking

None.
