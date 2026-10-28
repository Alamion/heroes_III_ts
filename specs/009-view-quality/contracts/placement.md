# Contract: Placement and engine

Extends [spec 004 data-model "ViewPlacement"](../../004-platform-adapters/data-model.md) and
[spec 007 contracts/engine-api.md](../../007-map-folder/contracts/engine-api.md). The types are in
[data-model.md](../data-model.md); the reasons are in [research.md](../research.md) R2–R6.

## Core (`src/core/state/coverage.ts`, new)

```ts
export interface CoverageGrid {
  readonly size: number
  readonly levels: number
  /** levels × (size + 1)² summed-area table of covered tiles. */
  readonly sums: Uint32Array
}

/** One pass over the objects: blocked or visitable template tiles of every object not in HIDDEN_CLASSES. */
export function coverageGrid(world: Pick<WorldState, 'size' | 'levels' | 'objects'>): CoverageGrid

/** Covered tiles in the inclusive tile rectangle, clamped to the map. */
export function coveredTiles(grid: CoverageGrid, z: number, x0: number, y0: number, x1: number, y1: number): number

/** Share 0..1 of the camera's tiles that are covered; the denominator is min(view, map) per axis. */
export function viewCoverage(grid: CoverageGrid, camera: Camera): number
```

`coverage.ts` sits in `core/state`, and `Camera` comes from `core/render/camera.ts`. To keep the layers
importing downwards only, `viewCoverage` takes the camera's plain fields
`{ level, offsetX, offsetY, width, height, scale }` through a structural type declared in
`coverage.ts`, and does not import `camera.ts`.

## Core (`src/core/render/view-placement.ts`, extended)

```ts
export const BUSY_COVERAGE = 0.15
export const CANDIDATES_PER_LEVEL = 10

export interface PlacementInput {
  // … unchanged …
  /** With a random placement: choose a busy place (spec 009). Absent: today's uniform draw. */
  coverage?: CoverageGrid
}

export interface PlacementResult {
  // … unchanged …
  choice?: PlaceChoice
}
```

Rules:

- Without `coverage`, or with any placement other than `random`, the output is identical to today's,
  field for field.
- With `coverage`, the algorithm is "Choice" in the data model.

## Engine (`src/runtime/engine.ts`)

- The signature of `placeView(level, placement)` is unchanged and returns `{ level, fx, fy }`.
- For `mode: 'random'` it passes the memoised grid of the shown world.
- When the threshold is not reached it logs `PLACE_SPARSE` at debug level, with
  `{ map, best, candidates }`. No user message is raised (FR-010).
- `showPreparedMap` places the view through the same path, so folder rotation gets busy places as
  well.
- The controller (`src/adapters/shared/controller.ts`) is not changed.

## Dev harness

The test hook `window.__h3.engine` already exposes `placeView`. `yarn verify budget` times one call
`placeView({ random: 1 }, { mode: 'random', seed: 1 })` on a freshly shown map, under the budget's
CPU throttling, and reports it as `placeMs`. The budget is ≤ 20 ms (SC-003): the call includes the
first, lazy build of the grid.
