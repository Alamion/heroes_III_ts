# Implementation Plan: Foundation Rewrite

**Branch**: `002-foundation-rewrite` | **Date**: 2026-09-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-foundation-rewrite/spec.md`

## Summary

Replace the proof of concept with a layered, dependency-free TypeScript foundation: bounds-checked
parsers for LOD, DEF, PCX and H3M (RoE/AB/SoD, all object bodies), a version-independent world
state changed only by simulation events, a WebGL 1.0 terrain/river/road renderer whose work and
GPU memory depend only on the viewport (palette animation by lookup-texture row updates), a
browser runtime (worker decoding, IndexedDB cache, visibility-aware frame scheduler), a plain-DOM
dev harness, inspection CLIs (`yarn h3 …`) including floating tiles for item 1's selfcheck, and
headless checks (`yarn verify fidelity|budget|layers`) driven through system Chromium with
SwiftShader. Decisions and format facts: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `erasableSyntaxOnly`), ES2023; Node 22 (type
stripping) for CLIs and tests; Chromium ≥ 80 class hosts for runtime.

**Primary Dependencies**: runtime — none (native `DecompressionStream`, WebGL 1.0, IndexedDB,
Worker). Dev — Vite, Vitest, TypeScript, `playwright-core` (new, Apache-2.0) with system
Chromium. Removed — pixi.js, preact, @preact/preset-vite, pako, fflate, lzma-purejs, chokidar.

**Storage**: IndexedDB cache in the browser (`h3dynam`: `atlas`, `world` stores keyed by source
identity); local files only in Node; reports under git-ignored `reference-captures/` and a new
git-ignored `check-reports/`.

**Testing**: Vitest (Node) for formats/state/sim/draw-plan/tools with synthetic fixtures and
optional real files; headless Chromium checks for render determinism, fidelity, and budgets.

**Target Platform**: browser runtime (dev harness now; Wallpaper Engine/Lively/KDE adapters in
item 3); Linux for all development and checks.

**Project Type**: single project — browser library + dev harness + Node CLIs.

**Performance Goals**: constitution budgets (runtime ≤ 100 KB gz, warm ≤ 2 s, cold ≤ 10 s,
≤ 300 MB, surface ≤ display×DPR, 0 frames hidden, idle frames ≤ animation cadence), per-frame
work equal across map sizes (research §11).

**Constraints**: WebGL 1.0 without required extensions; no per-tile scene objects; no per-step
textures; no game content in the repository; parsers/state/sim DOM-free.

**Scale/Scope**: maps up to 252×252×2 (synthetic now), 157 base-game maps in the local install
(47 RoE, 54 AB, 56 SoD) as the parse corpus; ~1,200 terrain/river/road/border frames in the atlas.

**Thresholds fixed by this plan** (spec asks the plan to set them): SC-007 tolerance — draw
calls, vertices, GPU bytes equal (±1 % bytes), median per-frame CPU within 20 % or 0.5 ms (JS
heap only bounded by the 300 MB budget); FR-020 "not checkable automatically" — no differing
pixel and compared pixels < 25 % of in-map region pixels, for any cause; palette-animated
pixels are compared by animation state, never excluded as volatile (research §5, §10, §11).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
| --- | --- | --- |
| I. User-Supplied Assets | No game files, frames, palettes, tables or captures committed; game tables (`Objects.txt`) read at run time from the user's LOD; synthetic fixtures generated from committed code; real-file tests skip when absent; homm3-parser port attributed in `THIRD_PARTY_NOTICES.md`; h3lwp/VCMI used for facts only. | Pass |
| II. Fidelity to Complete | Tile choice, mirroring, palette ranges/direction/timing matched to baseline and verified with item 1 captures; unknowns (step duration, road offset, border randomness) measured, not assumed; HotA rejected explicitly; native 32 px. | Pass |
| III. Script-Verifiable | Injectable clock + seeded RNG; data-level tests, fidelity image check, determinism check (SC-008); inspection CLIs incl. render-to-PNG; "not checkable" outcome is explicit and listed for visual review. | Pass |
| IV. Screen-Bound Performance | Viewport-sized vertex buffer, fixed-size atlas, surface ≤ display×DPR, palette row updates instead of new textures, on-demand frames, zero work hidden, worker decode + IndexedDB cache, range reads of LOD; enforced by `yarn verify budget`. | Pass |
| V. Platform-Agnostic, Linux-First | `src/core` has no platform/DOM-specific APIs beyond WebGL in the renderer; harness is a thin adapter using the same engine API; all tools run on Linux; Windows `sync.js` removed; Chromium path from env. | Pass |
| VI. Layered, State-Driven | `formats → state → sim → render → runtime/adapters`; state mutated only via sim events; typed data modules in `src/core/data`; enforced by `yarn verify layers`. | Pass |
| VII. Robust Parsing | `ByteReader` with typed `FormatError {file, offset, version, structure}`; exhaustive object switch with `unsupported`; no guessed skips; parse-to-exact-end assertion; engine surfaces diagnostics without crashing. | Pass |
| VIII. Lean Dependencies | Zero runtime deps (each removal justified in research §1); one new dev dep (`playwright-core`) justified in research §2; strict TS. | Pass |

**Post-design re-check (after Phase 1)**: data model, contracts and quickstart introduce no new
dependency, no platform API in core, and no committed derived data. The only runtime browser
APIs (Worker, IndexedDB, `File`) live in `src/runtime`, outside `src/core`. **Pass** — no
Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/002-foundation-rewrite/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── engine-api.md          # core/runtime API used by harness and future adapters
│   ├── inspect-cli.md         # yarn h3 … commands and JSON output
│   ├── checks-cli.md          # yarn verify fidelity|budget|layers
│   └── report.schema.json     # fidelity and budget report JSON schemas
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── core/                      # platform-agnostic; runs in Node except render/
│   ├── data/                  # typed game tables: terrain/river/road ids→DEF, palette
│   │                          # rotation, object classes, player colors, check thresholds
│   ├── util/                  # ByteReader, FormatError, logger, seeded RNG, clock types
│   ├── formats/
│   │   ├── lod/               # archive index, entry read/inflate (ByteSource abstraction)
│   │   ├── def/               # header, groups, frame decode (0–3) into Uint8Array indices
│   │   ├── pcx/
│   │   ├── h3m/               # header, players, conditions, tiles, templates,
│   │   │   └── objects/       # one module per body family, exhaustive dispatch
│   │   └── text/              # Objects.txt template table reader
│   ├── state/                 # WorldState, fromH3m(), footprints, floating tiles
│   ├── sim/                   # events, applyEvent(), animation time
│   └── render/                # draw plan (pure), atlas packing (pure), WebGL renderer
├── runtime/                   # browser-only: Engine facade, worker + protocol,
│                              # IndexedDB cache, frame scheduler, file ByteSource
└── adapters/
    └── dev-harness/           # index.html entry, file inputs, scroll/level keys, diagnostics

tools/
├── reference-env/             # item 1 (unchanged; imported for lookup/geometry)
├── inspect/                   # yarn h3: lod, def, pcx, map, render
├── checks/                    # yarn verify: fidelity, budget, layers
└── shared/                    # png codec (node:zlib), headless chromium launcher,
                               # game file resolution (bundleDir config), JSON CLI runner

test/
├── fixtures/synthetic/        # H3M/LOD/DEF/PCX writers (committed code, no game data)
├── core/                      # unit tests per layer
├── tools/                     # CLI tests on synthetic files
├── real/                      # tests on install/dev-assets files (skip when absent)
└── reference-env/             # item 1 (unchanged)

THIRD_PARTY_NOTICES.md
```

**Structure Decision**: single project. Layer order is enforced by path: `core/util`,
`core/data` ← `core/formats` ← `core/state` ← `core/sim` ← `core/render` ← `runtime` ←
`adapters`; `tools` may import anything; nothing imports `tools` or `adapters`. `core/render`
may use WebGL types but not `window`, `document`, Worker or IndexedDB.

## Phase outline for tasks

1. **Setup**: remove PoC, deps and sync script; tsconfig for `src/core` (no DOM lib for
   formats/state/sim), vite harness entry, `playwright-core`, `THIRD_PARTY_NOTICES.md`, layer check.
2. **Formats (US1)**: ByteReader/errors → LOD → DEF → PCX → H3M header/tiles/templates → object
   bodies → text tables; synthetic writers alongside; `yarn h3 lod|def|pcx|map`; parse-all install
   test (SC-001, SC-002, SC-002a).
3. **State + floating tiles (US2)**: world state, footprints, `yarn h3 map floating`; selfcheck
   integration test (SC-003).
4. **Renderer + runtime + harness (US3)**: draw plan, atlas, WebGL program, scheduler, worker,
   cache, harness; `yarn h3 render`; spikes for road offset, border, palette timing (research
   open items); determinism check (SC-008).
5. **Fidelity (US4)**: capture alignment, masks, outcomes incl. not-checkable, clip step check
   (SC-004, SC-005).
6. **Budgets (US5)**: synthetic 252×252 map, metrics harness, `yarn verify budget` (SC-006,
   SC-007, SC-009).
7. **Polish (US6)**: AGENTS.md (stack, layout, commands), TODO.md, drop Preact skill, final
   constitution compliance review.

## Compliance Review (after implementation, 2026-09-15)

| Principle | Implementation | Status |
| --- | --- | --- |
| I | No game files or derived data tracked (`test/tools/hygiene.test.ts`); `publicDir` disabled for builds so `dist/` never contains dev assets; UI ornament masks computed at run time from local captures, not committed; H3M layouts attributed in `THIRD_PARTY_NOTICES.md`. | Pass |
| II | RGB565 display colour, palette direction/timing, lava range, border pattern and road offset measured against captures; 30/32 Arrogance stills and the clip match with 0 differing pixels; HotA rejected. | Pass, with known gaps below |
| III | Injectable clock, deterministic rendering (`yarn verify determinism`, 10/10 identical); inspection CLIs incl. `yarn h3 render`; `verify fidelity` with not-checkable outcome. | Pass |
| IV | `yarn verify budget` passes all budgets; one draw call; GPU bytes and vertex capacity equal for 36×36 and 252×252×2. | Pass |
| V | `src/core/{util,data,formats,state,sim}` compile without DOM/Node types (`tsconfig.core.json`); `yarn verify layers` passes; Linux-only tooling; `scripts/sync.js` removed. | Pass |
| VI | Layer order enforced; state changes only via `applyEvent`; tables in `src/core/data`. | Pass |
| VII | Bounds-checked `ByteReader` with typed errors; strict padding checks; exhaustive object dispatch; 157/157 install maps parse and round-trip byte-exact. | Pass |
| VIII | Zero runtime dependencies; runtime 32 KB gzipped; one dev dependency added (`playwright-core`). | Pass |

**Deviations from this plan** (all recorded in research.md):
- `Objects.txt` replaces `ObjTmplt.txt`/`CrTraits.txt`; random candidates are chosen per outcome
  class (conservative) instead of by creature level.
- Web globals in core use typed `globalThis` accessors instead of an ambient `.d.ts`.
- Fidelity searches animation states with the reference software rasterizer and cross-checks the
  WebGL frame bit-exactly; stills allow per-sprite steps ±1 (capture timing).
- Palette joint period is 72 (lava has nine colours), not 24.
- Synthetic generators live in `test/fixtures/synthetic/` and are also used by `yarn verify`.
- Separate `tsconfig.browser-tests.json` for page-evaluated test code.

**Known gaps (not yet verified against game captures)**: mud and lava river palette ranges, roads
(verified on an editor still only), map border corners, and captures of other maps — the item 1
capture tooling fails on the two road maps tried. Mouse-drag scrolling and DPR > 1 are exercised by
the harness but not by an automated check.

## Complexity Tracking

No violations.
