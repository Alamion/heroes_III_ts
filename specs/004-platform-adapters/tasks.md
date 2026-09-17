---

description: "Task list for platform adapters"
---

# Tasks: Platform Adapters

**Input**: Design documents from `/specs/004-platform-adapters/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included — Constitution III and spec FR-020/FR-021 require automated checks. Unit tests use
synthetic fixtures; real-file variants resolve game files via `tools/shared/game-files.ts` and MUST skip
with a logged reason when absent.

**Organization**: by user story. Execution order: Foundational (engine additions, shared kit, package
build skeleton) → **US2 browser** (reference adapter, fully verifiable on Linux) → **US1 Wallpaper Engine**
(introduces the classic build) → **US5 packaging checks** → **US3 KDE** → **US4 Lively** → Polish.
Wallpaper Engine and Lively are verified on real hosts in a later Windows session (research.md "Open
questions for the Windows session"); here they are built and simulated only.

**Conventions for every task**: strict TS, `erasableSyntaxOnly` (no enums/namespaces/parameter properties;
`as const` objects), `.ts` import extensions, `import type`; English code/comments; logging only via
`src/core/util/log.ts` (tools: their logger); no game files or anything derived from them in the repo or
packages; no runtime dependency; no Windows-only tooling. User-facing text only through
`src/adapters/shared/strings.ts` (en + ru). Every **SPIKE** task records date, versions and results in
research.md "Measurements" before dependent tasks are finished.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US5 from spec.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: folders, scripts, fixtures and ignore rules every story uses.

- [ ] T001 Create folders `src/adapters/{shared,web,wallpaper-engine,lively,kde}/`, `packaging/{kde/contents/ui,kde/contents/config,previews}/`, `tools/package/manifests/`, `tools/checks/{packages,hosts}/`, `tools/accept/`, `test/adapters/` with no placeholder code
- [ ] T002 Add scripts `package` (`node tools/package/cli.ts`), `accept` (`node tools/accept/cli.ts`), `preview:web` to `package.json`; confirm `.gitignore` ignores `dist/` and `check-reports/` (add the missing entry only if one is not ignored)
- [ ] T003 [P] Add synthetic generators for bad inputs in `test/fixtures/synthetic/bad-files.ts`: HotA-version map (0x20), WoG map (0x33), truncated gzip map, LOD without terrain or data entries, random bytes, zero-length file (reuse `writer.ts`, `lod.ts`, `h3m.ts`)
- [ ] T004 [P] Add `test/fixtures/synthetic/wallpaper-set.ts` producing a consistent synthetic sprite archive + data archive + two-level map (reusing `terrain-archive.ts`, `object-defs.ts`, `h3m.ts`) written to a temp folder, for host simulations

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: host-neutral engine additions, the shared wallpaper kit and a package build skeleton. No
user story can start before this phase is complete.

### Core and runtime

- [ ] T005 [P] Implement pure `placeView` (modes random/centre/coords, level fallback to 0, clamped extremes, small-map centring, seeded fractions) in `src/core/render/view-placement.ts` per [contracts/engine-api.md](contracts/engine-api.md) and data-model "ViewPlacement"
- [ ] T006 [P] Unit tests for view placement (fractions 0/50/100 on 36×36 and 252×252, underground on one-level map, map smaller than view, same seed → same position, different seeds differ) in `test/core/render/view-placement.test.ts`
- [ ] T007 [P] Add `minFrameIntervalMs` to `src/runtime/scheduler.ts` (a due frame earlier than the interval is deferred with the single timer); tests in `test/runtime/scheduler.test.ts` (limit honoured, still ≤ 1 rAF + 1 timer, inactive → 0 callbacks)
- [ ] T008 [P] Add `clear()` to `DecodedCache` in `src/runtime/cache.ts` (all stores; no-op cache resolves) with a test in `test/runtime/cache.test.ts` using a fake IndexedDB-less path
- [ ] T009 [P] Implement `classifyFile(blob)` in `src/runtime/file-kind.ts` per research R6 (LOD magic → index names via `LodArchive` over `blob.slice`; gzip map → at most the first 64 KB inflated through a `DecompressionStream` reader cancelled early, raw map → first bytes, then `versionFromCode`; export `KNOWN_OTHER_VERSIONS` from `src/core/formats/h3m/h3m.ts` if needed); tests over T003/T004 fixtures in `test/runtime/file-kind.test.ts`, including a 252×252 map whose classification reads ≤ 64 KB of inflated output
- [ ] T010 Extend `src/runtime/engine.ts`: `workerFactory` option (default keeps module worker), `setUserScale(1|2|3)` (camera.scale = dpr × userScale, keeps view centre; `resize` and `loadMap` keep it), `placeView(level, placement)`, `setFrameLimit(fps)`, `forgetCache()`, per-slot load generations returning `SUPERSEDED` for stale results; update `EngineStats` if needed
- [ ] T011 Wrap worker decode steps in `navigator.locks.request('h3dynam:decode:<identity>')` with a cache re-check inside the lock, falling back when `navigator.locks` is absent, in `src/runtime/worker.ts` and `src/runtime/decode.ts`
- [ ] T012 Tests for engine additions in `test/browser/engine-adapters.test.ts` (headless suite): user scale ×2 frame equals ×1 frame nearest-upscaled for the same view; stale `loadMap` superseded by a newer one; `forgetCache` then reload reports `fromCache: false`; two engines on one page decode an archive once (lock)
- [ ] T013 Run `yarn verify determinism` and `yarn verify fidelity --map test_map.h3m --all-regions` (skip without game files) to confirm engine changes keep renders identical; record in research.md "Measurements"

### Shared wallpaper kit (`src/adapters/shared/`)

- [ ] T014 [P] Settings definition, defaults, validation and coalescing helpers in `src/adapters/shared/settings.ts` (DOM-free: no DOM, host or runtime imports, so tools can import it) per [contracts/settings.md](contracts/settings.md) (keys, enums, ranges, `visibleWhen`, reserved keys `mapsource`/`mapfolder`/`maprotation` rejected as definitions; unknown keys ignored with a debug log)
- [ ] T015 [P] String tables `en` and `ru` (setting labels and option labels, `viewx_hint`, messages for every `MessageCode`, placeholder, panel, package title/description, per-host instructions) with `ru` typed as `Record<keyof typeof en, string>` and `pickLanguage(tag)` in `src/adapters/shared/strings.ts` (DOM-free, importable by tools)
- [ ] T016 [P] Host path → URL mapping (`weFileUrl`, `livelyFileUrl`, `kdeFileUrl`) and `readUserFile(url)` (XHR arraybuffer for `file:`, fetch otherwise; missing/unreadable → typed error) in `src/adapters/shared/file-url.ts` per research R4 and host-bridge contract
- [ ] T017 [P] Overlay (placeholder listing missing slots, loading line, messages with 10 s fade, non-intrusive corner placement, `lang` attribute) in `src/adapters/shared/overlay.ts` and `src/adapters/shared/overlay.css`
- [ ] T018 [P] Classic worker factory from an embedded source string (`Blob` + `URL.createObjectURL`, revoke after start) in `src/adapters/shared/worker-factory-classic.ts`
- [ ] T019 `WallpaperController` state machine (Waiting/Loading/Showing/Problem, slot classification and `WRONG_KIND`, last-wins file reads, 150 ms coalescing, `placeView` on start and map change only, level/scale/objects/view applied live, active = showing ∧ ¬paused ∧ ¬hidden, `document.visibilitychange`, `ResizeObserver`, frame limit, language, messages mapped from engine diagnostics and `FormatError`, test hook `__h3wallpaper` and `__h3testOptions`) in `src/adapters/shared/controller.ts` per [contracts/host-bridge.md](contracts/host-bridge.md); `CACHE_UNAVAILABLE` is logged and shown only when a start exceeds the warm-start budget
- [ ] T020 [P] Unit tests for settings validation/defaults/reserved keys in `test/adapters/settings.test.ts`
- [ ] T021 [P] Unit tests for string parity (every key non-empty in both tables, every `MessageCode` and setting label present) and `pickLanguage` (`ru-RU`, `ru`, `de-DE`, empty) in `test/adapters/strings.test.ts`
- [ ] T022 [P] Unit tests for path mapping (`C:\a b\Карты\x.h3m`, `#`, `%`, UNC path, already `file:` URL, `userfiles\x.lod`, `null`/`""`) in `test/adapters/file-url.test.ts`
- [ ] T023 Unit tests for the controller with a fake engine and fake reader (placeholder states, wrong-kind into proper slot, missing data archive → terrain + message, superseded reads, coalescing burst of 20 slider events → one apply, random re-roll only on start/map change, pause/hidden → engine inactive, failure while showing keeps previous map, cache unavailable → still showing without a message) in `test/adapters/controller.test.ts`
- [ ] T024 Extend `tools/checks/layers.ts`: files in `src/adapters/<host>/` may import `src/adapters/shared/`, runtime and core but not another host folder or `dev-harness`; `src/adapters/shared/` may not import host folders; `tools/` may import only `src/adapters/shared/settings.ts` and `src/adapters/shared/strings.ts` from adapters (FR-008), and those two files may not use DOM/host globals or import runtime; update the AGENTS.md layering sentence; tests in `test/tools/layers.test.ts`

### Build flavours and package skeleton

- [ ] T025 Split `vite.config.ts` into flavours selected by mode: `harness` (current, default for `yarn dev`/`yarn build`), `web` (ESM, `base: './'`, root `src/adapters/web`, out `dist/packages/web`), `host` (classic IIFE per host entry `src/adapters/<host>/main.ts` plus a separate classic `listener.js` for WE and Lively, worker built separately as IIFE and embedded as a string constant for `worker-factory-classic.ts`, out `dist/build/<host>`); keep vitest config intact
- [ ] T026 [P] Deterministic archive writers (zip with stored/deflate entries, tar + gzip; sorted paths, fixed mtime 1980-01-01 / 0, fixed modes) in `tools/shared/archive.ts`; tests in `test/tools/archive.test.ts` (round-trip via `unzip -l`/`tar -tzf` when available, identical bytes on repeat)
- [ ] T027 `yarn package` CLI skeleton in `tools/package/cli.ts` and `tools/package/build.ts`: parse `--host`, `--out`, `--no-build`; run the flavour builds through the Vite API; copy per-host static files; call manifest generators (added per story); write archives; print the JSON of [contracts/cli.md](contracts/cli.md); read nothing outside the repo and `node_modules`

**Checkpoint**: engine additions tested, controller tested with a fake engine, `yarn package --host web` produces an (empty-manifest) build.

---

## Phase 3: User Story 2 — Try it in a plain browser (Priority: P1) 🎯 MVP

**Goal**: static web page where the user picks or drops the three files, which are remembered; settings
panel; published to GitHub Pages from `testing`.

**Independent Test**: `yarn verify hosts --host web` (synthetic and real files) passes the invariants of contracts/host-bridge.md;
reload shows the map without supplying files; "forget files" returns the placeholder.

### Tests for User Story 2

- [ ] T028 [P] [US2] Unit tests for remembered files (put/get/delete per slot, forget removes database, IndexedDB unavailable → no throw) in `test/adapters/remembered-files.test.ts` (browser suite)
- [ ] T029 [US2] Host simulation framework in `tools/checks/hosts/index.ts` and `tools/checks/hosts/invariants.ts`: launch Chromium, open a package entry with `?h3test=1` / `__h3testOptions`, run the invariants 1–10 of [contracts/host-bridge.md](contracts/host-bridge.md) through a per-host driver interface (`supplyFiles`, `setSetting`, `setPaused`, `setLanguage`, `advanceClock`, `disableIndexedDb`), compare the ×1 frame with `tools/shared/render-page.ts` output (reference camera: take `offsetX/offsetY/level` from `state().engine.camera` and pass them to the render page's `setMapping`), write `check-reports/hosts/<ts>/report.json` and PNG/diff on mismatch; register `hosts` in `tools/checks/cli.ts`
- [ ] T030 [US2] Web driver in `tools/checks/hosts/web.ts`: serve `dist/packages/web` under `/heroes_III_ts/`, supply files via `setInputFiles` and a synthetic `drop` event with a `DataTransfer`, settings via panel controls, pause via faked `visibilityState`, language via browser locale, reload for remembered files

### Implementation for User Story 2

- [ ] T031 [P] [US2] Remembered files store (IndexedDB `h3dynam-files`, store `userFiles`, key slot) in `src/adapters/shared/remembered-files.ts` per data-model "RememberedFile"
- [ ] T032 [P] [US2] Settings panel rendered from the definition (file rows with picker, segmented enums, range sliders with `visibleWhen`, objects checkbox, language, "Forget files"; auto-hide after 4 s idle; `H` toggles) in `src/adapters/web/panel.ts` and styles in `src/adapters/web/panel.css`
- [ ] T033 [US2] Browser entry in `src/adapters/web/index.html` and `src/adapters/web/main.ts`: CSP meta per research R14, canvas + overlay, `createController({ storage: 'remember' })`, whole-page drop zone, multi-file picker, keyboard (arrows scroll 32 px × scale, `U`, `O`, `H`) and pointer drag scrolling, settings persisted to `localStorage["h3dynam:settings"]` with try/catch, logger level `warn`
- [ ] T034 [US2] Browser user documentation (where to find `H3sprite.lod`, `h3bitmap.lod`, maps in a Complete install; files never leave the browser) shown from the panel "?" in `src/adapters/web/help.ts` using strings from T015
- [ ] T035 [US2] GitHub Pages workflow in `.github/workflows/pages.yml`: on push to `testing` — checkout, setup Node 22, `yarn install --frozen-lockfile`, `yarn build`, `yarn test`, `yarn package --host web`, `yarn verify packages --host web --no-build`, `yarn verify hosts --host web --no-build` with `H3_CHROMIUM` set to the runner's Chrome, then `actions/upload-pages-artifact` + `actions/deploy-pages` (permissions `pages: write`, `id-token: write`); deploy job needs the check job
- [ ] T036 [US2] Run `yarn package --host web && yarn verify hosts --host web` and `--files real`; fix until pass; do quickstart §4 manual check locally and record in research.md "Measurements"

**Checkpoint**: browser version works locally and passes its simulation; Pages deploys after merge.

---

## Phase 4: User Story 1 — Wallpaper Engine (Priority: P1)

**Goal**: WE package (classic build) with generated `project.json`, file properties, pause and fps handling.

**Independent Test**: `yarn verify hosts --host wallpaper-engine` passes with the page opened as `file://`
and the listener driven like WE; package contains a valid generated `project.json`.

### Tests for User Story 1

- [ ] T037 [P] [US1] Manifest generator tests (every setting present, `ui_*` tokens in `en-us` and `ru-ru`, no `fileType`, conditions for `viewx`/`viewy`, combo values match definition, no `lodfile`/`hotalodfile`) in `test/tools/manifests-wallpaper-engine.test.ts`
- [ ] T038 [US1] WE driver in `tools/checks/hosts/wallpaper-engine.ts`: open `dist/packages/wallpaper-engine/index.html` as `file://` in Chromium with `--allow-file-access-from-files`, call `wallpaperPropertyListener.applyUserProperties` first with all properties (file values as raw Linux paths converted to the Windows-style mapping under test via a `file:///` path), then changes; `setPaused`; `applyGeneralProperties({ fps: 1 })` checks the frame limit; assert no module scripts load

### Implementation for User Story 1

- [ ] T039 [US1] Classic listener that queues events until the controller starts in `src/adapters/wallpaper-engine/listener.ts`, built to a separate `listener.js` and loaded by the first `<script src>` of `src/adapters/wallpaper-engine/index.html` (no inline script: CSP)
- [ ] T040 [US1] WE entry in `src/adapters/wallpaper-engine/main.ts`: `createController({ fileUrl: weFileUrl, storage: 'none', workerFactory: classic })`, drain queued events, map `applyUserProperties` keys, `applyGeneralProperties` → `setFrameLimit` (and language when present), `setPaused` → `setHostPaused`
- [ ] T041 [US1] `project.json` generator in `tools/package/manifests/wallpaper-engine.ts` per [contracts/settings.md](contracts/settings.md); wire WE into `tools/package/build.ts` (copy `index.html`, bundle, `preview.jpg` from T048)
- [ ] T042 [US1] Delete the proof-of-concept root `project.json`; update the AGENTS.md "Wallpaper Engine Notes" paragraph that mentions it being kept
- [ ] T043 [US1] WE user documentation (`README.txt` en/ru generated from strings: where the files are, properties to set) added to the package by `tools/package/manifests/wallpaper-engine.ts`
- [ ] T044 [US1] Run `yarn package --host wallpaper-engine && yarn verify hosts --host wallpaper-engine` (synthetic and `--files real`); fix until pass

**Checkpoint**: WE package built and simulated; real-host questions WE-1…WE-10 stay open for the Windows session.

---

## Phase 5: User Story 5 — Build and publish the packages (Priority: P2)

**Goal**: static package checks, reproducibility, previews, budgets on packages, no game content.

**Independent Test**: `yarn verify packages --reproducible` passes for all built packages, also with
`public/dev-assets/` absent.

### Tests for User Story 5

- [ ] T045 [P] [US5] Tests for the static checks on crafted package folders (a `.lod` file, a file with `LOD\0` magic, a > 2 MB file, an `https://` URL in JS, the words from the affiliation list, a missing string key, a `type="module"` script in a host package) in `test/tools/packages-check.test.ts`
- [ ] T046 [P] [US5] Extend `test/tools/hygiene.test.ts` to assert packaging sources (`packaging/`, `tools/package/`) contain no game files or game-derived literals

### Implementation for User Story 5

- [ ] T047 [US5] `yarn verify packages` in `tools/checks/packages/index.ts` with checks `required-files`, `no-game-content`, `no-external-urls`, `no-affiliation`, `strings-complete`, `manifest-matches-settings`, `classic-flavour`, `no-inline-scripts` (no inline `<script>` bodies or `on*` attributes, CSP meta present), `runtime-size`, `kpackage-valid` (skip, exit 4 without `kpackagetool6`), `reproducible` (`--reproducible`), report `check-reports/packages/<ts>/report.json`; register in `tools/checks/cli.ts`
- [ ] T048 [P] [US5] Original preview art (map-like abstract tiles, project name, no game imagery or logos) in `packaging/previews/preview.svg` and rasterizer to `preview.jpg`/`thumbnail.jpg` via headless Chromium screenshot in `tools/package/previews.ts` (deterministic size and quality)
- [ ] T049 [US5] Move budget measurement to packages in `tools/checks/budget/metrics.ts` and `tools/checks/budget/size.ts`: web package over http (panel input ids replace harness ids) and WE package as `file://`; size rule sums shipped JS per package incl. embedded worker; update `test/tools/budget.test.ts`
- [ ] T050 [US5] Add `packages` and `hosts --files synthetic` to `tools/checks/all.ts`
- [ ] T051 [US5] Run `yarn package --host all && yarn verify packages --reproducible`, then again with `public/dev-assets` temporarily renamed; run `yarn verify budget`; record runtime sizes and start times in research.md "Measurements"

**Checkpoint**: every package passes static checks and budgets.

---

## Phase 6: User Story 3 — KDE Plasma wallpaper (Priority: P2)

**Goal**: Plasma 6 wallpaper plugin with a WebEngineView page, generated config UI, persistent shared
profile, pause when covered or locked.

**Independent Test**: `yarn verify hosts --host kde` passes; `kpackage-valid` passes; `yarn accept kde --apply`
shows the map on the real desktop and restores the previous wallpaper.

### Spikes

- [ ] T052 [US3] **SPIKE S2** minimal plugin (WallpaperItem + WebEngineView loading a classic test page) installed with `kpackagetool6` and set via plasmashell DBus: XHR of `file://` user files, Blob worker, WebGL, `runJavaScript` timing, `TasksModel` maximised detection, lock-screen appearance; record in research.md "Measurements" (throwaway files under the scratchpad, not committed)
- [ ] T053 [US3] **SPIKE S3** singleton persistent `WebEngineProfile` shared by two WallpaperItems (two activities or screens), IndexedDB survives `plasmashell --replace`; record results and adjust research R11/R13 if needed

### Tests for User Story 3

- [ ] T054 [P] [US3] Generator tests for `main.xml` (types, defaults, min/max) and `config.qml` string table (all labels en/ru) in `test/tools/manifests-kde.test.ts`
- [ ] T055 [US3] KDE driver in `tools/checks/hosts/kde.ts`: open `dist/packages/kde/contents/web/index.html` as `file://` with `--allow-file-access-from-files`, call `h3wallpaper.apply(json)` with `file://` URLs and language, `h3wallpaper.setPaused`, reload for page start

### Implementation for User Story 3

- [ ] T056 [US3] Page-side bridge `window.h3wallpaper { apply, setPaused }` (full-set apply, placeholder before first apply) in `src/adapters/kde/bridge.ts`, entry `src/adapters/kde/main.ts` (`fileUrl: kdeFileUrl`, `storage: 'none'`, classic worker) and `src/adapters/kde/index.html`
- [ ] T057 [US3] QML shell `packaging/kde/contents/ui/main.qml` (WallpaperItem, black background, WebEngineView with persistent profile from `SharedProfile.qml` singleton + `qmldir`, `apply` after load and on `root.configuration` changes, lock screen → plain background) per research R11 and S2/S3 results
- [ ] T058 [US3] Visibility in `packaging/kde/contents/ui/Visibility.qml`: `TasksModel` filtered by screen (maximised or fullscreen, not minimised) and DBus `org.freedesktop.ScreenSaver.ActiveChanged` → `setPaused(b)` then `WebEngineView.visible = !b`
- [ ] T059 [US3] Templates `packaging/kde/metadata.json.tmpl`, `packaging/kde/contents/config/main.xml.tmpl`, `packaging/kde/contents/ui/config.qml.tmpl` and generator `tools/package/manifests/kde.ts` (kcfg entries, config rows with FileDialog/ComboBox/Slider/CheckBox, `strings.js` picked by `Qt.uiLanguage`, Id `io.github.alamion.h3dynam`); wire KDE into `tools/package/build.ts` (page under `contents/web/`, `.tar.gz`)
- [ ] T060 [US3] `yarn accept kde` in `tools/accept/cli.ts` and `tools/accept/kde.ts` per [contracts/cli.md](contracts/cli.md) (install/upgrade, `--apply` saves current wallpaper config per screen via plasmashell scripting, sets plugin + dev files, optional CDP status via `QTWEBENGINE_REMOTE_DEBUGGING`, screenshot with `spectacle`, restore; report to `check-reports/accept/<ts>/`)
- [ ] T061 [US3] KDE user documentation (install with `kpackagetool6` or "Get New Wallpaper Plugins", where the files are) generated as `README.md` en/ru into the package by `tools/package/manifests/kde.ts`
- [ ] T062 [US3] Run `yarn package --host kde && yarn verify packages --host kde && yarn verify hosts --host kde` (synthetic and real); then quickstart §5 KDE on the real session with `yarn accept kde --apply`; record outcome in research.md "Measurements"

**Checkpoint**: KDE plugin accepted on the real Plasma session.

---

## Phase 7: User Story 4 — Lively Wallpaper (Priority: P3)

**Goal**: Lively zip package with folderDropdown file settings, localized properties and pause event.

**Independent Test**: `yarn verify hosts --host lively` passes with the page served on a `*.localhost`
origin and properties delivered like Lively.

### Tests for User Story 4

- [ ] T063 [P] [US4] Generator tests for `LivelyInfo.json` (`Type: 1`, `Arguments: "--pause-event true"`), `LivelyProperties.json` (folderDropdown folder `userfiles`, filters, dropdown items order = definition order), `.loc.json` (`ru` complete) in `test/tools/manifests-lively.test.ts`
- [ ] T064 [US4] Lively driver in `tools/checks/hosts/lively.ts`: serve the unpacked package on `http://<hash>.localhost:<port>/`, copy fixture files into `userfiles/`, call `livelyPropertyListener` once per control after load (values `userfiles\\name`, dropdown indices) and on change, `livelyWallpaperPlaybackChanged('{"IsPaused":true}')`

### Implementation for User Story 4

- [ ] T065 [US4] Classic listeners (`livelyPropertyListener`, `livelyWallpaperPlaybackChanged`) with event queue in `src/adapters/lively/listener.ts`, built to a separate `listener.js` loaded by the first `<script src>` (no inline script: CSP), entry `src/adapters/lively/main.ts` (`fileUrl: livelyFileUrl`, dropdown index → value by definition order, `storage: 'none'`, classic worker) and `src/adapters/lively/index.html`
- [ ] T066 [US4] Generator `tools/package/manifests/lively.ts` for `LivelyInfo.json`, `LivelyInfo.loc.json`, `LivelyProperties.json`, `LivelyProperties.loc.json`, empty `userfiles/.keep`, `README.txt` en/ru; wire Lively into `tools/package/build.ts` (`.zip` with `LivelyInfo.json` at the root)
- [ ] T067 [US4] Run `yarn package --host lively && yarn verify packages --host lively && yarn verify hosts --host lively` (synthetic and real); fix until pass

**Checkpoint**: Lively package built and simulated; real-host questions LV-1…LV-7 stay open for the Windows session.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T068 [P] Update AGENTS.md: "Current State" (adapters, packages, Windows hosts pending), layout (`src/adapters/*`, `packaging/`, `tools/package`, `tools/accept`), commands (`yarn package`, `yarn verify packages|hosts`, `yarn accept kde`, `yarn preview:web`), host facts needed by agents (file:// classic build, XHR, Lively folderDropdown copy, KDE profile singleton), and the Windows follow-up session pointer
- [ ] T069 [P] Update TODO.md item 3.2 (done on Linux; Windows session for WE/Lively with research.md open questions) and Housekeeping (warm start margin measured with host file reads)
- [ ] T070 [P] Add a "Windows session" handoff section to research.md: package paths, how to enable DevTools in WE and Lively, how to set `window.__h3testHook = true`, the invariants to reproduce, where to record answers
- [ ] T071 Run `yarn build`, `yarn test`, `yarn verify all`; fix regressions; confirm `git status` shows no game files, packages or reports staged
- [ ] T072 Constitution compliance review: add "Compliance Review" table and deviations from this plan to `specs/004-platform-adapters/plan.md`; set spec status

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories.
- **US2 (Phase 3)** first: provides the host simulation framework (T029) used by all later stories.
- **US1 (Phase 4)** after US2: first classic-build host.
- **US5 (Phase 5)** after US1: static checks need at least the web and WE packages; T049 budget on packages
  needs both.
- **US3 (Phase 6)** after US5 (uses `kpackage-valid` and the classic build); spikes T052–T053 before T057–T058.
- **US4 (Phase 7)** after US5; independent of US3 (can run in parallel with it).
- **Polish (Phase 8)** after all stories.

### Within Phase 2

- T005–T009 parallel; T010 after T005, T007, T008; T011 independent of T010; T012 after T010–T011; T013 after T010–T011.
- T014–T018 parallel; T019 after T014–T018 and T010; T020–T022 parallel with T019; T023 after T019.
- T025 after T018; T026 parallel; T027 after T025–T026.

### Parallel Opportunities

```text
Phase 2 core:   T005, T006, T007, T008, T009, T011
Phase 2 kit:    T014, T015, T016, T017, T018, T020, T021, T022, T026
US2:            T028, T031, T032 (then T033)
US1:            T037 with T039
US5:            T045, T046, T048
US3 / US4:      Phase 6 and Phase 7 can run side by side after Phase 5; T054 and T063 in parallel
Polish:         T068, T069, T070
```

## Implementation Strategy

### MVP (US2)

Phases 1–3: host-neutral engine and controller plus the browser version with remembered files and Pages
deployment. Stop and validate with `yarn verify hosts --host web` and quickstart §4.

### Incremental delivery

1. US2 browser → validate, merge-ready.
2. US1 Wallpaper Engine (classic build) → simulated; handed to Windows session later.
3. US5 packaging checks and budgets on packages.
4. US3 KDE → accepted on the real Plasma session.
5. US4 Lively → simulated; handed to Windows session later.
6. Polish, `yarn verify all`, compliance review, commit and merge into `testing` (on the owner's request).
