---

description: "Task list for the foundation rewrite"
---

# Tasks: Foundation Rewrite

**Input**: Design documents from `/specs/002-foundation-rewrite/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included — the spec (FR-021…FR-024) and Constitution III require automated checks for
every feature. Tests on real game files resolve them via `tools/shared/game-files.ts` and MUST
skip with a logged reason when absent; everything else uses synthetic fixtures.

**Organization**: by user story. Stories share one code base, so later stories build on earlier
ones (see Dependencies); each phase still ends with its own independent test.

**Conventions for every task**: strict TS, `erasableSyntaxOnly` (no enums/namespaces/parameter
properties; `as const` objects), `.ts` import extensions, `import type`; English code/comments;
logging only via `src/core/util/log.ts`; parsers throw `FormatError` (never guessed skips); no
game files or derived data committed. Facts come from research.md §4–§9; h3lwp and VCMI are
study-only, homm3-parser layouts may be ported with attribution.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US6 from spec.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: remove the proof of concept, set dependencies and project config for the new layout.

- [X] T001 Delete PoC code and tests: `src/App.tsx`, `src/main.tsx`, `src/lib/**`, `test/h3m.test.ts`, `test/lod.test.ts`, `test/palette-rotation.test.ts`, `test/test-utils.ts` (used only by those tests), `scripts/sync.js`, and the root `index.html` (it loads `/src/main.tsx`; the harness page moves to `src/adapters/dev-harness/index.html` in T003/T076) (keep `test/reference-env/**`, `tools/reference-env/**`, `project.json`)
- [X] T002 Update `package.json`: remove deps `pixi.js`, `preact`, `pako`, `fflate`, `lzma-purejs` and devDeps `@preact/preset-vite`, `@types/pako`, `chokidar`; add devDep `playwright-core`; remove `sync`/`sync:watch`; add scripts `"h3": "node tools/inspect/cli.ts"`, `"verify": "node tools/checks/cli.ts"`; run `yarn install` and commit `yarn.lock` changes
- [X] T003 Rewrite `vite.config.ts`: no Preact plugin, no project.json copy; `root: 'src/adapters/dev-harness'` (so `yarn dev` serves the harness at `/`) with `publicDir` pointing at repo `public/` and `build.outDir` at repo `dist/`; multi-page build with `src/adapters/dev-harness/index.html` (harness) and `src/adapters/dev-harness/render.html` (check render page); worker bundling as ES module; Vitest `include: ['test/**/*.test.ts']`, coverage over `src/core/**`
- [X] T004 Split TypeScript configs: `tsconfig.core.json` (include `src/core/{util,data,formats,state,sim}/**`, `lib: ["ES2023"]` without DOM, types none, plus typed accessors in `src/core/util/web-globals.ts` (implemented as typed `globalThis` lookups instead of an ambient `.d.ts`, which would clash with `@types/node` when tools compile core) for the only web globals core may use — `DecompressionStream`, `TextDecoder`, `Response`/`Blob` stream helpers needed by `inflate.ts` — so `fs`/DOM stay unavailable), `tsconfig.app.json` (include `src/core/render/**`, `src/runtime/**`, `src/adapters/**`, DOM + WebWorker libs, no JSX), `tsconfig.node.json` (tools + test + vite config, add `test/**/*.ts`); reference all three from `tsconfig.json`; `yarn build` runs `tsc -b`
- [X] T005 [P] Add `check-reports/` to `.gitignore`
- [X] T006 [P] Create `THIRD_PARTY_NOTICES.md` with the MIT notice of homm3-parser (Copyright (c) 2018 Sergey Kostyrko) and a credit line for homm3tools' format description; state that h3lwp and VCMI were studied only
- [X] T007 [P] Remove `.opencode/skills/developing-preact/` (Preact dropped, research §14)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: utilities, data tables, tool plumbing and synthetic writers that every story uses.

- [X] T008 [P] Implement `FormatError` (codes, file, offset, format, version, structure, `toJSON`) in `src/core/util/errors.ts` per data-model.md Common
- [X] T009 [P] Implement level-gated logger with injectable sink (`setLogSink`, `setLogLevel`) in `src/core/util/log.ts`
- [X] T010 [P] Implement `Clock` type + fixed/manual clocks and seeded `Rng` (mulberry32) in `src/core/util/clock.ts` and `src/core/util/rng.ts`
- [X] T011 Implement bounds-checked `ByteReader` over `DataView` (u8/u16/u32/i32 LE, bytes, fixed/length-prefixed strings returned as `{bytes, text}` where `text` is decoded with `TextDecoder('windows-1251')` (raw bytes kept for exactness), `skipKnown(n, structure)`, `expectEnd()`, structure-path stack used in errors) in `src/core/util/byte-reader.ts`
- [X] T012 [P] Implement `ByteSource` interface and in-memory source in `src/core/util/byte-source.ts`; `inflate(bytes, 'deflate'|'gzip')` over `DecompressionStream` mapping failures to `DECOMPRESS_FAILED` in `src/core/util/inflate.ts`
- [X] T013 [P] Unit tests for ByteReader bounds/strings/structure paths, inflate errors, Rng determinism in `test/core/util.test.ts`
- [X] T014 [P] Typed tables in `src/core/data/terrain.ts` (terrain 0–9, river 0–4, road 0–3 → DEF names, research §4) and `src/core/data/palette-rotation.ts` (ranges, direction, `stepMs: 180` marked "pending measurement T066", research §5)
- [X] T015 [P] Typed tables in `src/core/data/object-classes.ts` (class id → name, body family, random-class rules from research §9) and `src/core/data/players.ts` (8 player colors, names)
- [X] T016 [P] `CHECK_THRESHOLDS` in `src/core/data/thresholds.ts` (notCheckableComparedShare 0.25, sc007CpuTolerance 0.20, sc007CpuFloorMs 0.5, gpuBytesTolerance 0.01)
- [X] T017 [P] Node `ByteSource` over `fs.promises.FileHandle` in `tools/shared/node-source.ts`
- [X] T018 [P] Game file resolution in `tools/shared/game-files.ts`: reuse `loadConfig` from `tools/reference-env/config.ts`; it throws `RefError` `CONFIG_INVALID` when no bundleDir is configured — catch exactly that code, log once at debug level, and continue with `public/dev-assets/` only (rethrow any other error); search `public/dev-assets/`, `<bundleDir>/Maps`, `<bundleDir>/Data` case-insensitively, parse `archive.lod:ENTRY`, and a `requireGameFile()` helper for tests returning `null` + logged skip reason
- [X] T019 [P] PNG codec (RGBA/RGB/gray encode + decode, filter types 0–4) on `node:zlib` in `tools/shared/png.ts` with round-trip tests in `test/tools/png.test.ts`
- [X] T020 [P] JSON CLI runner (arg parsing like `tools/reference-env/cli.ts`, one JSON on stdout, exit codes 0/1/2/3, plus 4 = skip for `verify` commands only, `FormatError` → error JSON) in `tools/shared/cli-runner.ts`
- [X] T021 [P] Headless Chromium launcher (playwright-core, `H3_CHROMIUM` default `/usr/bin/chromium-browser`, SwiftShader flags from research §2, Vite preview server start/stop, `PREREQ_MISSING` when browser absent) in `tools/shared/browser.ts`
- [X] T022 [P] Synthetic byte writer helpers (LE ints, strings, gzip/zlib via node:zlib) in `test/fixtures/synthetic/writer.ts`
- [X] T023 Layer dependency check (TypeScript compiler API; rules from contracts/checks-cli.md `verify layers`) in `tools/checks/layers.ts`, wired into `tools/checks/cli.ts` as `verify layers`; test with a temporary violating fixture tree in `test/tools/layers.test.ts`

**Checkpoint**: `yarn build`, `yarn test`, `yarn verify layers` pass on the empty skeleton.

---

## Phase 3: User Story 1 — Agent inspects game files from the command line (P1) 🎯 MVP

**Goal**: correct, bounds-checked LOD/DEF/PCX/H3M parsing with inspection CLIs.

**Independent test**: quickstart §2 — `yarn h3 lod list`, `def dump/png`, `map info/tile/objects`,
HotA rejection and `map parse-all` with zero failures; synthetic tests pass without game files.

### Synthetic fixtures for US1

- [X] T024 [P] [US1] Synthetic LOD writer (stored + zlib entries, duplicate names, HotA-1.8 marker variant) in `test/fixtures/synthetic/lod.ts`
- [X] T025 [P] [US1] Synthetic DEF writer (procedural palette and patterns; compression 0, 1, 2, 3; old-format quirk; repeated frame offsets; multiple groups) in `test/fixtures/synthetic/def.ts`
- [X] T026 [P] [US1] Synthetic PCX writer (indexed + bgr24) in `test/fixtures/synthetic/pcx.ts`
- [X] T027 [US1] Synthetic H3M writer: header, players, all victory/loss kinds, teams, allowed masks, rumors, SoD hero settings, tiles, templates, events, per-version (RoE/AB/SoD) layouts, gzip, in `test/fixtures/synthetic/h3m.ts`
- [X] T028 [US1] Synthetic object body writers for every body family in data-model.md `ObjectBody` and every class in `src/core/data/object-classes.ts`, per version, in `test/fixtures/synthetic/h3m-objects.ts`

### Formats for US1

- [X] T029 [P] [US1] LOD reader (header, entry table, case-insensitive map, range reads, inflate with exact-size check, HotA-1.8 → UNSUPPORTED_VERSION) in `src/core/formats/lod/lod.ts`
- [X] T030 [P] [US1] DEF reader (header, palette, groups, `frameOrder` view-index space, lazy frame decode for compressions 0–3 into `Uint8Array`, quirk handling, frame cache by offset) in `src/core/formats/def/def.ts`
- [X] T031 [P] [US1] PCX reader in `src/core/formats/pcx/pcx.ts`
- [X] T032 [US1] H3M header section readers (version detection incl. HotA/other → UNSUPPORTED_VERSION with version code, info, players with verified AB/SoD hero block, victory/loss with `none` 0xFF and `defeatMonster`, teams, allowed heroes + AB placeholder hero ids, SoD custom heroes, artifacts/spells/skills masks, rumors, SoD hero settings) in `src/core/formats/h3m/header.ts`
- [X] T033 [US1] H3M tiles and templates readers (`MapTile` accessor over one `Uint8Array`, `ObjectTemplate`) in `src/core/formats/h3m/tiles.ts` and `src/core/formats/h3m/templates.ts`
- [X] T034 [P] [US1] Shared body pieces (army/creature stacks per version, artifacts slots, resources, messages with guards, primary/secondary skills, spells) in `src/core/formats/h3m/objects/common.ts`
- [X] T035 [P] [US1] Hero-like bodies (hero, random hero, prison, placeholder hero) in `src/core/formats/h3m/objects/hero.ts`
- [X] T036 [P] [US1] Town and random town bodies (buildings built/forbidden or hasFort, spells, town events with correct player masks, alignment) in `src/core/formats/h3m/objects/town.ts`
- [X] T037 [P] [US1] Monster, artifact, spell scroll, resource bodies in `src/core/formats/h3m/objects/pickups.ts`
- [X] T038 [P] [US1] Seer hut and quest guard (RoE artifact quest vs AB/SoD quest kinds, rewards) in `src/core/formats/h3m/objects/quest.ts`
- [X] T039 [P] [US1] Pandora box, event, sign/ocean bottle, garrison, grail, shrines, scholar, witch hut, owned objects (mines, dwellings, lighthouse, shipyard, abandoned mine), random dwellings 216–218 in `src/core/formats/h3m/objects/misc.ts`
- [X] T040 [US1] Exhaustive object dispatch (class id → body reader, `none` for body-less classes listed explicitly, unknown → UNSUPPORTED_OBJECT with object index/offset) in `src/core/formats/h3m/objects/index.ts`
- [X] T041 [US1] Top-level `parseH3m(bytes, fileName)` (gunzip if gzip magic, sections, global events, `expectEnd` → TRAILING_DATA) in `src/core/formats/h3m/h3m.ts`
- [X] T042 [P] [US1] Text table reader for `Objects.txt` (count line + one template per CRLF line: DEF name, 48-char passable and active masks, 9-char terrain and editor-group masks, class, subclass, group, overlay; typed rows) in `src/core/formats/text/objects-txt.ts` (research §9: `ObjTmplt.txt` is a stub and `CrTraits.txt` has no level column in the Complete install)

### Tests for US1

- [X] T043 [P] [US1] LOD tests (implemented together with T044/T045/T047 in `test/core/formats/lod-def-pcx.test.ts`) (synthetic: list, extract byte-exact, compressed, duplicates, truncated table offset in error, HotA rejection) in `test/core/formats/lod.test.ts`
- [X] T044 [P] [US1] DEF tests (synthetic: every compression, quirk, view-index order across groups, corrupted run → error with offset) in `test/core/formats/def.test.ts`
- [X] T045 [P] [US1] PCX tests in `test/core/formats/pcx.test.ts`
- [X] T046 [US1] H3M tests (synthetic round-trip of every section and every object body per version; truncation at several offsets yields FormatError with structure path; unknown class → UNSUPPORTED_OBJECT; trailing bytes → TRAILING_DATA) in `test/core/formats/h3m.test.ts`
- [X] T047 [P] [US1] Text table tests in `test/core/formats/text.test.ts`
- [X] T048 [US1] Real-file tests (skip when absent): all entries of `h3sprite.lod` extract and every DEF decodes (SC-001); `Arrogance.h3m` parses to exact end with recorded known values (version SoD, size 36, underground, object count, tile (10,12,0)) (SC-002); `По праву силы.h3m` → UNSUPPORTED_VERSION; `Objects.txt` parses from `h3bitmap.lod` in `test/real/formats.test.ts`
- [X] T049 [US1] Real corpus test: every `.h3m` in `<bundleDir>/Maps` parses (RoE/AB/SoD) or fails with UNSUPPORTED_VERSION (HotA); zero other errors (SC-002a) in `test/real/parse-all.test.ts`; fix parser defects it finds and record layout findings in research.md

### CLI for US1

- [X] T050 [US1] `yarn h3 lod list|extract` in `tools/inspect/lod.ts` per contracts/inspect-cli.md
- [X] T051 [P] [US1] `yarn h3 def dump|png|palette` (RGBA export: index 0 transparent, shadow indices as alpha per research §4) in `tools/inspect/def.ts`
- [X] T052 [P] [US1] `yarn h3 pcx dump|png` in `tools/inspect/pcx.ts`
- [X] T053 [US1] `yarn h3 map info|tiles|tile|objects|object|parse-all` (object bodies as JSON; `tile` footprint coverage added in T061) in `tools/inspect/map.ts`
- [X] T054 [US1] Inspect CLI entry and command registry in `tools/inspect/cli.ts`; CLI tests on synthetic files (JSON shape, exit codes, error JSON) in `test/tools/inspect.test.ts`

**Checkpoint**: quickstart §2 passes; `yarn verify layers` passes.

---

## Phase 4: User Story 2 — Agent gets floating tiles for a map (P1)

**Goal**: world state from H3M plus pixel-accurate footprints and floating tiles for `yarn ref selfcheck`.

**Depends on**: US1 (formats).

**Independent test**: quickstart §3 — floating tiles for Arrogance include
`20,24;21,24;20,25;21,25`; selfcheck with the generated list passes; map without random objects
returns an empty list.

- [X] T055 [P] [US2] `WorldState`, `WorldObject`, `HeroState`, `TownState` types and `fromH3m(map, identity)` (day 1, time 0, owners, visited/removed sets, seed) in `src/core/state/world.ts`
- [X] T056 [P] [US2] Simulation events (`advanceTime` implemented; reserved kinds typed but rejected with a clear error) and `applyEvent` with terrain buffer sharing in `src/core/sim/events.ts`
- [X] T057 [US2] Sprite footprint computation (union of non-transparent pixels over all frames of a DEF, anchored at bottom-right of the object tile, 32×32 bitsets per tile) in `src/core/state/footprint.ts`
- [X] T058 [US2] Random-object candidate resolution (implemented as `CandidateMasks` in `src/core/state/floating.ts`) (class rules from `src/core/data/object-classes.ts`; conservative candidates per research §9 from `Objects.txt` rows by outcome class: all monsters for any level, all dwellings, all towns, all heroes, all artifacts, all resources; generated starting heroes: for each player main town with `generateHero`, all hero-class map DEFs anchored at the town's entrance tile from its template active mask, for random towns at the entrance of every candidate town template — research §9) in `src/core/state/random-candidates.ts`
- [X] T059 [US2] `computeFloatingTiles(state, spriteLookup, tables)` → `FloatingTileSet` with `FloatingCause` (`randomObject` | `generatedHero`), `toTileList(z)` in item 1 format (single level), JSON form in `src/core/state/floating.ts`
- [X] T060 [P] [US2] Tests on synthetic data (footprint anchoring, 2×2 monster sprite, multi-frame union, generated hero at a main town with `generateHero` (and none without it), empty map → empty set, level separation, tile-list format accepted by the parser in `tools/reference-env/commands/selfcheck.ts`) in `test/core/state/floating.test.ts` and state/sim tests in `test/core/state/world.test.ts`
- [X] T061 [US2] `yarn h3 map floating` (`--level` default 0 for `list`, all levels for `json`; `--region`, `--format list|json` default `list`, `--sprites`, `--bitmaps`; per contracts/inspect-cli.md) and footprint coverage for `map tile` in `tools/inspect/map.ts`
- [X] T062 [US2] Real-file test (skip when absent): Arrogance level 0 floating tiles contain `20,24;21,24;20,25;21,25` (SC-003) in `test/real/floating.test.ts`
- [X] T063 [US2] Live integration (gated by `H3REF_LIVE=1`): run `yarn ref selfcheck --map Arrogance.h3m --runs 3 --samples 0 --floating-tiles <generated>` and assert ok in `test/real/floating-selfcheck.live.test.ts`; document the pipe in quickstart §3 if flags changed

**Checkpoint**: quickstart §3 passes.

---

## Phase 5: User Story 3 — Developer views an animated terrain map in the browser (P1)

**Goal**: screen-bound WebGL 1.0 terrain/river/road/border renderer, runtime (worker, cache,
scheduler) and dev harness.

**Depends on**: US1 (formats), US2 (world state T055–T056).

**Independent test**: quickstart §4 plus `yarn verify determinism` (SC-008) and `yarn h3 render`.

### Pure render logic

- [X] T064 [P] [US3] Atlas packing (frames of terrain/river/road/`edg.def` via `frameOrder`, frames placed at (x,y) inside 32×32, pages ≤ 2048², palette rows per DEF, CPU-side bytes retained) in `src/core/render/atlas.ts`
- [X] T065 [P] [US3] Camera/visible range math (CSS↔device pixels, DPR, +1 tile margin, outside-map range for border) in `src/core/render/camera.ts`
- [X] T066 [US3] SPIKE first (needs no renderer): record an item 1 clip with water and a river or lava in view; from `frames.json` and frame pixels measure (a) step duration per range, (b) whether all ranges step together with one global counter (research §5 phase model) — decode palette indices by matching the DEF palette colors on pixels of a known tile; update `src/core/data/palette-rotation.ts` and research.md. Then implement palette state (global `k` with joint period 24, or per-rotation steps, per the result; rotated palette rows; `nextChangeMs`; `allAnimationStates()` enumerator for fidelity) in `src/core/render/palette.ts`
- [X] T067 [US3] Draw plan (tile → quads per layer with flip bits, road vertical offset as a data-module constant defaulting to h3lwp's half tile down until T078's spike, border frame selection by seeded Rng or fixed rule, `animatedRows` in view, `animatedTileMask` per visible tile) in `src/core/render/draw-plan.ts`; SPIKE (needs only captures, record in research.md): border randomness from two map-edge still captures of different launches
- [X] T068 [P] [US3] Node tests: atlas placement, camera ranges at edges/corners/window larger than map, palette rotation direction and cycle lengths (12/8/6), draw plan flips/view indices/quad counts independent of map size in `test/core/render/plan.test.ts`

### GPU renderer

- [X] T069 [US3] WebGL 1.0 renderer: one program (index LUMINANCE atlas + RGBA 256×N palette texture, NEAREST, discard index 0 on river/road/border), dynamic vertex buffer rebuilt on tile-boundary crossing, translation uniform for sub-tile scroll, `texSubImage2D` palette row updates, counted GPU allocations, `RendererStats`, context loss/restore from retained CPU bytes, surface cap at display×DPR in `src/core/render/webgl-renderer.ts` and shaders in `src/core/render/shaders.ts`

### Runtime

- [X] T070 [P] [US3] Browser `File` ByteSource and `SourceIdentity` (map: SHA-256 of bytes; archive: SHA-256 of size, lastModified, header + entry table) in `src/runtime/file-source.ts`
- [X] T071 [P] [US3] IndexedDB cache (`h3dynam`, stores `atlas`/`world`, schema version, failures → warning + miss) in `src/runtime/cache.ts`
- [X] T072 [US3] Worker + typed protocol (`openArchive` → atlas from terrain/river/road/border DEFs; `openMap` → world state; errors as FormatError JSON; transferables) in `src/runtime/worker.ts` and `src/runtime/protocol.ts`
- [X] T073 [US3] Frame scheduler (render only on change or palette step for animated rows in view; zero rAF/timers while hidden or paused; resume recomputes from clock) in `src/runtime/scheduler.ts`
- [X] T074 [US3] `createEngine` facade per contracts/engine-api.md (load results, status/diagnostics, camera ops, visibility/pause, `?test=1` hook `window.__h3`, `renderRegion`) in `src/runtime/engine.ts`
- [X] T075 [P] [US3] Scheduler and cache-key unit tests with fake clock/timers in `test/runtime/scheduler.test.ts`

### Dev harness and render entry

- [X] T076 [US3] Dev harness page: file inputs (archive, map), full-window canvas, arrow keys/drag scroll, `U` level toggle, resize/DPR handling, `visibilitychange` → `setVisible`, non-intrusive diagnostics line in `src/adapters/dev-harness/index.html` and `src/adapters/dev-harness/main.ts`
- [X] T077 [US3] Check render page (single frame for given params, `window.__h3.renderRegion`) in `src/adapters/dev-harness/render.html` and `src/adapters/dev-harness/render.ts`
- [X] T078 [US3] `yarn h3 render` (headless Chromium via `tools/shared/browser.ts`, files served to page, PNG out, pixel mapping in output) in `tools/inspect/render.ts`; then SPIKE: render an Arrogance region containing roads with the road offset up and down, compare road pixels with a still capture of the same region, set the constant in the data module and record the result in research.md
- [X] T079 [US3] Synthetic terrain archive for browser tests (synthetic DEFs under real terrain/river/road/edg names, generated to a temp dir) in `test/fixtures/synthetic/terrain-archive.ts`
- [X] T080 [US3] `yarn verify determinism` (N fresh renders, byte compare, synthetic fallback) in `tools/checks/determinism.ts`
- [X] T081 [US3] Browser integration test (headless; synthetic archive + map): loads, presents frame, scroll/level change, hidden → no frames, bad map → error status and previous map kept, wrong slot (map given to `loadArchive`, archive given to `loadMap`) → clear diagnostic without crash, context loss via `WEBGL_lose_context.loseContext()`/`restoreContext()` → status `loading` then a frame pixel-identical to the one before loss, second load `fromCache: true` in `test/browser/engine.test.ts` (skips with reason when Chromium absent)

**Checkpoint**: quickstart §1 (`verify determinism`) and §4 pass.

---

## Phase 6: User Story 4 — Agent verifies terrain fidelity against the original game (P2)

**Goal**: `yarn verify fidelity` for stills and clips with masks and the `not-checkable` outcome.

**Depends on**: US2 (footprints, floating), US3 (render entry).

**Independent test**: quickstart §5 — pass on Arrogance stills, clip steps match, broken mirroring
fails with diff image, random-dominated region → `not-checkable`.

- [X] T082 [P] [US4] Capture loading: `findCaptures`/`tilePixel`/`cropForRegion` from `tools/reference-env/store/lookup.ts` and `analysis/geometry.ts`, still + volatile mask via `tools/shared/png.ts`, clip `frames.json` timeline in `tools/checks/fidelity/captures.ts`
- [X] T083 [P] [US4] Exclusion masks: outside viewport, volatile, object footprints (all non-random objects from parsed map), floating (random candidates and generated starting heroes from T059), border (if T067 found it random); volatile mask overridden (not applied) on pixels of tiles in the draw plan's `animatedTileMask` in `tools/checks/fidelity/masks.ts`
- [X] T084 [US4] Still comparison: render at capture mapping for every animation state from `allAnimationStates()` (T066), choose the state with fewest differing compared pixels, per-pixel classification, `comparedAnimated` count, per-tile counts, outcome order `skip` → `fail` (any differing) → `not-checkable` (compared < threshold from `src/core/data/thresholds.ts`, any cause, excluded share per cause) → `pass`, `randomCauses`, `visual-review.json` append in `tools/checks/fidelity/still.ts`
- [X] T085 [US4] Clip comparison: per distinct frame best animation state (T066 phase model) on animated tiles, state sequence advancing one step at a time in the table direction, measured vs expected step ms (SC-005) in `tools/checks/fidelity/clip.ts`
- [X] T086 [US4] Diff image + report writer validated against `specs/002-foundation-rewrite/contracts/report.schema.json#/$defs/fidelity`, output under `check-reports/fidelity/<timestamp>/` in `tools/checks/fidelity/report.ts`
- [X] T087 [US4] `verify fidelity` command (`--map --level --region --capture --kind --all-regions`, skip reasons, exit codes) in `tools/checks/fidelity/index.ts` registered in `tools/checks/cli.ts`
- [X] T088 [P] [US4] Unit tests with fabricated captures (synthetic render output as "capture", masks, outcome order and thresholds incl. not-checkable caused by objects only and by floating only, water tiles fully inside the volatile mask still compared (`comparedAnimated` > 0) and a wrong palette step on them → fail, generated-hero area excluded, deliberately flipped tile → fail with tile listed, clip step timing) in `test/tools/fidelity.test.ts`
- [X] T089 [US4] Real validation (manual-free, gated on captures present): capture with `yarn ref still/clip` at least 3 checkable regions (surface, underground, water, map edge; other install maps allowed) and one random-heavy region; run `verify fidelity`; fix renderer/data until SC-004/SC-005 pass; record regions, outcomes and any known deviations in research.md

**Checkpoint**: quickstart §5 passes.

---

## Phase 7: User Story 5 — Budget checks guard performance (P2)

**Goal**: `yarn verify budget` enforcing constitution budgets and SC-007 on a synthetic 252×252×2 map.

**Depends on**: US3.

**Independent test**: quickstart §6 — all budgets pass; negative control fails `surface`/`sc007-gpu-bytes`.

- [X] T090 [P] [US5] Synthetic stress map generator (252×252×2, varied terrain/rivers/roads/water, deterministic) in `test/fixtures/synthetic/stress-map.ts`
- [X] T091 [P] [US5] Runtime size measurement (gzip of JS reachable from runtime + worker entries, excluding harness UI code) in `tools/checks/budget/size.ts`
- [X] T092 [US5] Page metrics collector (CDP CPU throttling, `JSHeapUsedSize`, `RendererStats`, performance marks for cold/warm start, frame counting, hidden emulation and pending timer count via test hook) in `tools/checks/budget/metrics.ts`
- [X] T093 [US5] Budget evaluation (ids from contracts/checks-cli.md, SC-007 comparison 36×36 vs 252×252×2 with thresholds, largest install map when present) and report per `report.schema.json#/$defs/budget` in `tools/checks/budget/index.ts` registered in `tools/checks/cli.ts`
- [X] T094 [P] [US5] Unit tests for budget evaluation logic and size measurement on fixture bundles in `test/tools/budget.test.ts`
- [X] T095 [US5] Run `yarn verify budget` on real + synthetic maps; fix violations or propose a constitution amendment (never relax silently); record measured values in research.md (SC-006, SC-007, SC-009)

**Checkpoint**: quickstart §6 passes.

---

## Phase 8: User Story 6 — Contributors work on a clean layered codebase (P3)

**Goal**: layers enforced, docs and notices current, no leftovers.

**Depends on**: all previous phases for final docs.

**Independent test**: quickstart §7, `yarn verify layers` with a negative control, AGENTS.md
commands all run.

- [X] T096 [US6] `verify all` aggregate command (layers, determinism, budget, fidelity --all-regions) in `tools/checks/all.ts` registered in `tools/checks/cli.ts`
- [X] T097 [P] [US6] Hygiene test: no files under `public/dev-assets/`, `reference-captures/`, `check-reports/`, `context/` tracked; no `.lod/.def/.pcx/.h3m/.png` in git index outside allowed paths; `scripts/sync.js` absent in `test/tools/hygiene.test.ts`
- [X] T098 [US6] Rewrite AGENTS.md "Current State", commands (`yarn h3 …`, `yarn verify …`), stack, folder layout, WE notes (sync removed, adapters in item 3) per plan.md
- [X] T099 [P] [US6] Update TODO.md item 2 to done with a link to this spec, and the Housekeeping line about the Preact skill
- [X] T100 [P] [US6] Update `THIRD_PARTY_NOTICES.md` with every file that ports homm3-parser layouts

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T101 Run quickstart.md §1–§7 end to end; fix gaps
- [X] T102 Constitution compliance review: re-check plan.md Constitution Check against the implementation; record deviations/known deviations in plan.md and spec.md
- [X] T103 Update spec.md Status and research.md with final findings (open items table resolved); `git status` shows no game-derived files (SC-010)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → **US1 (3)** → **US2 (4)** → **US3 (5)** → {**US4 (6)**, **US5 (7)**} → **US6 (8)** → **Polish (9)**
- US4 and US5 are independent of each other and can run in parallel after US3.
- US3's pure render tasks (T064, T065, T068) only need US1; the runtime needs US2's state (T055, T056).

### Within stories

- Synthetic writers (T024–T028) before format tests (T043–T047); readers T029–T031 are independent.
- T032–T041 in order for the H3M top level; body modules T034–T039 in parallel after T011.
- T048/T049 after T041–T042; parser fixes they trigger stay inside US1.
- T057 → T058 → T059 → T061 → T062 → T063.
- T066/T067 spikes need only item 1 captures (run `yarn ref still/clip`); the road-offset spike
  is part of T078 because it needs the renderer.
- T069 before T072–T074; T076–T078 after T074; T080–T081 after T077/T079.

## Parallel Examples

```text
# Foundational
T008, T009, T010, T012, T014, T015, T016, T017, T018, T019, T020, T021, T022

# US1 after T027/T028
T029, T030, T031, T034, T035, T036, T037, T038, T039, T042
then T043, T044, T045, T047, T051, T052

# US2
T055, T056 (then T057…)

# US3
T064, T065, T070, T071, T075

# US4 + US5 together after US3
T082, T083, T088, T090, T091, T094
```

## Implementation Strategy

### MVP

1. Phases 1–2.
2. Phase 3 (US1): parsers + inspection CLIs — already useful to agents and removes the PoC's
   parsing failures. Stop and validate with quickstart §2.
3. Phase 4 (US2): floating tiles unblock item 1 selfchecks on random maps.

### Incremental delivery

4. Phase 5 (US3): visible terrain in the harness — replaces the PoC's purpose.
5. Phases 6–7 (US4, US5) in parallel: fidelity and budgets make the result provable.
6. Phases 8–9: docs, hygiene, compliance review, then merge into `testing`.

## Notes

- Commit after each task or logical group, only when the developer asks.
- Record every measured fact (palette timing, road offset, border randomness, parser layout
  findings, budget numbers, fidelity regions) in research.md.
- A task that reveals a constitution conflict stops and proposes an amendment instead of working
  around it.
