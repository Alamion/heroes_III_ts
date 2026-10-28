---

description: "Task list for Busy random places"
---

# Tasks: Busy random places

**Input**: Design documents from `/specs/009-view-quality/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included. Constitution III and spec FR-008 require headless checks that run on Linux
without a human, so test and check tasks are part of the feature.

**Threshold**: `BUSY_COVERAGE = 0.15` (the owner's decision, 2026-10-28; research R3). Only solid black
underground rock must be avoided. Sea, coast and sparse plains are fine.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[Story]**: the user story the task serves (US1–US3).

## Path Conventions

Single project at the repository root (`src/core`, `src/runtime`, `tools/`, `test/`). Layers import
only downwards (`yarn verify layers`): `core/state` must not import `core/render`.

---

## Phase 1: Setup

**Purpose**: a synthetic world builder that every later test uses. It contains no game content
(constitution I).

- [X] T001 [P] Create test/fixtures/synthetic/coverage-world.ts.
  - Export `coverageWorld({ size, levels, objects })`. It returns a
    `Pick<WorldState, 'size' | 'levels' | 'objects'>` whose `objects` is a `Map<ObjectId, WorldObject>`
    built from compact specs `{ x, y, z, classId?, passable?, active? }`.
  - Defaults: class 0x3f (an ordinary decoration); `passable` a 6-byte mask with only the anchor tile
    blocked (bit 7 of byte 5 clear, every other bit set); `active` all zero.
  - Export `fillRect(z, x0, y0, x1, y1, step = 1)`, which yields one 1-tile blocked object per tile of
    the rectangle (every `step` tiles). Tests use it for "busy island" and "empty underground" layouts.
  - Export `withHidden(...)`, which adds objects of `HIDDEN_CLASSES` (events, grail) that must not
    count.
  - Templates follow the layout in src/core/formats/h3m/types.ts `ObjectTemplate`: bit 7 is the
    object's column, byte 5 its row, and a set bit means passable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the coverage grid. Every story scores candidates with it.

**⚠️ CRITICAL**: no user-story work begins before this phase is complete.

- [X] T002 Create src/core/state/coverage.ts per contracts/placement.md and data-model.md
  "CoverageGrid":
  - `interface CoverageGrid { size; levels; sums: Uint32Array }`.
  - `coverageGrid(world: Pick<WorldState, 'size' | 'levels' | 'objects'>)`: one pass over
    `world.objects`. Skip `HIDDEN_CLASSES` from src/core/data/object-classes.ts. Each object marks, on
    its own `z`, every tile of its 8×6 template window (`maskOffsets` from
    src/core/formats/h3m/types.ts gives dx = bit − 7, dy = row − 5) that is blocked (passable bit clear)
    or visitable (active bit set). Tiles off the map are dropped. Then build a summed-area table of
    `levels × (size + 1)²`.
  - `coveredTiles(grid, z, x0, y0, x1, y1)`: inclusive tile rectangle, clamped to the map; 0 when the
    rectangle lies wholly off the map.
  - `viewCoverage(grid, view)`, where `view` is a structural type
    `{ level; offsetX; offsetY; width; height; scale }` declared locally; do not import
    `core/render/camera.ts`.
    - The tile range is `floor(offsetX / TILE_SIZE) … floor((offsetX + width / scale − 1) / TILE_SIZE)`,
      and likewise for y. `TILE_SIZE` comes from src/core/data/terrain.ts.
    - The result is covered tiles / (min(cols, size) × min(rows, size)), clamped to 0..1 (research R2).
  - Header comment: one paragraph citing spec 009 and research R2. Mention that h3lwp is the idea's
    source (GPL-3.0, study only).
- [X] T003 [P] Create test/core/state/coverage.test.ts using T001:
  - exact `coveredTiles` for known rectangles, including the clamping at the map edges;
  - a multi-tile template marks exactly its blocked and active tiles, and passable-only tiles do not
    count;
  - hidden classes do not count;
  - objects on level 1 do not touch level 0;
  - `viewCoverage` of a view half past the map edge counts the off-map half as uncovered;
  - on a map smaller than the view, the denominator is the map's size, so a fully covered 36×36 map
    under a 60×34-tile view gives coverage 1 (research R2);
  - `size`/`levels` 1 and 2.

**Checkpoint**: the grid is correct and tested in Node.

---

## Phase 3: User Story 1 - A random place shows the map, not emptiness (Priority: P1) 🎯 MVP

**Goal**: a random placement with a coverage grid picks the first candidate that reaches
`BUSY_COVERAGE`, or the best one if none does. Candidate 0 is today's place.

**Independent Test**: unit tests on synthetic worlds, plus `yarn verify places` on the real maps. The
share of draws below 0.15 drops to at most a quarter of today's, and no draw is worse than its
candidate 0.

### Implementation for User Story 1

- [X] T004 [US1] Extend src/core/render/view-placement.ts per contracts/placement.md:
  - Export `BUSY_COVERAGE = 0.15` and `CANDIDATES_PER_LEVEL = 10`.
  - Add `coverage?: CoverageGrid` to `PlacementInput`, and `choice?: PlaceChoice` to `PlacementResult`
    (`PlaceChoice { candidates: readonly Candidate[]; chosen: number; reached: boolean }`,
    `Candidate { level; fx; fy; coverage }`).
  - Refactor the camera computation from fractions into a local helper, so that candidates and the
    existing modes share it.
  - With `placement.mode === 'random'` and `coverage` given, run data-model.md "Choice":
    - `rng = createRng(placement.seed)`, and `drawn` is today's level pick;
    - candidates come in (fx, fy) pairs from that one stream;
    - stop at the first candidate with coverage ≥ `BUSY_COVERAGE`, otherwise take the max, with ties
      to the earlier candidate.
  - In this story, every candidate is on `drawn`. The other level is T010 (US2).
  - Without `coverage`, or with another mode, the output must stay identical to today's field for
    field, with no `choice` key.
  - Header comment: update the module comment to mention spec 009.
- [X] T005 [P] [US1] Add a `describe('busy random places (spec 009)')` block to
  test/core/render/view-placement.test.ts, using T001 worlds:
  - **Candidate 0**: candidate 0's `fx`/`fy`/level equal today's random result for the same seed.
    Compare with a call without `coverage`.
  - **Island**: a 144×144 one-level map with one busy 30×20 island and nothing else. Over 50 seeds
    the chosen view has coverage ≥ `BUSY_COVERAGE` whenever any candidate has it, and is never below
    candidate 0 (SC-001).
  - **Empty map**: `reached: false`, and the best candidate is chosen with ties to the earlier one;
    no throw.
  - **Fully busy map**: candidate 0 is accepted at once (`candidates.length === 1`).
  - **Determinism**: same input, same output (SC-004).
  - **Untouched modes**: `coords` and `centre` placements give the same output with and without
    `coverage` (FR-007).
  - **Small map**: on a 36×36 map under a 1920×1080 view, all candidates of a level share one camera.
- [X] T006 [US1] Wire the grid into src/runtime/engine.ts per contracts/placement.md "Engine":
  - Add a module-level `WeakMap<ReadonlyMap<ObjectId, WorldObject>, CoverageGrid>` keyed by
    `world.objects`, with a `coverageFor(world)` helper (research R5: `applyEvent` replaces the
    `WorldState` but keeps `objects`).
  - In `placeView(level, placement)`, pass `coverage: coverageFor(world)` only when
    `placement.mode === 'random'`.
  - When `r.choice?.reached === false`, log once at debug level through the project logger, with code
    `PLACE_SPARSE` and `{ map: world.map.name, best, candidates }`. No user message (FR-010).
  - The return value stays `{ level, fx, fy }`.
  - Check that `showPreparedMap` goes through the same `placeView` path, so a folder rotation also gets
    busy places. Change it if it calls `placeView` from core directly.
- [X] T007 [US1] Create tools/checks/places.ts with `placesCommand(args)` per contracts/cli.md
  "`yarn verify places`":
  - **Maps**: `installMaps()` + `hotaInstallMaps()` from tools/shared/game-files.ts plus
    `public/dev-assets/*.h3m`, deduplicated by sha256. Gzip-aware reading as in tools/inspect/map.ts.
    `parseH3m` + `fromH3m` with a fixed seed. Parse failures go to `skipped`.
  - **Draws**: `--seeds` (default 50) draws per map at `--viewport` (default 1920x1080), scale 1, and
    `overscan` 8 × `TILE_SIZE`. Draw i uses placement seed `(i * 0x9e3779b1 + 17) >>> 0` and level seed
    `(seed ^ 0x85ebca6b) >>> 0` with `level: { random }`. Each draw runs once without coverage (today)
    and once with it; every tenth draw runs twice and is compared (SC-004).
  - **Fail**: any chosen coverage < candidate 0's; or, over maps ≥ 72×72, share-after > share-before / 4
    (SC-002); or a repeat mismatch.
  - **Skip**: exit 4 (outcome skip) when no map is found, exit 3 with `--require`.
  - **Report**: write `check-reports/places/report.json` with totals (before/after shares overall and
    for ≥ 72, mean first/chosen coverage, level switches, grid build ms on the largest map) and
    per-map rows with the worst chosen coverage and its seed.
  - **Output**: return a `CommandResult` like the other checks (see tools/checks/corpus.ts for the
    shape).
- [X] T008 [US1] Register the check:
  - add `places` in tools/checks/cli.ts (help text from contracts/cli.md, flag `require`);
  - add it to tools/checks/all.ts after `maps`: `results.places = outcome(await placesCommand(args({}, [])))`.
    Skip, as from the other checks, must not fail `all`.

**Checkpoint**: US1 is complete. `yarn test` passes, and `yarn verify places` passes on the local maps
with numbers near research R4 (1920×1080: 14.6 % → 0.2 %).

---

## Phase 4: User Story 2 - The other level when this one is empty (Priority: P2)

**Goal**: with the level setting "random" on a two-level map, the other level is tried after the
drawn level's candidates fail; a fixed level is respected.

**Independent Test**: synthetic two-level worlds with one empty level. Chosen views land on the busy
level only when "random" is set.

### Implementation for User Story 2

- [X] T009 [P] [US2] Add tests to test/core/render/view-placement.test.ts:
  - **Random level**: a 144×144 two-level world with an empty underground and a busy surface (and the
    reverse). With `level: { random }`, over 50 seeds, every chosen view whose drawn level is the
    empty one ends on the busy level, after exactly `CANDIDATES_PER_LEVEL` candidates on the drawn
    level.
  - **Fixed level**: with `level: 1`, every candidate is on level 1, even when it is empty.
  - **One-level map**: `level: { random }` on a one-level map gives only level 0 candidates (at most
    `CANDIDATES_PER_LEVEL`).
- [X] T010 [US2] Extend the Choice in src/core/render/view-placement.ts. The levels to try are
  `[drawn, 1 − drawn]` when `input.level` is `{ random }` and `input.levels === 2`, otherwise
  `[drawn]`. Each level gets `CANDIDATES_PER_LEVEL` candidates from the same RNG stream, in order
  (data-model.md "Choice" step 2).

**Checkpoint**: US1 and US2 tests pass; `yarn verify places` reports level switches (research R4:
2 311 at 1920×1080).

---

## Phase 5: User Story 3 - Reproducible and quick (Priority: P3)

**Goal**: a reported view can be reproduced and explained from the command line, and the first draw
stays within 20 ms under throttling.

**Independent Test**: `yarn h3 map place` prints the candidates of one draw, and `yarn verify budget`
reports `placeMs` ≤ 20.

### Implementation for User Story 3

- [X] T011 [P] [US3] Create tools/inspect/places.ts with `mapPlace(args)` per contracts/cli.md
  "`yarn h3 map place`":
  - **Map**: resolve it like the other map commands; reuse the map-loading helper of
    tools/inspect/map.ts (gzip, `parseH3m`, `fromH3m`).
  - **Flags**: `--seed` (default 1), `--level-seed` (default = seed),
    `--level random|surface|underground`, `--viewport WxH`, `--scale`, `--border` (default 8).
  - **Work**: build the grid with `coverageGrid`, then call `placeView` with `coverage`.
  - **Output**: `{ map, size, levels, view: { cols, rows, scale }, threshold, chosen, reached,
    candidates: [{ level, fx, fy, coverage, region }] }`, where `region` is the view's tile rectangle
    clamped to the map as `x0,y0,x1,y1`.
  - **Exit codes**: 2 for usage errors, 3 for a missing file.
- [X] T012 [US3] Register `'map place'` in tools/inspect/cli.ts, with the help text from
  contracts/cli.md.
- [X] T013 [P] [US3] Add a test of `mapPlace` on a synthetic map in test/tools/inspect-places.test.ts.
  Write a map with test/fixtures/synthetic/h3m.ts into a temp dir, run the command function directly
  and assert the JSON shape, that `chosen` points at a candidate, that `region` stays inside the map,
  and the usage error on a bad `--viewport`. Follow the pattern of the existing inspect tests in
  test/tools/ if one exists.
- [X] T014 [US3] Add `placeMs` to tools/checks/budget/metrics.ts:
  - After the warm start of the base-game case and of the HotA case, time one
    `__h3.engine.placeView({ random: 1 }, { mode: 'random', seed: 1 })` in the page through
    `page.evaluate` (`performance.now()` before and after, inside the page). This is the first random
    draw on that map, so it includes the lazy grid build.
  - Report it next to `warmStartMs`, and fail the budget when it is > 20 ms (SC-003) in
    tools/checks/budget/evaluate.ts.
  - Check that the harness hook in src/adapters/dev-harness/main.ts exposes `placeView` on
    `__h3.engine`. It exposes the engine object, so no change is expected.

**Checkpoint**: all three stories work; `yarn verify budget` passes with `placeMs`.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T015 [P] Update AGENTS.md:
  - "Commands": add `yarn h3 map place …` to the inspection block and `yarn verify places [--seeds 50]
    [--viewport 1920x1080] [--only MAP]` to the checks block.
  - "Current State": add one sentence on busy random places (spec 009): threshold 0.15, 10 candidates
    per level, coverage from map templates, and the 14.6 % → 0.2 % result.
- [X] T016 [P] Update specs/004-platform-adapters/spec.md FR-003a with one sentence: random places
  avoid empty views per specs/009-view-quality/. Also update docs/architecture.md where it describes
  view placement, if it does.
- [X] T017 [P] Add a CHANGELOG.md entry under the unreleased section, in the project's existing
  Markdown subset. A random place no longer lands on solid empty views such as black underground rock;
  the user-facing wording is in English like the rest of the file. Run `yarn verify store-texts`.
- [X] T018 Run the full verification and record the results in research.md as a new section "R8.
  Results":
  - `yarn test`, `yarn build`, `yarn verify layers`;
  - `yarn verify places`: its totals go into R8;
  - `yarn verify budget`: its `placeMs` goes into R8;
  - `yarn verify hosts` and `yarn verify corpus` (82 views, 15 602 pixels unchanged; SC-005).
  Fix any regression before closing.
- [X] T019 Walk through quickstart.md steps 1–4 and make sure each one runs as written. Then set the
  spec status to "Implemented" in specs/009-view-quality/spec.md.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: no dependencies.
- **Foundational (T002–T003)**: T002 needs nothing; T003 needs T001 and T002.
- **US1 (T004–T008)**: needs Phase 2. T005 needs T004; T006 needs T004; T007 needs T004; T008 needs
  T007.
- **US2 (T009–T010)**: needs T004, because it extends the same function. T010 goes after T009 has
  been written (test first).
- **US3 (T011–T014)**: T011 and T013 need T004 (T010 for correct level output); T012 needs T011; T014
  needs T006.
- **Polish (T015–T019)**: after all stories. T018 and T019 come last.

### User Story Dependencies

- **US1**: independent once Phase 2 is done (MVP).
- **US2**: builds on US1's Choice in the same file, but is testable on its own.
- **US3**: the CLI and the budget metric use the US1 and US2 code. They add tooling, not behaviour.

### Parallel Opportunities

- T001 runs in parallel with T002.
- After T004, these run in parallel: T005 (tests), T006 (engine) and T007 (check).
- T009 can be written in parallel with T006, T007 and T008.
- T011 and T013 can run in parallel; T015, T016 and T017 can run in parallel.

## Parallel Example: User Story 1

```text
After T004:
  Task T005: busy-place tests in test/core/render/view-placement.test.ts
  Task T006: memoised grid + PLACE_SPARSE in src/runtime/engine.ts
  Task T007: yarn verify places in tools/checks/places.ts
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001–T003 (grid), then T004–T008.
2. Stop and validate: `yarn test`, `yarn verify places` (SC-001, SC-002, SC-004), `yarn verify layers`.

### Incremental Delivery

1. US1 gives busy places on the drawn level, which is most of the value for one-level maps and busy
   undergrounds.
2. US2 handles the black-rock undergrounds when the level is random: the owner's main case.
3. US3 adds the explain CLI and the budget metric.
4. Polish covers docs, the changelog and the full verification.

## Notes

- Commit after each phase on `009-view-quality`, then merge into `testing` when the owner agrees.
- Never commit game files or anything derived from them. The measurements in research.md are numbers
  only.
