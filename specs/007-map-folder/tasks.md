---

description: "Task list for Map Folder and Map Rotation"
---

# Tasks: Map Folder and Map Rotation

**Input**: Design documents from `/specs/007-map-folder/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included. Constitution III and spec FR-024 require headless checks that run on Linux without a
human, so test and check tasks are part of the feature.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1–US4)

## Path Conventions

Single project at the repository root: `src/core`, `src/runtime`, `src/adapters`, `tools/`, `test/`,
`packaging/kde/`. Layers import only downwards (`yarn verify layers`).

---

## Phase 1: Setup

**Purpose**: synthetic fixtures every later test uses (no game content, constitution I).

- [X] T001 [P] Add a map-folder fixture generator in test/fixtures/synthetic/map-folder.ts: `writeMapFolder(dir, spec)` writes gzip maps via `buildMap`/`writeH3mGz` from test/fixtures/synthetic/h3m.ts for chosen sizes (36…252), levels (1/2), versions (RoE/SoD/HotA via test/fixtures/synthetic/hota-map.ts), nested sub-folders, a Cyrillic file name, non-map files (`readme.txt`, `save.GM1`, `campaign.h3c`) and broken maps (truncated, wrong version via `mapWithVersion` from bad-files.ts); also `mapFolderZip(spec, { deflate })` returning a ZIP built with `writeZip` from tools/shared/archive.ts (stored) or node `zlib.deflateRawSync` members (deflate)
- [X] T002 [P] Check `writeZip` in tools/shared/archive.ts supports nested paths and UTF-8 names (set the UTF-8 flag, bit 11); extend it if not, with a unit test in test/tools/archive.test.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: core readers, engine prepare/show, cache bound, settings/messages — every story needs them.

**⚠️ CRITICAL**: no user-story work begins before this phase is complete.

### Core readers and data

- [X] T003 [P] Create src/core/data/map-sizes.ts: `MAP_SIZE_CLASSES` (`s` 36, `m` 72, `l` 108, `xl` 144, `h` 180, `xh` 216, `g` 252), `SizeClass` type, `sizeClassOf(size)` (smallest class ≥ size, above 252 → `g`), `compareSizeClass`; tests in test/core/data/map-sizes.test.ts
- [X] T004 [P] Create src/core/formats/zip/zip.ts: `ZipArchive.open(source: ByteSource, name)` reading EOCD (search the last 64 KB + 22 bytes), central directory, local headers; `entries()` and `read(entry)` for method 0 and 8 (deflate-raw through src/core/util/inflate.ts, add a `'deflate-raw'` mode there if missing); ZIP64, encryption (flag bit 0) and other methods → `FormatError` `UNSUPPORTED_VERSION` with file, offset, structure; UTF-8 names (flag bit 11) decoded as UTF-8, others as CP437→ UTF-8 best effort (logged)
- [X] T005 [P] Tests for the ZIP reader in test/core/formats/zip.test.ts: stored and deflated members, nested paths, Cyrillic names, empty archive, truncated central directory, ZIP64 marker, encrypted flag, unknown method (fixtures from T001/T002)
- [X] T006 [P] Create src/core/formats/h3m/summary.ts: `readMapSummary(prefix, fileName): MapSummary` reading the version (and HotA sub-version/header fields via `readHotaHeaderFields`) and `readInfo` from src/core/formats/h3m/header.ts with the same `makeContext` setup as `parseH3m` in h3m.ts; returns `{ version, size, sizeClass, levels, title, needsHota }`; a prefix ending early → `FormatError` `TRUNCATED`
- [X] T007 [P] Tests in test/core/formats/h3m-summary.test.ts: every size class and level count for RoE/AB/SoD/HotA synthetic maps; `title` with Cyrillic text; truncated prefix; unsupported version; the summary equals the corresponding fields of a full `parseH3m`
- [X] T008 Add `summarizeMapFile(blob, name)` to src/runtime/file-kind.ts (gzip → `inflatePrefix` bounded by `MAP_PROBE_BYTES`, raw → first 64 KB, then `readMapSummary`); tests in test/runtime/file-kind.test.ts

### Engine: prepare and show without an empty frame (research R6)

- [X] T009 Extend src/runtime/protocol.ts and src/runtime/worker.ts: `openMap.keep: 'replace' | 'add'` (worker keeps at most the shown and the prepared world by identity) and a `dropMap { identity }` request; the in-process path in `run()` of src/runtime/engine.ts behaves the same
- [X] T010 Add a one-call swap to src/core/render/webgl-renderer.ts: `replaceMap(terrain, objects | undefined)` sets terrain and object layer together, deletes the previous object pages/palette/vertex buffer and terrain textures, and does not present an intermediate frame
- [X] T011 Implement `prepareMap`, `showPreparedMap`, `discardPreparedMap` and `stats().preparedMaps` in src/runtime/engine.ts per contracts/engine-api.md: parse + build objects without touching the renderer or camera; generation counter superseded by a newer prepare or an archive change (sprite, data, HotA); `showPreparedMap` swaps world, renderer (`replaceMap`), camera via the same placement code as `placeView`, drops the old worker world (`dropMap`), invalidates once; keep `loadMap` unchanged
- [X] T012 Browser tests in test/browser/engine-prepare.test.ts: during a prepare `world()`, camera and `objectPages` stay the old map's and frames keep coming; the first frame after `showPreparedMap` has new terrain, objects and camera (compare with a fresh engine that `loadMap`s the same file and `placeView`s the same placement); `gpuBytes` within 1 % of the fresh engine; stale handle → `undefined`; archive change mid-prepare → `SUPERSEDED`; no data archive → prepared map without objects and `DATA_ARCHIVE_MISSING` as for `loadMap`; `preparedMaps` back to 0 after show/discard

### Decode cache bound (research R10)

- [X] T013 In src/runtime/cache-key.ts and src/runtime/cache.ts: `CACHE_SCHEMA = 9` (update the history comment), add store `recent`, `DecodedCache.touch(mapIdentity)` (no-op in `noCache`), and after `put` into `world`/`objects` delete entries of all but the 8 most recently used map identities (keys of those stores contain the map identity — derive it with a helper next to `cacheKey`); failures only warn; call `touch` from src/runtime/decode.ts on every world/objects get or put
- [X] T014 Browser test in test/browser/cache.test.ts: loading 10 synthetic maps leaves world/objects entries of exactly the 8 most recent; archives untouched; an older schema database is upgraded (cleared) without error

### Settings, messages, strings (contracts/settings.md)

- [X] T015 Extend src/adapters/shared/settings.ts: keys `mapsource`, `mapfolder`, `maprotation`, `mapsizemin`, `mapsizemax`, `mapunderground` with the definitions of contracts/settings.md; new `FolderSettingDef` (`type: 'folder'`); `mapfile` gets `visibleWhen: mapsource = single`; `viewinterval.max = 1440`; action `mapnext` (visible when `mapsource = folder`); remove `RESERVED_KEYS`; `defaultSettings()` and `validateSettings()` (folder values like file values; `maprotation` like `viewinterval`); keep existing orders of existing keys
- [X] T016 [P] Add en/ru strings to src/adapters/shared/strings.ts (full list in contracts/settings.md "Strings"; size labels with tile counts, e.g. "M (72×72)"; hints say the setting is used when the source is "Folder")
- [X] T017 [P] Add message codes `FOLDER_EMPTY`, `FOLDER_FILTERED`, `FOLDER_UNREADABLE` to src/adapters/shared/messages.ts with `detail` usage per research R12, and their `msg_*` strings (en/ru) in src/adapters/shared/strings.ts
- [X] T018 Update test/adapters/settings.test.ts and test/adapters/strings.test.ts: new keys validate (enums, folder text, `maprotation` 0–1440 with typed text rules, `viewinterval` up to 1440); a raw settings object of the previous version (no folder keys) validates to `mapsource = single` with every old value unchanged (SC-006); every new string key exists in both languages

**Checkpoint**: readers, engine swap, bounded cache and settings exist; `yarn test` and `yarn build` pass; single-map behaviour unchanged.

---

## Phase 3: User Story 1 — A random map from a folder at every start (Priority: P1) 🎯 MVP

**Goal**: with `mapsource = folder`, every start shows a random usable map from the folder; other files are
ignored; broken/HotA-without-archive maps are skipped; one clear message when nothing can be shown.

**Independent Test**: host simulation with a synthetic folder on each driver: `showing` with a map from the
folder; fixed seed reproduces the pick; broken-only folder → `FOLDER_UNREADABLE`, empty → `FOLDER_EMPTY`.

### Tests for User Story 1

- [X] T019 [P] [US1] Listing-parser tests in test/adapters/catalogue.test.ts: hand-written Chromium listing lines (research R2 sample: Cyrillic, spaces, sub-folder, `.`/`..`, dot-names), JSON escapes in names, a listing without `addRow` lines → empty; recursion depth 4 and the 5 000-entry cap with a fake fetcher; only `.h3m` (any case) kept
- [X] T020 [P] [US1] Controller tests with a fake engine and fake catalogue in test/adapters/controller-folder.test.ts: start picks the seeded first usable entry; read/summary/prepare failures move to the next with one warn log each; HotA entry skipped without HotA archive and eligible after it arrives; empty → `FOLDER_EMPTY`; all broken → `FOLDER_UNREADABLE`; the `map` slot and `mapfile` are never touched; switching back to `single` loads `mapfile` again (FR-021); `state().folder` fields

### Implementation for User Story 1

- [X] T021 [US1] Create src/adapters/shared/catalogue.ts: `CatalogueEntry` per data-model.md; `parseDirectoryListing(html)` (extract `addRow(` argument lists, read as JSON arrays); `listingCatalogue(rootUrl, read)` (recursive, depth 4, 5 000 entries, logged when capped; entries read with `readUserFile`); `zipCatalogue(blob, name)` over `ZipArchive` (entries read lazily); `filesCatalogue(files)`; `openCatalogueFor(value, deps)` choosing ZIP when the value ends in `.zip`, else listing
- [X] T022 [US1] Create src/adapters/shared/rotation.ts (DOM-free): seeded Fisher–Yates over entry ids with the RNG from src/core/util/rng.ts, seed `(controllerSeed, cycle)`; `next()` skipping `failed` entries; cycle rollover without repeating the last shown entry (FR-011); `markFailed`, `markFiltered`; `reset(entries)`
- [X] T023 [US1] Add the folder source to src/adapters/shared/controller.ts: `openCatalogue` dep; on `mapsource`/`mapfolder` change build the catalogue (generation-guarded like slots); picker loop read → `summarizeMapFile` → HotA eligibility → `engine.prepareMap` → `engine.showPreparedMap` with the placement of `applyView(true)` (refactor the placement choice out of `applyView` so both paths share it); `phase()` counts a shown folder map as showing (REQUIRED_SLOTS become sprite archive + (map slot or folder map)); messages only while nothing shows; info log per map shown (research R12); `snapshot().source` and `.folder`; `supplyFolder()` for the browser
- [X] T024 [US1] Keep the single-map path intact in src/adapters/shared/controller.ts: when `mapsource = single` the folder state is discarded (`discardPreparedMap`, catalogue dropped) and the `map` slot drives the view as in spec 004
- [X] T025 [P] [US1] Wire Wallpaper Engine in src/adapters/wallpaper-engine/main.ts: pass `openCatalogue` (value → `weFileUrl` → `openCatalogueFor`) to `createBrowserController`; the settings loop already copies every `SETTINGS` key
- [X] T026 [P] [US1] Wire Lively in src/adapters/lively/main.ts: `openCatalogue` via `livelyFileUrl` (ZIP read with `fetch`; a non-zip value tried as a listing, research LV-F1); `folder` values are strings like `file` values
- [X] T027 [P] [US1] Wire KDE page side in src/adapters/kde/main.ts (`kdeFileUrl` → listing or ZIP) and add the new keys to `configJson()` in packaging/kde/contents/ui/main.qml
- [X] T028 [US1] Extend src/adapters/shared/browser-controller.ts to accept and forward `openCatalogue` (and later `rememberedFolder`) to `createController`
- [X] T029 [US1] Generate the new settings into every manifest: tools/package/manifests/wallpaper-engine.ts (`folder` → textinput default `game/maps`, conditions, `mapnext` bool), tools/package/manifests/lively.ts (`folderDropdown` `userfiles` `*.zip`, `mapnext` button, hints), tools/package/manifests/kde.ts (main.xml types; config.qml `FolderDialog` + editable text field + `*.zip` `FileDialog` button, `SpinBox` 0–1440, combos, `mapnext` counter), tools/package/manifests/common.ts as needed; update test/tools/manifests-*.test.ts
- [X] T030 [US1] In tools/checks/packages/: check that `configJson()` in packaging/kde/contents/ui/main.qml lists every `SETTINGS` key and every `ACTIONS` key (contracts/settings.md "KDE")
- [X] T031 [US1] Host simulations in tools/checks/hosts/drivers.ts and tools/checks/hosts/invariants.ts: folder support per driver (WE and KDE: a real `file://` folder from T001 inside the package/test folder; Lively: a `.zip` in `userfiles/`); invariant 14 (showing a map from the folder, non-map files ignored, fixed seed → same map) and invariant 18 (half-broken folder rotates with no message; only broken → `FOLDER_UNREADABLE`; empty → `FOLDER_EMPTY`)
- [X] T032 [US1] Invariant 20 in tools/checks/hosts/invariants.ts: settings stored by the previous version (no folder keys) on every driver → `source = single`, same map and view as before (SC-006)
- [X] T033 [US1] KDE-F1 on the real session: `yarn accept kde --apply`, pick a folder, check over the DevTools port (AGENTS.md "KDE live debugging") that `state().folder.entries > 0`; if QtWebEngine returns no listing, implement the QML fallback (`FolderListModel` in packaging/kde/contents/ui/main.qml passing `mapfolderentries` in `configJson()`, consumed by src/adapters/kde/main.ts); record the result in specs/007-map-folder/research.md R2

**Checkpoint**: MVP — a folder works on every host at start; `yarn verify hosts` invariants 14, 18, 20 pass.

---

## Phase 4: User Story 2 — Maps change over time (Priority: P2)

**Goal**: "new map every N minutes" of visible time, "Next map now" on every host, no repeats within a cycle,
no empty frame at a switch, place/level settings applied to each new map.

**Independent Test**: host simulation with 5 maps: 30 `nextMap` calls → every map once per cycle, never twice
in a row, same sequence per seed; 100 switches → no black/placeholder frame, memory stable; hidden time not counted.

### Tests for User Story 2

- [X] T034 [P] [US2] Rotation tests in test/adapters/rotation.test.ts: every entry once per cycle; no immediate repeat across the cycle boundary; single-entry catalogue keeps returning it; same seed → same sequence over 3 cycles; failed entries never returned again
- [X] T035 [P] [US2] Controller tests in test/adapters/controller-folder.test.ts: map timer counts only active time (pause/hide banks elapsed time, nothing is read or prepared while hidden); `maprotation = 0` switches only at start and on `nextMap`; `nextMap` ignored while a switch is in progress and when `mapsource = single`; a new map gets a random place/level per settings and the place timer restarts from it (FR-013); interval change re-arms with the remaining time

### Implementation for User Story 2

- [X] T036 [US2] Add the map timer and `nextMap()` to src/adapters/shared/controller.ts per research R8 (active-time accumulation next to `syncRerollTimer`, cleared while hidden/paused/not showing; one switch at a time; single-map catalogue → `nextMap` only re-draws the place)
- [X] T037 [P] [US2] Handle the `mapnext` action in the bridges: src/adapters/wallpaper-engine/main.ts (toggle after the first event, like `viewreroll`), src/adapters/lively/main.ts (button), src/adapters/kde/main.ts (counter change after the first apply)
- [X] T038 [US2] Host invariants 15, 16 and 19 in tools/checks/hosts/invariants.ts (contracts/host-bridge.md): the host's "next map" control 30× over 5 maps; 100 forced switches with a canvas sample every animation frame around each switch (never all-black, never the placeholder; `phase` stays `showing`; `gpuBytes` and JS heap after switch 100 within 10 % of after switch 1; `preparedMaps` returns to 0); hidden/paused with `maprotation = 1` and a simulated 10 min clock
- [X] T039 [US2] Budget folder case in tools/checks/budget/index.ts (+ metrics.ts/evaluate.ts): a synthetic folder always and the owner's `<bundleDir>/Maps` when present (skip with a reason otherwise); first map ≤ 2 s warm (HotA folder ≤ 3 s); peak JS heap + GPU across a switch ≤ 300 MB; report in check-reports/budget
- [X] T040 [US2] If T039 exceeds 300 MB at the switch peak, implement the fallback of plan.md Constitution Check IV in src/runtime/engine.ts / src/core/render/webgl-renderer.ts (free the old atlas before uploading the new one while the last presented frame stays on screen) and re-measure; otherwise record the measured peak in specs/007-map-folder/research.md R6

**Checkpoint**: rotation works on every host; invariants 15, 16, 19 and the budget folder case pass.

---

## Phase 5: User Story 3 — Only maps of the sizes I like (Priority: P2)

**Goal**: size range and underground filters; applied on the fly; clear message when nothing matches.

**Independent Test**: host simulation with a mixed folder and `mapsizemax = s` → only S maps over a full cycle;
an unsatisfiable filter → `FOLDER_FILTERED` naming it; changing it back shows a map without a reload.

### Tests for User Story 3

- [X] T041 [P] [US3] Filter tests in test/adapters/rotation.test.ts: size range inclusive, min > max swapped (logged), underground `any|two|one`, HotA eligibility separate from user filters, re-evaluation keeps the current map when it still matches (FR-017)
- [X] T042 [P] [US3] Controller tests in test/adapters/controller-folder.test.ts: filter change while showing → stay or switch; nothing matches → `FOLDER_FILTERED` with the filter in `detail` only when nothing is showing, otherwise the current map stays and the reason is logged; summaries are not re-read for a filter change

### Implementation for User Story 3

- [X] T043 [US3] Implement `MapFilter` evaluation in src/adapters/shared/rotation.ts (from `mapsizemin`, `mapsizemax`, `mapunderground`; `sizeClassOf` from src/core/data/map-sizes.ts) and apply it in the picker of src/adapters/shared/controller.ts, with the full-pass detection that yields `FOLDER_FILTERED` vs `FOLDER_UNREADABLE`
- [X] T044 [US3] Re-evaluate on filter settings changes in `applyPatch` of src/adapters/shared/controller.ts (current kept if it matches, else a switch through prepare/show)
- [X] T045 [US3] Host invariant 17 in tools/checks/hosts/invariants.ts (contracts/host-bridge.md)
- [X] T046 [US3] Real-folder suite test/real/map-folder.test.ts (skips without files): over `<bundleDir>/Maps` (and the HotA maps folder when configured) run full cycles with filter combinations through the rotation + `summarizeMapFile` and check 100 % of picks match (SC-004); with injected broken copies the good maps still rotate (SC-005)

**Checkpoint**: filters work on every host; invariant 17 and the real-folder suite pass.

---

## Phase 6: User Story 4 — The folder is remembered and followed (Priority: P3)

**Goal**: the browser remembers the chosen folder across reloads; hosts rebuild the catalogue at start and on
change; a map that disappeared is skipped.

**Independent Test**: browser: choose a folder, reload → same maps available; host: add a map, restart → it is a
candidate; remove the next map → skipped silently.

### Tests for User Story 4

- [X] T047 [P] [US4] Tests for the remembered folder in test/adapters/remembered-folder.test.ts (fake IndexedDB as in the existing remembered-files tests, or browser test in test/browser/ if none exists): save/replace/load/clear; 5 000 entries / 256 MB cap → session only with a warn; the single-map record untouched
- [X] T048 [P] [US4] Controller tests in test/adapters/controller-folder.test.ts: `mapfolder` change rebuilds the catalogue (older build dropped by generation); an entry missing at read time (`FILE_MISSING`) is dropped and the next tried with no message

### Implementation for User Story 4

- [X] T049 [US4] Remembered folder in src/adapters/shared/remembered-files.ts per data-model.md "RememberedFolder" (`folder` record + `folder:<path>` blobs in the `userFiles` store, one transaction per replace, caps, `forgetFiles` clears it); inject as `rememberedFolder` through src/adapters/shared/browser-controller.ts; the controller loads it on start before flushing settings
- [X] T050 [US4] Browser folder input and drop in src/adapters/web/panel.ts and src/adapters/web/main.ts: "Map source" control, "Choose a folder of maps" (`<input type=file webkitdirectory>`), dropped folders walked with `webkitGetAsEntry()` (same limits as listings), dropped `.zip` → `zipCatalogue`; a single dropped `.h3m` sets `mapsource = single`, a folder/zip sets `folder`; filters, interval, "Next map now" button, key `N`; folder name + map count and the shown map's title/path (clarification "map name")
- [X] T051 [US4] Browser driver in tools/checks/hosts/drivers.ts: directory `setInputFiles` and a synthetic folder drop; extend invariant 11 in tools/checks/hosts/invariants.ts: the remembered folder survives a reload and "Forget files" clears it
- [X] T052 [US4] Host rebuild behaviour in tools/checks/hosts/invariants.ts (extend 14): add a map to the WE/KDE test folder and restart → it becomes a candidate; delete the entry the seed will pick next → skipped without a message

**Checkpoint**: all four stories work independently; `yarn verify hosts` passes all invariants.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T053 [P] Inspection CLIs in tools/inspect/map.ts and tools/inspect/cli.ts: `yarn h3 map summary MAP` (MapSummary JSON) and `yarn h3 map catalogue DIR|ZIP [--size-min --size-max --underground --hota]` (entries, summaries, verdicts, failures), exit codes as the other inspection commands; tests in test/tools/inspect.test.ts
- [X] T054 [P] Multi-screen sanity in tools/checks/hosts/invariants.ts (extend 14): two pages of the same driver with different seeds pick independently and share the decode cache without errors (clarification "screens")
- [X] T055 [P] Update README.md: folder source per host (browser picker/drop; Wallpaper Engine `game/maps` inside the wallpaper folder; Lively a `.zip` of maps; KDE a folder dialog), filters, intervals, "Next map now"
- [X] T056 [P] Update AGENTS.md: current state (spec 007), facts measured here (Chromium `file://` listing format, `loadMap` vs `prepareMap`, cache LRU and schema 9), the folder settings and new CLIs
- [X] T057 [P] Update docs/architecture.md: catalogue/rotation modules, prepare/show swap, cache bound
- [X] T058 [P] Add the Windows-session questions WE-F1, WE-F2, LV-F1 to the "Open questions for the Windows session" list in specs/004-platform-adapters/research.md with a link to specs/007-map-folder/research.md R2
- [X] T059 Run `yarn build`, `yarn test`, `yarn verify layers`, `yarn verify packages`, `yarn verify hosts`, `yarn verify budget`, `yarn verify determinism`; fix failures; record measured numbers (start-up, switch peak memory) in specs/007-map-folder/research.md
- [X] T060 Walk through specs/007-map-folder/quickstart.md sections 1–4 on Linux and correct the guide where reality differs
- [X] T061 Record the owner's follow-up in TODO.md item 5 "Map rotation": a more uniform way to choose files and folders across hosts (today a path on WE, picker/drop in the browser, a `.zip` on Lively, a folder dialog on KDE; research R1 "Owner review"), to be researched after this feature

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; blocks every story.
- **US1 (Phase 3)**: after Phase 2 — the MVP.
- **US2 (Phase 4)**: after US1 (uses the picker and prepare/show path of T023).
- **US3 (Phase 5)**: after US1; independent of US2 (can run in parallel with it).
- **US4 (Phase 6)**: after US1; independent of US2/US3.
- **Polish (Phase 7)**: after the stories it documents; T053 can start after Phase 2.

### Notable task dependencies

- T004 → T005, T021 (ZIP catalogue); T006 → T007, T008 → T021/T023.
- T009 → T011; T010 → T011 → T012, T023.
- T015 → T016/T017/T018, T029, T023.
- T021 + T022 + T023 → T025–T028 → T031/T032; T029 → T030.
- T036 → T037 → T038; T039 → T040.
- T043 → T044 → T045; T049 → T050 → T051.
- T061 references the research note written with this task list (research R1 "Owner review").

### Parallel opportunities

- Setup: T001 ∥ T002.
- Foundational: T003 ∥ T004 ∥ T006 (then T005 ∥ T007); T013 ∥ T009/T010; T016 ∥ T017 after T015.
- US1: T019 ∥ T020; T025 ∥ T026 ∥ T027 after T023/T028.
- US2 ∥ US3 ∥ US4 once US1 is done (different files except controller.ts — serialize T036, T043/T044, T049 edits to it).
- Polish: T053–T058 in parallel.

## Parallel Example: Foundational

```text
Task: "T003 Create src/core/data/map-sizes.ts …"
Task: "T004 Create src/core/formats/zip/zip.ts …"
Task: "T006 Create src/core/formats/h3m/summary.ts …"
Task: "T013 Bound the decode cache in src/runtime/cache.ts …"
```

## Parallel Example: User Story 1 bridges

```text
Task: "T025 Wire Wallpaper Engine in src/adapters/wallpaper-engine/main.ts"
Task: "T026 Wire Lively in src/adapters/lively/main.ts"
Task: "T027 Wire KDE page side in src/adapters/kde/main.ts and main.qml"
```

## Implementation Strategy

### MVP (US1)

Phases 1–3: a folder (or `.zip`) on every host gives a random usable map at each start, with the engine swap and
bounded cache already in place. Stop, run `yarn verify hosts`, and try it on the real KDE session (T033).

### Incremental delivery

1. MVP (US1) → owner check on KDE.
2. US2 rotation (+ budget folder case) → the main value for always-on desktops.
3. US3 filters.
4. US4 remembered browser folder and host rebuild.
5. Polish, docs, Windows questions handed to the Windows session.

### Notes

- Host differences stay inside each bridge's `openCatalogue`; everything after it is shared (owner review, research R1).
- Commit only when the owner asks; one chat per item (memory "workflow").
- Never commit game files or anything derived from them; fixtures are generated by committed code.
