---

description: "Task list for map objects and animations"
---

# Tasks: Map Objects and Animations

**Input**: Design documents from `/specs/003-map-objects/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included — Constitution III and spec FR-014…FR-016 require automated checks for every
visible feature. Real-file tests resolve game files via `tools/shared/game-files.ts` and MUST skip
with a logged reason when absent; everything else uses synthetic fixtures.

**Organization**: by user story. Execution order differs from priority: **US3 (capture tooling, P2)
runs before US1/US2**, because the spikes of US1/US2 measure game facts on captures of
`test_map.h3m` that only the fixed tooling can take. US4 (inspection) is split: the draw list needed
by the spikes is built in US1; the rest is in US4.

**Conventions for every task**: strict TS, `erasableSyntaxOnly` (no enums/namespaces/parameter
properties; `as const` objects), `.ts` import extensions, `import type`; English code/comments;
logging only via `src/core/util/log.ts` (tools: their logger); no game files or anything derived
from them committed (captures, atlases, measured masks, PNGs). Game facts come from research.md;
h3lwp and VCMI are study-only. Every **SPIKE** task records date, capture ids, counts and the result
in research.md "Measurements" and in the named data module before dependent tasks start.
`test_map.h3m` zones and tile centres: spec.md Context and quickstart.md §2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US4 from spec.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: contract/schema wiring and fixtures every story uses.

- [X] T001 Point the fidelity report validation at `specs/003-map-objects/contracts/report.schema.json` (replace the 002 path) in `tools/checks/fidelity/index.ts` and in `test/tools/fidelity.test.ts`; confirm the 002 reports still validate (schema is additive)
- [X] T002 [P] Add a helper `requireTestMap()` returning the resolved path of `test_map.h3m` or `null` (and the expected sha256 from spec.md as a constant `TEST_MAP_SHA256`, logging a warning when the hash differs) in `tools/shared/game-files.ts`
- [X] T003 [P] Synthetic object DEF writer (static 1-frame and animated N-frame DEFs of sizes 32×32…192×192, pixels using indices 0 transparent, 1–4/6–7 shadow, 5 flag, other colours; deterministic from a seed) in `test/fixtures/synthetic/object-defs.ts`, reusing `test/fixtures/synthetic/def.ts`
- [X] T004 Extend the synthetic archive (`writeSyntheticFiles`) with the object DEFs from T003, a synthetic `Objects.txt` listing them (flat, visitable, ownable variants), a synthetic `PLAYERS.PAL` (generated colours, no game data) in a synthetic data archive, hero body/flag DEFs under the real names `ah00_.def`/`af00.def`…`af07.def`, and town DEFs under `AVCCAST0`/`AVCcasx0`/`AVCCASZ0` names in `test/fixtures/synthetic/terrain-archive.ts`
- [X] T005 Synthetic maps with objects: a repeating 19×17 object pattern (flat + standing overlaps, owned mine per player, a hero per player, a town, animated objects, one random monster, one event) written by `test/fixtures/synthetic/h3m.ts` into both the 36×36 map and the 252×252×2 stress map in `test/fixtures/synthetic/stress-map.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: data tables and state shared by US1, US2 and US4.

- [X] T006 [P] Add `HIDDEN_CLASSES` (event 26, grail 36) and `TOWN_SPRITES` (faction 0–8 → `{village, fort, capitol}` DEF names from research "Measured while planning", mapping marked "pending SPIKE T047") to `src/core/data/object-classes.ts`
- [X] T007 [P] Hero type → class table for types 0–155 (0–143 as 18 classes × 8; SoD special heroes 144–155 listed individually) and `HERO_DEFAULT_IDLE = {group: 2, mirror: false}` marked "pending SPIKE T047" in `src/core/data/heroes.ts`
- [X] T008 [P] Creature table (id → `{faction: 0–8 | 'neutral', level: 1–7, upgraded}` for base-game creature ids incl. Conflux and neutrals) in `src/core/data/creatures.ts`
- [X] T009 [P] Artifact classes: **deviation** — read at run time from the user's `ArtTraits.txt` (h3bitmap.lod, class column S/T/N/J/R, localization-independent) by `parseArtTraits` in `src/core/formats/text/artraits.ts` instead of a committed table (more reliable than a hand-written 144-entry table); `PLAYERS.PAL` reader `parseRiffPal` in `src/core/formats/pal/riff-pal.ts`
- [X] T010 [P] `PLAYER_FLAG_SHADES` (players 0–7 + neutral → source palette + index; **no RGB literals**, Principle I; provisional shade index, marked "pending SPIKE T045") and `flagColors(playersPal: Uint8Array): Uint8Array` (9 × RGB via `toDisplayColor`) in `src/core/data/players.ts`; `OBJECT_FRAME_MS = 180`, `OBJECT_PHASE_MODEL = 'global'` (marked "pending SPIKE T062") and `SHADOW_RULE` (index → alpha 1–2: 64, 3–4: 128, 6: 128, 7: 64, marked "pending SPIKE T046") in new `src/core/data/animation.ts`
- [X] T011 [P] Unit tests for the tables (hero classes cover all 156 types, every creature id 0–149 has a level, town sprites for 9 factions, hidden classes) in `test/core/data/tables.test.ts`
- [X] T012 Seeded random resolution `resolveRandomObjects(state, templates: ObjectsTxtRow[], rng)` per research §6 (monsters by level and banned creatures, artifacts by class and allowed list, resources, towns by owner's allowed factions, dwellings by linked town/faction/level, heroes by owner's allowed and unused types) returning `Map<ObjectId, RandomOutcome>` in `src/core/state/random.ts`
- [X] T013 `buildRenderObjects(state, templates, outcomes, rng)` → `RenderObject[]` per data-model.md (hidden classes skipped; heroes from `state.heroes` as body + flag entries using `heroes.ts`; **heroes the game generates at players' main towns** (`PlayerState.mainTown.generateHero`) added as body + flag entries at the town's entrance tile with a seeded hero class, `floating = true` (FR-005); heroes on water drawn with boat-hero sprites `ab01_.def`–`ab03_.def` + flag per research §5; towns choosing sprite via `TOWN_SPRITES` from `TownState.hasFort`/buildings; prisons by template; `flat` from `isOverlay`, `visitable` from the active mask, `floating` from random objects/generated heroes) in `src/core/state/render-objects.ts`
- [X] T014 Spatial index `ObjectIndex` (per level 8×8-tile buckets by anchor; `query(level, range, margin {left: 8, up: 6})`) in `src/core/state/object-index.ts`
- [X] T015 Tests: random resolution is deterministic per seed and respects constraints on the synthetic map; render objects skip hidden classes, yield body+flag per hero and a floating generated hero per main town with `generateHero`; index query returns exactly the objects whose sprite rectangle can intersect a range and touches only buckets near the range in `test/core/state/render-objects.test.ts`

**Checkpoint**: render objects and index exist in `core/state`, DOM-free (`yarn verify layers` passes).

---

## Phase 3: User Story 3 — Game stills on any base-game map, roads confirmed (Priority: P2, runs first)

**Goal**: captures of top-edge views, the underground of non-red-player maps and `Merchant Princes.h3m`
succeed and carry a verified mapping; captures of all `test_map.h3m` zones exist; roads, mud/lava
rivers and map corners are confirmed by game stills.

**Independent Test**: the three commands of quickstart §1 succeed with a `verification` block; forced
wrong cases fail with specific codes and store nothing; terrain-only fidelity of the `test_map.h3m`
road/river/corner stills passes (objects excluded).

### Tests for User Story 3

- [X] T016 [P] [US3] Level detection tests on synthetic minimap images generated from two synthetic terrain grids (agreement per level, margin rule, `LEVEL_UNKNOWN` on ambiguous/shrouded input, independence from interface colour) in `test/reference-env/level-detect.test.ts`
- [X] T017 [P] [US3] Mapping verification tests: a synthetic capture rendered with the software rasterizer at a known mapping is accepted; the same capture shifted by one tile in each of 8 directions is rejected with `bestShift` reported; thresholds from plan.md in `test/reference-env/mapping-verify.test.ts`
- [X] T018 [P] [US3] Rectangle guard tests (expected 19×17-tile size in minimap px at scales 1–4, clipped edges must touch the minimap border, the a869065 misread case reproduced from its numbers is rejected) in `test/reference-env/register.test.ts`

### Implementation for User Story 3

- [X] T019 [US3] Prune the three stale misaligned Arrogance stills (ids with `_x1-19_y0-16` recorded by commit a869065, see research §10) with `yarn ref prune --id …` (local data only, nothing to commit); note the ids in research.md
- [X] T020 [US3] Add error codes `LEVEL_UNKNOWN`, `LEVEL_MISMATCH`, `MAPPING_UNVERIFIED` to `tools/reference-env/errors.ts` and the `verification` record block (data-model.md) with validation of optional presence to `tools/reference-env/model/types.ts` and `tools/reference-env/model/validate-record.ts`
- [X] T021 [US3] Rectangle size guard after reading the view (every drawn edge pair must span the expected tiles × minimap scale; clipped edges must lie on the minimap border; else `POSITION_MISMATCH` with the rect in details) in `tools/reference-env/analysis/minimap.ts` and its use in `positionView` in `tools/reference-env/env/session.ts`
- [X] T022 [US3] `detectLevel(minimapRgba, scale, terrainLevels)` (quantise minimap to one cell per tile, score "same colour ⇔ same terrain" agreement over horizontal/vertical neighbours per level, return `{level, agreement[], margin}` or `LEVEL_UNKNOWN` below margin 0.1) in `tools/reference-env/analysis/level-detect.ts`
- [X] T023 [US3] Replace the level-button hash probe in `showLevel`/`currentLevel` with `detectLevel` (parse the staged map's tiles via `src/core/formats/h3m/h3m.ts`; after reveal and after each toggle; verify the requested level before grabbing, `LEVEL_MISMATCH` otherwise; record `verification.level`) in `tools/reference-env/env/session.ts`; remove the `levelSurface` probe from `tools/reference-env/commands/calibrate.ts` and `tools/reference-env/env/calibration.ts`
- [X] T024 [US3] `--debug-steps` flag for `still`/`clip`: save a viewport+minimap screenshot after every session step (intro dismissal, each reveal attempt, level switch, positioning) to the failures folder with step names in `tools/reference-env/commands/common.ts` and `tools/reference-env/env/session.ts`
- [X] T025 [US3] SPIKE: run `yarn ref still --map "Merchant Princes.h3m" --level 0 --x 20 --y 20 --debug-steps`; find why the first reveal code has no effect (research §11 hypotheses: undetected intro dialog, key timing); record the cause in research.md §11 and Measurements
- [X] T026 [US3] Reveal fix per T025 (baseline plan: before typing, press Return until a colour-independent adventure-map probe shows no modal — a minimap click changes the viewport; verify the reveal after each attempt; retry the working code `nwcwhatisthematrix` up to 3 times before trying other codes) in `tools/reference-env/env/session.ts` and `tools/reference-env/data/settings-profile.ts`
- [X] T027 [US3] `verifyMapping(captureRgba, record, map, terrainAtlas)` (terrain-only software render via `src/core/render/draw-plan.ts` + `src/core/render/software.ts` at the recorded mapping and its 8 one-tile shifts over non-animated terrain pixels outside object footprints and UI corners; best palette step not needed for non-animated pixels; returns `{differingRecorded, bestShift}`) in `tools/reference-env/analysis/mapping-verify.ts`
- [X] T028 [US3] Call `verifyMapping` after grabbing — stills on the first grab, **clips on the first frame** (FR-019) — (requires `h3sprite.lod` from the bundle; fail with `MAPPING_UNVERIFIED` + failure screenshot per plan.md thresholds and store nothing; write `verification.mapping`, `verification.minimapRect`, `verification.level`) in `tools/reference-env/commands/still.ts`, `tools/reference-env/commands/clip.ts` and `tools/reference-env/commands/session.ts`
- [X] T029 [US3] `calibrate`: add a minimap edge-detection check at scale 1 on `test_map.h3m` when present (position at a top-edge and a mid-map view, read back origins) in `tools/reference-env/commands/calibrate.ts`
- [X] T030 [US3] `find`/`list` output `mapSha256Matches`; `doctor` reports captures whose map hash no longer matches the file in `tools/reference-env/commands/find.ts`, `tools/reference-env/commands/list.ts`, `tools/reference-env/commands/doctor.ts`, `tools/reference-env/store/lookup.ts`
- [X] T031 [US3] Fidelity capture selection filters by the current map sha256 (newest matching capture per view), reports other-hash captures once as `skip`/`map-changed` (not `no-game-files`), attempts `capture-misaligned` only for records without `verification`, and adds the `--exclude-objects` flag (masks object footprints, the current behaviour; becomes opt-in when T051 lands) in `tools/checks/fidelity/captures.ts` and `tools/checks/fidelity/index.ts`; extend `test/tools/fidelity.test.ts` for these cases
- [X] T032 [US3] Update `yarn ref` tests for the removed probe, new codes and `verification` block in `test/reference-env/capture.test.ts` and `test/reference-env/foundation.test.ts`; gate new live assertions behind `H3REF_LIVE=1` in `test/reference-env/live.test.ts` (Shadow Valleys level 1, Merchant Princes, Arrogance top edge)
- [X] T033 [US3] Live run of quickstart §1 (Arrogance top edge `--x 10 --y 7`, `Shadow Valleys.h3m` level 1 and level 0, `Merchant Princes.h3m`); fix until all succeed; record results in research.md Measurements (SC-003)
- [X] T034 [US3] Capture all `test_map.h3m` zones of quickstart §2 (9 stills, 2 clips) with the fixed tooling; list capture ids in research.md Measurements
- [X] T035 [US3] Terrain-only confirmation: `yarn verify fidelity --map test_map.h3m --all-regions --exclude-objects` and the same for the `Merchant Princes.h3m`/`Shadow Valleys.h3m` stills; fix road offset, mud/lava river ranges or border corner frames in `src/core/data/terrain.ts`, `src/core/data/palette-rotation.ts`, `src/core/render/draw-plan.ts` if they differ; record in research.md (FR-020, SC-004)

**Checkpoint**: captures of every `test_map.h3m` zone exist with verified mapping; terrain facts from spec 002 are confirmed or corrected.

---

## Phase 4: User Story 1 — Objects appear on the map as in the original game (Priority: P1) 🎯 MVP

**Goal**: every visible non-hidden object, hero and town drawn in the original order with flag colours
and shadows; static frames compared against game stills.

**Independent Test**: `yarn verify fidelity --map test_map.h3m --all-regions` passes on still views of
the town, hero and dense zones with `pixels.comparedObject > 0` (animation searched per DEF, see US2
for clips); `Arrogance.h3m` stills still pass.

### Tests for User Story 1

- [X] T036 [P] [US1] Object atlas tests: deterministic packing (same input → same layout bytes), frames sharing a data offset share a cell, cropped cells at correct x/y, page overflow → `RangeError` with sizes, `objectAtlasGpuBytes` formula in `test/core/render/object-atlas.test.ts`
- [X] T037 [P] [US1] Object order tests: comparator keys of research §4 in order, total order (antisymmetric, transitive on random samples), heroes after the town they stand in in `test/core/render/object-order.test.ts`
- [X] T038 [P] [US1] Object plan tests: quads at `(x+1)·32 − fullWidth + cell.x`, mirroring, page runs contiguous per page in draw order, objects anchored outside the range but reaching into it included, quad count and plan cost independent of map size (36×36 vs 252×252 synthetic, same view) in `test/core/render/object-plan.test.ts`
- [X] T039 [P] [US1] Software rasterizer tests with objects: variable-size quads, index 5 → owner colour, shadow indices per `SHADOW_RULE` with 16-bit quantisation, per-pixel owner ids for the state search in `test/core/render/software-objects.test.ts`
- [X] T040 [P] [US1] Browser test: WebGL frame with objects equals the software rasterizer bit for bit on the synthetic map at several views and ticks; `missing-sprite` diagnostic when a DEF is removed from the archive and the rest renders in `test/browser/engine.test.ts`

### Implementation for User Story 1

- [X] T041 [US1] Object atlas `buildObjectAtlas(defs: DefSprite[])` (DEFs sorted by name, frames in file order deduped by data offset, cropped, shelf packing into 2048² pages, `MAX_OBJECT_PAGES = 8`, palette row per DEF via `toDisplayColor`, index 0 alpha 0 and shadow indices alpha per `SHADOW_RULE`) in `src/core/render/object-atlas.ts`
- [X] T042 [US1] Object order comparator per research §4 in `src/core/render/object-order.ts`
- [X] T043 [US1] `buildObjectPlan(renderObjects, index, atlasLayout, level, range, tick, withDrawList)` → `ObjectPlan` per data-model.md (6-float vertices incl. owner, page runs, `animatedInView`, optional `DrawListEntry[]`) in `src/core/render/object-plan.ts`; `frameOf(sprite, group, tick)` and `AnimationState` in `src/core/render/animation.ts`
- [X] T044 [US1] Software rasterizer support: arbitrary quad sizes from vertices, object pass after terrain layers and before border, flag colour from the 9 colours of `flagColors(PLAYERS.PAL)`, exact shadow formula from `SHADOW_RULE`, `rasterizeOwners` returning per-pixel topmost render-object index in `src/core/render/software.ts`
- [X] T045 [US1] SPIKE flag colours: from the stills of the town zone (`--x 20 --y 81`) and heroes zone (`--x 57 --y 65`), collect capture colours at pixels where the drawn sprite has index 5, per owner (incl. neutral); find the matching entry in the user's `PLAYERS.PAL` (then other game palettes, research §3); set **only shade indices / source** in `PLAYER_FLAG_SHADES` in `src/core/data/players.ts` — never RGB values; record the rule (not the colours) in research.md
- [X] T046 [US1] SPIKE shadow formula: from dense-zone stills, collect (terrain colour without shadow, captured colour under shadow) pairs per shadow index; derive the exact 16-bit formula; decide option 1 or 2 of research §3; set `SHADOW_RULE` in `src/core/data/animation.ts`; unit-test the formula over all 32/64/32 levels in `test/core/render/software-objects.test.ts`; record in research.md
- [X] T047 [US1] SPIKE sprites and order: on the town, heroes and dense-zone stills determine town sprite by fort state, unmoved hero idle group/mirror, and the draw-order keys (differing pixels grouped by overlapping object pair from the draw list); look for an install map with a hero starting on water (`yarn h3 map objects` over `<bundleDir>/Maps`) and, if found, capture it to confirm the boat-hero sprite and flag; update `TOWN_SPRITES` in `src/core/data/object-classes.ts`, `HERO_DEFAULT_IDLE` in `src/core/data/heroes.ts`, comparator in `src/core/render/object-order.ts`; record counter-examples (or the boat gap) in research.md
- [X] T048 [US1] Object shader program (vertex: position, uv, paletteRow, owner; fragment: index lookup, index 5 → owner colour from a 9-colour uniform array, shadow indices per `SHADOW_RULE`, discard alpha 0) in `src/core/render/shaders.ts`; if T046 chose option 2, the offscreen surface-sized framebuffer and resolve pass as well
- [X] T049 [US1] Renderer object pass: object atlas pages as LUMINANCE textures + palette texture, `setObjects(renderObjects, index, atlas)`, plan rebuild on level/range change, one draw call per page run, blending per T046, GPU byte accounting, stats `objectQuads/objectPages/objectDrawCalls/objectPlanBuilds`, context restore from retained CPU bytes, `setObjectsVisible` in `src/core/render/webgl-renderer.ts`
- [X] T050 [US1] Worker and runtime: `engine.loadDataArchive(h3bitmap.lod)` supplying `Objects.txt` and `PLAYERS.PAL`, **required for objects** — without it only terrain is drawn and one `data-archive-missing` diagnostic is emitted; build render objects (T012–T013) and the object atlas once sprite archive, data archive and map are loaded; `mapReady` gains `objectAtlas` (transferred), `renderObjects` and the 9 flag colours; IndexedDB store `objectAtlas` keyed `objectAtlas:<schema>:<archiveId>:<dataArchiveId>:<mapId>:<seed>`, `CACHE_SCHEMA` bump; engine options `seed`, `objects`; `missing-sprite` and `object-atlas-overflow` diagnostics in `src/runtime/decode.ts`, `src/runtime/worker.ts`, `src/runtime/protocol.ts`, `src/runtime/cache.ts`, `src/runtime/cache-key.ts`, `src/runtime/engine.ts`
- [X] T051 [US1] Fidelity with objects: map context builds render objects with the report seed; software state search renders objects; pixel class `object` only with `--exclude-objects`; pixels covered by drawn objects count into `pixels.comparedObject`; floating/UI exclusions unchanged in `tools/checks/fidelity/masks.ts`, `tools/checks/fidelity/run.ts`, `tools/checks/fidelity/compare.ts`, `tools/checks/fidelity/index.ts`
- [X] T052 [US1] Render page and harness: `RenderParams` gain `dataArchiveUrl`, `seed`, `tick`, `objects`, `objectFrames`, `drawList`; harness gets a third file input for `h3bitmap.lod`, key `O` toggles objects, diagnostics (`missing-sprite`, `data-archive-missing`) shown in `src/adapters/dev-harness/render.ts`, `src/adapters/dev-harness/main.ts`, `src/adapters/dev-harness/index.html`; `HeadlessRenderer.render` serves `h3bitmap.lod` from the bundle and passes the new params in `tools/shared/render-page.ts`; `yarn h3 render`, determinism and fidelity resolve `h3bitmap.lod` via `tools/shared/game-files.ts`
- [X] T053 [US1] `yarn h3 map draw-list` per contracts/inspect-cli.md and `yarn h3 render` flags `--tick`, `--seed`, `--no-objects`, `--draw-list` in `tools/inspect/map.ts`, `tools/inspect/render.ts`, `tools/inspect/cli.ts`
- [X] T054 [US1] Real-file test: render objects of every install map (parse, resolve, build render objects and object atlas in Node, plan every 19×17 view on both levels) without errors; missing sprites reported, not thrown (SC-007) in `test/real/objects-all-maps.test.ts`
- [X] T055 [US1] Real validation: `yarn verify fidelity --map test_map.h3m --all-regions` and `--map Arrogance.h3m --all-regions`; fix data/order/shadows until the static zones pass (objects compared, animated DEFs searched per T061 once US2 lands — until then record which views differ only on animated sprites); confirm on the two map-corner stills that sprites reaching past the map edge are covered by the border as in the game; record outcomes in research.md (SC-001)

**Checkpoint**: MVP — objects visible in the harness and compared in fidelity.

---

## Phase 5: User Story 2 — Objects animate at the original game's timing (Priority: P1)

**Goal**: object frames cycle in the original order and speed, in lock with palette animation; frames
produced only at visible changes.

**Independent Test**: the two `test_map.h3m` clips pass (`clip.objectStepMsMeasured` within one grab
interval, all steps in order); stills with animated objects pass with `tickConsistent`; idle cadence
budget passes.

### Tests for User Story 2

- [X] T056 [P] [US2] `nextChangeMs` tests (palette only, objects only, both, nothing animated → null; different phase models) in `test/core/render/animation.test.ts`
- [X] T057 [P] [US2] Scheduler tests: wakes at `nextChangeMs`, no timers when nothing animates, none while hidden/paused, resumes at current time in `test/runtime/scheduler.test.ts`
- [X] T058 [P] [US2] Fidelity state search tests on synthetic captures rendered at known (palette step, per-DEF frames), including one sprite a tick behind and overlapping animated objects: recovers frames, `tickConsistent` true; a wrong frame order in a synthetic clip fails in `test/tools/fidelity.test.ts`

### Implementation for User Story 2

- [X] T059 [US2] `nextChangeMs(timeMs, {animatedRows, animatedObjects})` per the phase model in `src/core/render/animation.ts`; renderer rebuilds only UVs of the object plan on tick change while `animatedInView` and exposes `nextChangeMs` and `animatedObjectsInView` in `src/core/render/webgl-renderer.ts`
- [X] T060 [US2] Scheduler uses the renderer's `nextChangeMs` instead of the fixed palette step in `src/runtime/scheduler.ts`; engine `stats()` adds `nextChangeMs` in `src/runtime/engine.ts`
- [X] T061 [US2] Fidelity: still search — palette step first, then per animated DEF frame by coordinate descent (two passes, draw order) using `rasterizeOwners`; animated-object pixels override the volatile mask; report `objectFramesByDef`, `tickConsistent`; clip — per distinct frame the tick and DEF frames must advance in order, `clip.objectSteps`, `clip.objectStepMsMeasured`/`Expected` in `tools/checks/fidelity/run.ts` and `tools/checks/fidelity/compare.ts`
- [X] T062 [US2] SPIKE animation timing on the clips `--x 66 --y 59` and `--x 57 --y 65`: median interval between object frame changes, whether all DEFs and instances change on the same grab as the palette step, frame order (file order / reversed / ping-pong), hero flag timing; set `OBJECT_FRAME_MS`, `OBJECT_PHASE_MODEL` (and a phase rule if not global) in `src/core/data/animation.ts`; record in research.md §7 and Measurements
- [X] T063 [US2] Real validation: `yarn verify fidelity --map test_map.h3m --all-regions` (stills and clips) and `Arrogance.h3m`; fix until SC-001 and SC-002 hold; record in research.md

**Checkpoint**: animated map matches game clips; frames only at changes.

---

## Phase 6: User Story 4 — Agent inspects objects and their drawing (Priority: P3)

**Goal**: remaining inspection commands per contracts/inspect-cli.md.

**Independent Test**: CLI tests on the synthetic map produce the documented JSON; on `test_map.h3m`
the draw list of the town zone matches parsed objects (real-file test, skips without files).

- [X] T064 [P] [US4] `yarn h3 map random MAP [--seed S] [--level Z]` in `tools/inspect/map.ts` and `tools/inspect/cli.ts`
- [X] T065 [P] [US4] `map objects` adds `hidden` and `render {def, group, flat, visitable}` (with `--seed`); `def dump` adds `specialIndices.flag` and `sharedWith` per frame in `tools/inspect/map.ts` and `tools/inspect/def.ts`
- [X] T066 [US4] CLI tests for `map draw-list`, `map random`, `map objects` render fields, `render --tick/--no-objects/--draw-list` on synthetic files (JSON shape, exit codes, draw order, objects reaching into the region, hidden list) in `test/tools/inspect.test.ts`
- [X] T067 [US4] Real-file test: draw list of `test_map.h3m` region `7,65,25,81` lists 18 town entries with owners matching the parsed map and no event/grail entries in `test/real/objects-all-maps.test.ts`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T068 [P] Budgets: add `object-atlas-bytes` (≤ 64 MB) and `sc007-object-quads`; include object draw calls in `sc007-draw-calls`; the `idle-cadence` limit counts the visible-change times from `nextChangeMs` over the idle window instead of `PALETTE_STEP_MS`; default maps add `test_map.h3m`; synthetic maps carry objects (T005) and the data archive in `tools/checks/budget/index.ts`, `tools/checks/budget/metrics.ts`, `tools/checks/budget/evaluate.ts`; update `test/tools/budget.test.ts`
- [X] T069 [P] Determinism default target `test_map.h3m` level 0 region `57,51,75,67`, tick 5, seed 1, synthetic map with objects as fallback in `tools/checks/determinism.ts`
- [X] T070 Run `yarn verify budget` and `yarn verify determinism --runs 10`; fix until all pass; record the budget table in research.md (SC-005, SC-006)
- [X] T071 [P] Hygiene: extend `test/tools/hygiene.test.ts` so no `*.h3m`, captures, atlases or PNG derived from game files are tracked; `git status` clean of game data (SC-008)
- [X] T072 [P] Update AGENTS.md: Current State (objects drawn, capture tooling verification), facts (flag colours, shadow rule, draw order, animation timing, town/hero sprites), new commands (`map draw-list`, `map random`, render flags, `--debug-steps`, `--exclude-objects`), known defects list refreshed in `AGENTS.md`
- [X] T073 [P] Update TODO.md (item 3.1 done, housekeeping entry for capture tooling resolved or remaining defects) in `TODO.md`
- [X] T074 `yarn verify all`, `yarn test`, `yarn build`; fix failures
- [X] T075 Constitution compliance review: add "Compliance Review" (principle table, deviations, known gaps) to `specs/003-map-objects/plan.md`; set spec Status and fill research.md Measurements completely in `specs/003-map-objects/spec.md` and `specs/003-map-objects/research.md`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → stories.
- **US3 (Phase 3)**: depends on Setup only (T001, T002); T027 uses existing terrain rendering. Runs
  **first**: T034 captures are prerequisites of the SPIKE tasks T045–T047 and T062.
- **US1 (Phase 4)**: depends on Foundational and on US3 T034 for spikes and real validation; code
  tasks T036–T044, T048–T054 can start in parallel with US3.
- **US2 (Phase 5)**: depends on US1 T043, T044, T049, T051; T062 needs the clips from T034.
- **US4 (Phase 6)**: depends on US1 T053 (draw list) and Foundational T012–T013.
- **Polish (Phase 7)**: after the stories.

### Within stories

- US3: T020 → T021/T022 → T023; T024 → T025 → T026; T027 → T028; T019, T029–T031 independent;
  T033 after T021–T028; T034 after T033; T035 after T034.
- US1: T041, T042, T043 → T044 → T045–T047 (need T034) → T048 → T049 → T050 → T051–T053 → T054, T055.
  Spikes T045–T047 can run on the software rasterizer (T044) before the GPU path exists.
- US2: T059 → T060; T061 → T062 → T063.

### Parallel opportunities

- Setup: T002, T003 in parallel; T004 after T003; T005 after T004.
- Foundational: T006–T011 all in parallel; T012–T014 sequential in `core/state` (T013 uses T012), T015 (no [P]) after them.
- US3 tests T016–T018 in parallel; T022 and T027 in parallel (different files); T029, T030, T031 in parallel.
- US1 tests T036–T040 in parallel; T041 and T042 in parallel.
- US2 tests T056–T058 in parallel.
- US4 T064, T065 in parallel.
- Polish T068, T069, T071, T072, T073 in parallel.

## Parallel Example: User Story 1

```text
Task: "T036 Object atlas tests in test/core/render/object-atlas.test.ts"
Task: "T037 Object order tests in test/core/render/object-order.test.ts"
Task: "T038 Object plan tests in test/core/render/object-plan.test.ts"
Task: "T039 Software rasterizer object tests in test/core/render/software-objects.test.ts"
Task: "T041 Object atlas in src/core/render/object-atlas.ts"
Task: "T042 Object order comparator in src/core/render/object-order.ts"
```

## Parallel Example: User Story 3

```text
Task: "T016 Level detection tests in test/reference-env/level-detect.test.ts"
Task: "T017 Mapping verification tests in test/reference-env/mapping-verify.test.ts"
Task: "T022 detectLevel in tools/reference-env/analysis/level-detect.ts"
Task: "T027 verifyMapping in tools/reference-env/analysis/mapping-verify.ts"
```

## Implementation Strategy

### MVP

1. Phase 1 + Phase 2.
2. Phase 3 (US3) through T034 — captures of `test_map.h3m` exist and are verified.
3. Phase 4 (US1) — objects drawn and compared on static zones. **Stop and validate** (quickstart §4
   harness + fidelity on the town/heroes/dense stills).

### Incremental delivery

1. MVP (static objects, verified captures).
2. US3 T035 — terrain facts confirmed (roads, rivers, corners).
3. US2 — animation timing and clip checks.
4. US4 — remaining inspection commands.
5. Polish — budgets, determinism, docs, compliance review; then commit and merge into `testing`
   when the user asks.
