# Data model: Busy random places (spec 009)

Pure data, DOM-free, all in `src/core` (testable in Node). Names are the planned TypeScript names.

## CoverageGrid (`src/core/state/coverage.ts`)

Which tiles map objects occupy, per level, as a summed-area table (research R2, R5).

| Field | Type | Meaning |
| --- | --- | --- |
| `size` | number | Map side in tiles. |
| `levels` | number | 1 or 2. |
| `sums` | `Uint32Array` | `levels × (size + 1)²`; entry (z, y, x) = covered tiles in rows `< y`, columns `< x` of level z. |

- Built by `coverageGrid(world: Pick<WorldState, 'size' | 'levels' | 'objects'>)` in one pass over
  `world.objects`.
- Each object outside `HIDDEN_CLASSES` marks, on its own level, every tile of its 8×6 template
  window that is blocked (passable bit clear) or visitable (active bit set). Tiles off the map are
  dropped.
- Heroes, boats and random objects are ordinary objects here (spec edge case "Hidden random objects").
- `coveredTiles(grid, z, x0, y0, x1, y1)` counts covered tiles in an inclusive tile rectangle. It
  clamps the rectangle to the map, and a rectangle wholly off the map gives 0.
- `viewCoverage(grid, camera)` gives the view's tile range from the camera (offset, width / scale,
  height / scale) and divides by `min(viewCols, size) × min(viewRows, size)` (R2). The result is in
  0..1.

## PlacementInput (extended, `src/core/render/view-placement.ts`)

| New field | Type | Meaning |
| --- | --- | --- |
| `coverage` | `CoverageGrid \| undefined` | When given and `placement.mode === 'random'`, the place is chosen (Choice below). When absent, the result is today's draw, bit for bit. |

## PlacementResult (extended)

| New field | Type | Meaning |
| --- | --- | --- |
| `choice` | `PlaceChoice \| undefined` | Only for a random placement that had a coverage grid. |

`PlaceChoice`:

| Field | Type | Meaning |
| --- | --- | --- |
| `candidates` | `readonly Candidate[]` | In the order they were tried. The last one tried is either the first that reached the threshold, or the last of all. |
| `chosen` | number | Index into `candidates`. |
| `reached` | boolean | `candidates[chosen].coverage >= BUSY_COVERAGE`. |

`Candidate`: `{ level: number; fx: number; fy: number; coverage: number }`.

## Choice (the algorithm)

Constants in `view-placement.ts`: `BUSY_COVERAGE = 0.15` and `CANDIDATES_PER_LEVEL = 10` (research R3).

1. `rng = createRng(placement.seed)` and `drawn` = the level today's code picks from `input.level`
   (unchanged).
2. Levels to try:
   - `[drawn, 1 − drawn]` when `input.level` is `{ random }` and `levels === 2`;
   - otherwise `[drawn]`.
3. For each level in order, `CANDIDATES_PER_LEVEL` times: `fx = rng.next()`, `fy = rng.next()`, place
   the camera as for coords `(fx, fy)` and score it with `viewCoverage`. Stop at the first candidate
   with `coverage >= BUSY_COVERAGE`.
4. `chosen` is the candidate that stopped the loop. If none did, it is the highest coverage, and a tie
   goes to the earlier candidate.
5. The result's camera, `fx`, `fy` and level are those of `chosen`.

Invariants (each one is a test):

- Candidate 0 equals today's random place: the same `fx`, `fy` and level.
- `coverage(chosen) >= coverage(candidate 0)` (SC-001).
- Same input gives the same output (SC-004).
- A fixed level keeps every candidate on that level. A one-level map has only level 0.
- On a map not larger than the view on either axis, all candidates of a level share one camera.

## Engine (`src/runtime/engine.ts`)

- `coverageFor(world)` memoises `coverageGrid` under `world.objects` in a `WeakMap`. The objects map
  survives `applyEvent` and is replaced with a new map (research R5).
- `placeView` passes the grid only for `{ mode: 'random' }` placements.
- When `choice.reached` is false, it logs one line at debug level (`PLACE_SPARSE`, with the best
  coverage, the number of candidates and the map name; FR-010).
- The value returned to the controller keeps its shape `{ level, fx, fy }` (FR-006).
