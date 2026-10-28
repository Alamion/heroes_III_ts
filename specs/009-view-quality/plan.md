# Implementation Plan: Busy random places

**Branch**: `009-view-quality` | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-view-quality/spec.md`

## Summary

A random place on a map is chosen from up to 10 candidates per level. With the level setting
"random" on a two-level map, the drawn level comes first, then the other one. The first candidate
whose view is at least 15 % covered by map objects is taken; otherwise the most covered one is.

- **Coverage** comes from the map's own object templates (blocked and visitable tiles) through a
  summed-area table. It is known as soon as the terrain is, needs no archive, and the view never jumps.
- **Today's draw stays candidate 0**, so a place never gets worse, and about six draws in seven look
  exactly as before.
- **Measured over the owner's 447 maps at 1920×1080**: views below the threshold fall from 14.6 % to
  0.2 % (research R4).
- **New tools**: `yarn h3 map place` explains one draw; `yarn verify places` checks SC-001, SC-002 and
  SC-004 on all local maps; `yarn verify budget` gains `placeMs`.

## Technical Context

**Language/Version**: TypeScript (strict, `erasableSyntaxOnly`), Node 22 for CLIs and checks

**Primary Dependencies**: none at runtime; Vitest for tests

**Storage**: none. The grid is memoised in memory per shown world and is not cached in IndexedDB, so
`CACHE_SCHEMA` is unchanged.

**Testing**:

- Vitest unit tests on synthetic worlds: objects with chosen templates, no fixture files.
- `yarn verify places`, a Node check over real maps.
- `yarn verify budget` for timing.

**Target Platform**: all hosts. The change is in core and runtime only, and adapters are untouched.

**Project Type**: live wallpaper (web runtime + host adapters)

**Performance Goals**:

- First random draw on a shown map ≤ 20 ms under 4× CPU throttling (SC-003). Unthrottled it measured
  2.6 ms warm and ≤ 24 ms cold on the largest maps (research R5).
- Later draws on the same map cost microseconds.

**Constraints**:

- Deterministic per (map, seeds, level setting, view size in tiles).
- No rendering and no archives involved.
- Coordinates and centre modes untouched.

**Scale/Scope**:

- Maps up to 252×252 × 2 levels and ~30 000 objects.
- About 2 files of core code, the engine hook, 1 CLI command, 1 check and the budget metric.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
| --- | --- |
| I. User-supplied assets only | Pass. Nothing game-derived is committed. Measurements are numbers in research.md, and the tests use synthetic objects. |
| II. Fidelity to the Complete edition | Not affected. The original game has no "random place"; this is wallpaper behaviour (spec 004 FR-003a). Captures and fidelity use fixed regions. |
| III. Script-verifiable | Pass. The choice is a pure seeded function. Unit tests, `yarn verify places` and the `yarn h3 map place` inspection CLI cover it. |
| IV. Screen-bound performance | Pass with a note. The grid is a one-time O(objects) pass per map on the main thread, not per frame. It takes about 3 ms, so it is not "heavy work" in the principle's sense. It is budgeted (`placeMs` ≤ 20 ms throttled), and the fallback is the decode worker (research R5). Per-frame work is unchanged. |
| V. Platform-agnostic core | Pass. Core and runtime only; no host code. |
| VI. Layered architecture | Pass. `core/state/coverage.ts` does not import render: it takes the camera fields structurally. `core/render/view-placement.ts` imports state (downwards). `yarn verify layers` checks it. |
| VII. Robust parsing, honest failure | Pass. No parsing. A draw below the threshold is normal: a debug log, no message (FR-010). |
| VIII. Lean dependencies | Pass. No dependencies; well under 1 KB of runtime code gzipped. |

Re-check after Phase 1: unchanged, with no violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/009-view-quality/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R7: h3lwp, coverage definition, threshold, simulation, cost, determinism
├── data-model.md        # CoverageGrid, PlaceChoice, the Choice algorithm and its invariants
├── quickstart.md
├── contracts/
│   ├── placement.md     # core + engine interfaces
│   └── cli.md           # yarn h3 map place, yarn verify places
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/core/state/coverage.ts            # new: coverageGrid, coveredTiles, viewCoverage
src/core/render/view-placement.ts     # coverage input, candidates, PlaceChoice, constants
src/runtime/engine.ts                 # memoised grid per world.objects, PLACE_SPARSE debug log
tools/inspect/places.ts               # new: yarn h3 map place
tools/inspect/cli.ts                  # register 'map place'
tools/checks/places.ts                # new: yarn verify places
tools/checks/cli.ts, tools/checks/all.ts   # register; include in verify all
tools/checks/budget/metrics.ts        # placeMs
test/core/state/coverage.test.ts      # new
test/core/render/view-placement.test.ts   # choice invariants
AGENTS.md                             # commands, Current State line
specs/004-platform-adapters/spec.md   # FR-003a: pointer to spec 009
```

**Structure Decision**: single project, existing layout. The core logic goes into the existing
placement module plus one new state module; the tools follow the existing inspect and check patterns.

## Complexity Tracking

No violations.
