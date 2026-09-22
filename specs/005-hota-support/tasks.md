---

description: "Task list for HotA support"
---

# Tasks: HotA Support

**Input**: Design documents from `/specs/005-hota-support/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: included. The constitution (Principle III) requires every visible feature to ship with a
headless check that runs on Linux without a human, so test and check tasks are part of the feature,
not optional extras.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1–US5)
- Every task names the file it touches

## Path Conventions

Single project, layers as in AGENTS.md: `src/core/{util,data,formats,state,sim,render}` →
`src/runtime` → `src/adapters`; tooling in `tools/`; tests in `test/`.

---

## Phase 1: Setup

**Purpose**: prepare the branch, the attribution and the pre-change safety net

- [ ] T001 Create and switch to branch `005-hota-support` from `testing` (feature work is merged back into `testing`)
- [ ] T002 Record the pre-change base-game renders used by US3 (FR-008, SC-003): render a fixed set of regions of `public/dev-assets/test_map.h3m` at fixed time and seed with `yarn h3 render`, store the PNGs under git-ignored `check-reports/baseline-005/` **and** commit their SHA-256 digests to `test/real/base-render-baseline.json` (a digest is a fingerprint, not game content, and survives a cleaned report folder). Both must be produced **before** any source change
- [ ] T003 [P] Add attribution entries to `THIRD_PARTY_NOTICES.md` for `hota-lod-convert` (MIT OR Apache-2.0, archive index layout), `freeheroes` (MIT, map feature table and sub-versions 0–5), `mmarchive-cli` (MIT, DEF convention seed lists), `h3m2json` (Unlicense, prose format reference) and `vcmi-hota-mod` (CC BY-SA, naming data), stating that VCMI, vcmiextract and HotA-editor are study-only (FR-029)
- [ ] T004 [P] Extend the local install configuration in `tools/reference-env/config.ts` with an optional HotA install root (`hotaBundleDir`, env `H3REF_HOTA_BUNDLE_DIR`) and update `reference-env.config.example.json`
- [ ] T005 [P] Extend game-file discovery in `tools/shared/game-files.ts` so bare names also resolve from the HotA install's `Data/` and `Maps/` folders, keeping the existing search order first (FR-019)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: archives and the HotA map format core. No user story can begin before this phase is
complete.

**⚠️ CRITICAL**: US1 and US2 both sit on these tasks.

### Archives

- [ ] T006 [P] Implement the FNV-1a-32 name hash over the lower-cased entry name in new `src/core/formats/lod/name-hash.ts` per [contracts/archives.md](contracts/archives.md) (FR-001, FR-003)
- [ ] T007 [P] Add a HotA-shaped obfuscated LOD generator (random XOR key, hashed names, raw and zlib entries, a deliberately wrong-key case) to `test/fixtures/synthetic/hota-lod.ts`
- [ ] T008 Replace the `HOTA18_MARKER = 135` check in `src/core/formats/lod/lod.ts` with the measured detection rule (`u32 @12 ∉ {0, 0x7E0213}` = XOR key), read the obfuscated entry record, de-XOR offset/size/compressed size, and enforce the post-conditions from [contracts/archives.md](contracts/archives.md) as typed `FormatError`s (FR-001, FR-002, FR-009) (depends on T006)
- [ ] T009 Remove the `hota18Marker` case from `test/fixtures/synthetic/lod.ts` and any test asserting the old marker behaviour
- [ ] T010 Raise a typed "unsupported compression" error for compression types 1 and 2 in `src/core/formats/lod/lod.ts`, leaving every other entry of the archive readable (FR-005)
- [ ] T011 [P] Unit-test the archive index in `test/core/formats/lod.test.ts`: plain vs obfuscated detection including the `0x7E0213` filler, hash lookup, de-XOR asserts on a wrong key, unsupported compression (depends on T007, T008)
- [ ] T011a [P] Resolve obfuscated entry names in `tools/inspect/` for `lod list` and friends: hash the requested name for lookups, resolve listings through the local git-ignored `context/hota-lod-convert/data/hashes.txt` when present, and print `#<hex>` for an unrecovered hash, per [contracts/archives.md](contracts/archives.md) (FR-003, FR-019; depends on T006, T008)
- [ ] T012 Implement the ordered archive set (first-match-wins lookup, combined ordered identity, debug log on a duplicate name) in new `src/core/formats/lod/archive-set.ts` per [contracts/archives.md](contracts/archives.md) (FR-004)
- [ ] T013 [P] Unit-test precedence and identity of the archive set in `test/core/formats/archive-set.test.ts` (depends on T012)
- [ ] T014 Make `src/runtime/decode.ts` take an archive set instead of single archives for sprite and data lookups, keeping today's behaviour when the set has one member per role (FR-004) (depends on T012)
- [ ] T015 Bump `CACHE_SCHEMA` and derive the cache identity from the archive set in `src/runtime/cache-key.ts` (depends on T012)
- [ ] T016 [P] Classify a HotA archive in `src/runtime/file-kind.ts` and cover it in `test/runtime/file-kind.test.ts`

### Text tables

- [ ] T017 [P] Accept a 9- or 12-character terrain and editor-group mask (width read per file, all rows must agree) and widen the `group` range to 0–10 in `src/core/formats/text/objects-txt.ts`, with a typed error for any other width (FR-007)
- [ ] T018 [P] Add a 12-wide `Objects.txt` generator to `test/fixtures/synthetic/hota-objects-txt.ts` and unit-test both widths plus the mixed-width rejection in `test/core/formats/objects-txt.test.ts` (depends on T017)

### Map format core

- [ ] T019 Replace the flat version union with the `{ code, subVersion }` descriptor in `src/core/formats/h3m/types.ts` and report both from `parseH3m` in `src/core/formats/h3m/h3m.ts` (FR-006)
- [ ] T020 Add the feature table per `(code, subVersion)` in new `src/core/formats/h3m/features.ts` with the flags listed in [data-model.md](data-model.md) §3, each carrying a comment stating whether it is documented, ported or measured (FR-006, FR-006a) (depends on T019)
- [ ] T021 Carry the feature table in `src/core/formats/h3m/context.ts`, keeping the existing `ab`/`sod` flags working unchanged (depends on T020)
- [ ] T022 Read the HotA header fields (version triple, mirror/arena, terrain and town counts, difficulty mask, hire-defeated, force-version, reserved i32) in `src/core/formats/h3m/header.ts`, plus the counted allowed-hero list, the map-options additions and the counted allowed-artifact mask, per [contracts/map-format.md](contracts/map-format.md) (FR-006, FR-007) (depends on T021)
- [ ] T023 Read the HotA predefined-hero additions (u16 scroll spell per artifact slot, trailing 6-byte block per hero) and the victory-condition-12 u32 day count in `src/core/formats/h3m/header.ts` (depends on T022)
- [ ] T024 [P] Accept object-template `type` values 0–10 in `src/core/formats/h3m/templates.ts`, recording 9 and 10 as unidentified
- [ ] T025 [P] Accept terrain ids 10 and 11 with a bounds check of `terrainView` against the terrain's tile count in `src/core/formats/h3m/tiles.ts`
- [ ] T026 Add the HotA object bodies in `src/core/formats/h3m/objects/`: classes 144/145/146, class 212 subtypes 1000 (Quest Gate) and 1001 (Grave), class 36 subtype ≥ 1000 (arena, no radius), the widened subtype ranges for classes 16/34/53/98, and the HotA preset/guard blocks, keeping `UNSUPPORTED_OBJECT` for anything unmapped (FR-007, FR-010) (depends on T021)
- [ ] T027 Add the sub-version 10 deltas behind their feature flags in `src/core/formats/h3m/objects/`: +4 bytes at the end of a quest record, +4 bytes before a seer hut's reward type, +1 byte after a seer hut object (FR-006) (depends on T026)
- [ ] T028 Read the HotA global and town event changes (occurrence as u16 + 16 zero bytes, `i32 affectedDifficulties`) in `src/core/formats/h3m/h3m.ts` (depends on T021)
- [ ] T029 Enforce the parse invariant in `src/core/formats/h3m/h3m.ts`: the 124 trailing zero bytes followed by exact end of file, raising `TRAILING_DATA` with the offset otherwise (FR-009, FR-010) (depends on T028)
- [ ] T030 [P] Add a HotA map generator (format `0x20`, sub-versions 9 and 10, both script-flag states, the sub-10 deltas, HotA object subtypes) to `test/fixtures/synthetic/hota-map.ts`
- [ ] T031 [P] Unit-test the map format on synthetic fixtures in `test/core/formats/h3m-hota.test.ts`: header fields per sub-version, sub-10 deltas, HotA object bodies, unsupported sub-version and unmapped class errors (depends on T030, T027)
- [ ] T032 Add a real-file test in `test/real/hota-maps.test.ts` that parses `test_map_hota.h3m` (sub 10), `[HotA] The Devil Is in the Detail.h3m` (sub 9) and the 252×252 map to exact end of file, skipping with a message when the files are absent (depends on T029)

**Checkpoint**: HotA archives open and HotA maps without an active script block parse to the byte.

---

## Phase 3: User Story 1 — Open a HotA map as a wallpaper (Priority: P1) 🎯 MVP

**Goal**: with the base archives, the HotA archive and `test_map_hota.h3m`, the map renders on both
levels — terrain, rivers, roads, objects, towns and heroes — with no unresolved object and no error.

**Independent Test**: load `test_map_hota.h3m` plus the HotA archive in the dev harness and render
the underground novelty zone with `yarn h3 render`; the report shows zero unresolved objects.

### Terrain

- [ ] T033 [P] [US1] Add the per-terrain sprite source (`def` or `tiles`) and terrain ids 10 Highlands / 11 Wasteland with 124 tiles each to `src/core/data/terrain.ts`, leaving the ten existing terrains on their DEF source (FR-011)
- [ ] T034 [US1] Accept decoded PCX tiles as atlas inputs beside DEF frames in `src/core/render/atlas.ts`, keeping `toDisplayColor` and the page budget unchanged (FR-011) (depends on T033)
- [ ] T035 [US1] Load a terrain tile set through the archive set in `src/runtime/decode.ts` (`<prefix>000…123.pcx`) and feed it to the atlas (depends on T034, T014)
- [ ] T036 [P] [US1] Add a synthetic 124-tile PCX terrain set to `test/fixtures/synthetic/terrain-archive.ts` and unit-test tile selection, mirroring and the out-of-range tile error in `test/core/render/terrain-tiles.test.ts` (depends on T035)
- [ ] T037 [US1] Verify the palette rotation ranges against HotA's `game.pal` and record the result in `src/core/data/palette-rotation.ts` (a difference becomes a data entry, never a code branch) (FR-014)

### Towns, heroes, sprite conventions

- [ ] T038 [P] [US1] Replace the town sprite record with the five-form table (village, fort, citadel, castle, capitol) for the nine base factions, Cove, Factory and the random town, with the irregular Fortress and Conflux stems spelled out, in `src/core/data/object-classes.ts` (FR-013)
- [ ] T039 [US1] Select the town form by fortification level in `src/core/state/render-objects.ts`, keeping the measured base-game behaviour when no HotA archive is loaded (FR-013) (depends on T038)
- [ ] T040 [P] [US1] Extend the hero class table to `ah00_…ah23_` with the gendered `b` bodies present but unused (non-suffixed body rendered) in `src/core/data/heroes.ts` (FR-014)
- [ ] T041 [P] [US1] Sweep the HotA archive for DEF conventions (FR-015): a throwaway script in the scratchpad (not committed — it is a measurement, not a tool) decodes every `av*`/`ah*` DEF and counts pixels at palette indices 2, 3 and 255; record the resulting name lists and the stem-vs-exact-name answer in [research.md](research.md) R10
- [ ] T042 [US1] Commit the verified name-keyed convention table (shadows at 2/3, flag at 255, keep-selection) in new `src/core/data/hota-def-conventions.ts`, seeded from the MIT source and corrected by the sweep of T041 (FR-015) (depends on T041)
- [ ] T043 [US1] Apply the convention by DEF name when decoding shadows and the flag slot in `src/core/render/object-atlas.ts` and `src/core/data/animation.ts`, leaving every DEF outside the table on the base-game rules (FR-015) (depends on T042)
- [ ] T044 [P] [US1] Unit-test convention selection on synthetic DEFs in `test/core/render/hota-def-conventions.test.ts`: a listed name uses indices 2/3 and 255, an unlisted name keeps indices 1/4 and 5 (depends on T043)

### Wiring and diagnostics

- [ ] T045 [US1] Accept an optional HotA archive blob in `src/runtime/engine.ts` and build the archive set with it in front (depends on T014)
- [ ] T046 [US1] Count and report unresolved object classes (class, subtype, DEF name, map position) instead of drawing them, and mark them visibly in the dev harness only, in `src/core/state/render-objects.ts` and `src/adapters/dev-harness/` (FR-017) (depends on T045)
- [ ] T047 [US1] Report a clear diagnostic naming the missing HotA archive when a HotA map is loaded without one, in `src/adapters/shared/controller.ts` and `src/adapters/shared/strings.ts` (en/ru) (SC-007)
- [ ] T048 [P] [US1] Report format, sub-version, HotA version triple and script-section state in `yarn h3 map info`, and HotA subtypes in `map objects|object|tiles|tile`, in `tools/inspect/` (FR-019)
- [ ] T049 [US1] Load a HotA archive in the dev harness (`src/adapters/dev-harness/index.html` and its script) so `yarn dev` can open `test_map_hota.h3m` (depends on T045)
- [ ] T050 [US1] Add a real-file test in `test/real/hota-render.test.ts` that renders the underground novelty zone and a surface region of `test_map_hota.h3m` and asserts zero unresolved objects, skipping when the files are absent (FR-011, FR-012, FR-016, SC-002) (depends on T046, T035, T043)

**Checkpoint**: US1 is complete — a HotA map renders correctly from the HotA archive.

---

## Phase 4: User Story 2 — Every kind of map the user owns opens (Priority: P1)

**Goal**: every coverage class among the user's maps opens, across all four generations, including
the maps with an active script block and the non-ASCII file name.

**Independent Test**: `yarn verify maps` passes with every class represented, and `--all` opens
every discoverable map.

- [ ] T051 [US2] Implement the event-system walker (four event lists, id counters, variable table, id→name maps, opcode trees with length-prefixed strings) in new `src/core/formats/h3m/script.ts`, bounds-checked, with a typed error naming section and offset on failure and no length guessing (FR-007, FR-009; depends on T029)
  - **Fallback if the walker does not converge on the four local maps**: US2 ships with a typed "unsupported: map uses the HotA event system" error, the 4 affected maps become a recorded known limitation in [research.md](research.md), and the acceptance scenario naming `По праву силы.h3m` moves to a follow-up item with the owner's agreement. Length searching stays forbidden either way.
- [ ] T052 [US2] Call the walker from the map parser at its measured position — after the map-options block, before the allowed-artifact mask, gated on the sub ≥ 9 flag — in `src/core/formats/h3m/h3m.ts` (depends on T051)
- [ ] T053 [P] [US2] Extend `test/fixtures/synthetic/hota-map.ts` with an active script block and unit-test the walker (valid block, truncated block, unknown opcode) in `test/core/formats/h3m-script.test.ts` (depends on T052)
- [ ] T054 [US2] Add a real-file test in `test/real/hota-maps.test.ts` that parses the four local maps with an active script block to exact end of file, asserting the measured body lengths (3574, 10 630, 3371, 4051 bytes) (depends on T052)
- [ ] T055 [P] [US2] Fill the feature flags for HotA sub-versions 0–8 from the ported sources in `src/core/formats/h3m/features.ts`, marked best-effort, so a mismatch surfaces as a typed error rather than a misread map (FR-006a, FR-010) (depends on T020)
- [ ] T056 [P] [US2] Confirm the non-ASCII map file name path end to end (CLI by name, file picker, cache identity) and add a case for it to `test/real/hota-maps.test.ts`
- [ ] T057 [US2] Implement the coverage-class check in new `tools/checks/maps/index.ts`: classification, one map per class plus the named edge cases, `--dir`, `--all`, `--require`, the report shape and the exit codes of [contracts/cli.md](contracts/cli.md) (FR-020, SC-001) (depends on T052)
- [ ] T058 [US2] Register `maps` in `tools/checks/cli.ts` and include it in `yarn verify all` in `tools/checks/all.ts` (depends on T057)
- [ ] T059 [P] [US2] Unit-test the classification and the pass/fail rules of the coverage check on synthetic maps in `test/tools/maps-check.test.ts` (depends on T057)
- [ ] T060 [US2] Run `yarn verify maps --all` over `public/dev-assets/` and the configured HotA maps folder, fix what it finds, and record the resulting class table in [research.md](research.md) (SC-001) (depends on T058)

**Checkpoint**: US2 is complete — every map variant the user owns opens, with honest failures for
anything unsupported.

---

## Phase 5: User Story 3 — Base-game maps are unchanged (Priority: P1)

**Goal**: everything that worked before the feature produces the same result afterwards.

**Independent Test**: renders of the base-game regions match the pre-change PNGs of T002 byte for
byte, and every existing check keeps its previous verdict.

- [ ] T061 [US3] Re-render the T002 regions with the same time and seed and assert equality against the committed digests in `test/real/base-render-baseline.json` (and against the stored PNGs when `check-reports/baseline-005/` is still present, for a visual diff), as a real-file test in `test/real/base-render-unchanged.test.ts` (FR-008, SC-003; depends on T002 and all of Phase 3)
- [ ] T062 [US3] Assert that a base-game map loaded with base archives only takes exactly the previous code path (single-member archive set, no HotA branch) in `test/runtime/archive-set-runtime.test.ts` (FR-026)
- [ ] T063 [US3] Run `yarn verify determinism --rebuild`, `yarn verify fidelity --map test_map.h3m --all-regions`, `yarn verify layers`, `yarn verify packages` and `yarn verify hosts` and confirm each keeps its pre-feature verdict, including the accepted deviations of spec 003; record the run in `check-reports/` (FR-023, SC-003)
- [ ] T064 [P] [US3] Confirm the full base-game suite still skips cleanly with no game files present (`yarn test` with `public/dev-assets/` unavailable)

**Checkpoint**: US3 is complete — HotA support is proven additive.

---

## Phase 6: User Story 4 — HotA appearance matches the game (Priority: P2)

**Goal**: HotA content is verified against captures of the HotA build, not judged by eye.

**Independent Test**: `yarn verify fidelity` passes on HotA views of `test_map_hota.h3m` at the same
thresholds as base-game views, comparing only against HotA captures.

- [ ] T065 [US4] Amend `.specify/memory/constitution.md` (FR-024): add the HotA reference baseline to Principle II (which build, which install, capture labelling, relation to the Complete baseline); **reconcile the scope order** — Principle II currently reads "(1) RoE/AB/SoD maps, (2) Complete save files, (3) HotA" and the "Formats in scope" list says saves come next, while the owner reordered HotA ahead of saves on 2026-09-22, so record that decision in both places; reserve the HotA budget numbers filled by T075; include the Sync Impact Report and bump the version
- [ ] T066 [US4] Add the baseline dimension to the reference environment in `tools/reference-env/`: `--baseline complete|hota`, a separate game root built from the HotA install, separate calibration probes, and a capture namespace recorded on every record (FR-021) (depends on T065, T004)
- [ ] T067 [US4] Refuse the `hota` baseline with a clear message when the constitution amendment is absent, in `tools/reference-env/` (depends on T066)
- [ ] T068 [US4] Make a fidelity view compare only against captures of its own baseline, erroring on a mismatch, in `tools/checks/fidelity/` (FR-022) (depends on T066)
- [ ] T069 [US4] Run `yarn ref doctor|setup|calibrate --baseline hota` and record the probes and prerequisites in [research.md](research.md) (depends on T067)
- [ ] T070 [US4] Capture HotA stills and clips of `test_map_hota.h3m` covering the new terrains, every town faction and form, and the underground novelty zone (FR-021) (depends on T069)
- [ ] T071 [US4] Run `yarn verify fidelity --map test_map_hota.h3m --all-regions`, fix what it finds, and record any remaining difference as an accepted deviation with owner review in [research.md](research.md) (FR-018, FR-022, SC-004) (depends on T070, T068)

**Checkpoint**: US4 is complete — HotA fidelity is measured, not assumed.

---

## Phase 7: User Story 5 — The HotA archive is a normal setting on every host (Priority: P2)

**Goal**: the HotA archive is selected and remembered like the other archives on all four hosts.

**Independent Test**: the host simulations run with a HotA archive plus a HotA map per host and the
settings round-trip; with the setting unset, behaviour is exactly as today.

- [ ] T072 [US5] Add the `hotaarchive` file setting (type `file`, filter `*.lod`, default null) and its en/ru strings to `src/adapters/shared/settings.ts` and `strings.ts`, and pass it through `src/adapters/shared/controller.ts` to the engine (FR-025) (depends on T045)
- [ ] T073 [US5] Regenerate the host manifests from the single definition (`tools/package/manifests/{wallpaper-engine,lively,kde}.ts`) and surface the setting in the browser panel `src/adapters/web/panel.ts`; update the manifest tests in `test/tools/manifests.test.ts` (FR-025, SC-005) (depends on T072)
- [ ] T074 [US5] Extend the host simulations in `tools/checks/hosts/` with a HotA archive plus HotA map run per host and an unset-setting run that must match today's behaviour (FR-026, SC-005) (depends on T073)
- [ ] T075 [US5] Measure the HotA case in `tools/checks/budget/`: cold start with the HotA archive set, decode-cache size, memory and the 252×252 two-level HotA map; write the measured numbers into the constitution amendment of T065 and fail the check when a number is outside its approved budget (FR-027, SC-006) (depends on T065, T045)

**Checkpoint**: US5 is complete — the feature exists on every host, within approved budgets.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T076 [P] Update `AGENTS.md`: current state, the HotA facts worth respecting (archive detection, name hash, terrain tile sets, five town forms, DEF conventions, script block), the base-game-only scope of the two-form town rule, the new dev asset `test_map_hota.h3m`, and the new commands
- [ ] T077 [P] Update `TODO.md`: mark item 3 done with a pointer to this spec and move anything deferred (D32/P32, `HotA.dat`, `EdObjts.txt`, LZMA, HotA saves, hero gender source) into the later items
- [ ] T078 [P] Update the user-facing docs per host with the new archive setting and where the HotA archive comes from, in `docs/`
- [ ] T078a Extend `test/tools/hygiene.test.ts` so the repository-cleanliness rules cover this feature's new surfaces (FR-028): no committed entry-name dictionary, no extracted tiles, palettes or sprites, no HotA captures, and the new `test/fixtures/synthetic/hota-*.ts` generators produce their data in code
- [ ] T079 Run [quickstart.md](quickstart.md) end to end and fix anything that does not behave as written
- [ ] T080 Fill the Compliance Review table in [plan.md](plan.md) against the actual implementation, recording accepted deviations (constitution "Compliance review")

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies. T002 must run before any source change.
- **Foundational (Phase 2)**: depends on Setup. Blocks every user story.
- **US1 (Phase 3)** and **US2 (Phase 4)**: both depend on Phase 2; they touch different files
  (render data vs the script walker and the coverage check) and can run in parallel.
- **US3 (Phase 5)**: depends on T002 and on the stories whose changes it verifies — run it last
  among the P1 stories, and re-run it after US4 and US5.
- **US4 (Phase 6)**: depends on Phase 2 and on US1 (there must be something to compare), and on the
  constitution amendment T065.
- **US5 (Phase 7)**: depends on US1 (T045) and, for the budget numbers, on T065.
- **Polish (Phase 8)**: depends on everything else.

### Notable task dependencies

- T008 → T011, T011a, T012, T014 (archive index before names, set and runtime)
- T019 → T020 → T021 → T022–T028 → T029 (version descriptor before every map section)
- T029 → T051 → T052 → T057 (parse invariant before the walker before the coverage check)
- T041 → T042 → T043 (sweep before the committed table before the decoder)
- T065 → T066/T067/T075 (amendment before the HotA baseline and the approved budgets)

### Parallel opportunities

- Setup: T003, T004, T005 together
- Foundational: T006/T007 together; then T011a, T017/T018 and T024/T025 alongside the T019–T023
  chain; T030 alongside T026–T028
- US1: T033, T038, T040, T041 together; T036 and T044 once their implementations land
- US2: T055 and T056 alongside the T051–T054 chain
- Polish: T076, T077, T078, T078a together

---

## Parallel Example: Foundational

```bash
# Independent files, no shared state:
Task: "T006 FNV-1a-32 name hash in src/core/formats/lod/name-hash.ts"
Task: "T007 HotA-shaped synthetic LOD in test/fixtures/synthetic/hota-lod.ts"
Task: "T017 Objects.txt mask width 9 or 12 in src/core/formats/text/objects-txt.ts"
Task: "T024 template type 0-10 in src/core/formats/h3m/templates.ts"
Task: "T025 terrain ids 10/11 in src/core/formats/h3m/tiles.ts"
```

---

## Implementation Strategy

### MVP (US1)

1. Phase 1 Setup, including the pre-change renders of T002.
2. Phase 2 Foundational — archives and the map format core.
3. Phase 3 US1 — `test_map_hota.h3m` renders on both levels with zero unresolved objects.
   (T011a in Phase 2 is what makes quickstart §1 print names rather than 5232 hashes.)
4. **Stop and validate**: quickstart §1, §2 (info only), §4.

### Incremental delivery

1. Foundation → HotA archives open and maps parse.
2. + US1 → a HotA map renders (demo-able).
3. + US2 → every map variant the user owns opens.
4. + US3 → proof that nothing base-game moved.
5. + US4 → HotA fidelity measured against the HotA build.
6. + US5 → the feature lives on all four hosts, within approved budgets.

### Notes

- Commit after each task or logical group; keep the branch mergeable into `testing`.
- Never commit game content or anything derived from it, including entry-name dictionaries,
  extracted tiles, palettes or captures.
- Every parser change keeps typed errors with file, offset, version and structure; no guessed skips.
- Re-run US3 (Phase 5) after any later phase touches shared code.
