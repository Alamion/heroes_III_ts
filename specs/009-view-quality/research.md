# Research: Busy random places (spec 009)

All measurements were taken on 2026-10-28 over the owner's local maps: 447 maps that parse, from the
Complete install's `Maps` and the HotA install's `Maps`. Each map got 50 seeds with a random level
(22 350 draws), the view was 1920×1080 at ×1 with the engine's 8-tile border band, and coverage was
computed as in R2 unless a row says otherwise. The scripts were throwaway: they lived in the
session's scratchpad and are replaced by `yarn verify places` (contracts/places-check.md).

## R1. What h3lwp does (study only, GPL-3.0)

`context/heroes_iii_android`, `GameScreen.rollWellCoveredView` and `ObjectsLayer.objectCoverage`:

- It draws up to 20 candidates (map and camera position).
- It accepts the first candidate where the bounding rectangles of the visible sprites touch at least
  80 % of the view's tile cells. In dark mode it also requires that snow and sand stay under a share
  of the view.
- If no candidate passes, it shows the last one.

We take the idea: candidates, a coverage threshold and a fallback. We keep our own definitions. Our
fallback is the best candidate, not the last one, so a draw never gets worse (SC-001). The map is not
re-rolled (spec Assumptions). No code is used.

## R2. What counts as covered

**Decision**: a tile is covered on its level when any object that is not hidden (`HIDDEN_CLASSES`:
events, grail) marks it in its template, either as blocked (passable bit clear) or as visitable
(active bit set). That is the 8×6 template window `maskOffsets` describes. The tiles come from the map
alone: object positions and templates are in `WorldState`, without any archive (FR-005).

The view's coverage is (covered tiles inside the view) / min(view tiles, map tiles), per axis:

- On a map larger than the view, the denominator is the whole view. Cells past the map edge (the
  border band and the black beyond it) count as uncovered, so edge views lose.
- On a map smaller than the view along an axis, the denominator is the map's size on that axis. The
  black around a small map cannot be avoided, so it does not sink every candidate below the threshold.

**Rationale**: the template is what the map stores for every object, so the result is known as soon as
the terrain is. It is the same data the engine already holds on the main thread.

Measured, first candidate (= today's place), 447 maps:

| Coverage definition | p10 | p25 | p50 | p75 | p90 |
| --- | --- | --- | --- | --- | --- |
| blocked ∪ visitable tiles | 0.06 | 0.19 | 0.37 | 0.53 | 0.63 |
| bounding box of those tiles | 0.07 | 0.20 | 0.40 | 0.57 | 0.67 |

The bounding box is a closer stand-in for sprites (h3lwp's choice) but changes the result very little.
The plain footprint is simpler and has no corner cases (objects with holes, L-shaped mountains), so it
is the one we use.

**Alternatives considered**:

- **Sprite bounding boxes or sprite pixels.** These need the sprite archive and the data archive,
  arrive after the terrain is shown, and the view would jump (spec FR-005). Rejected.
- **Normalising by view tiles only.** At 4K (120×68 tiles) most maps are smaller than the view, so the
  black around the map pushed 57 % of draws below the threshold, and after the change still 36 %
  (table in R4). Rejected for the min(view, map) denominator.

## R3. Threshold and attempts

The h3lwp numbers do not carry over. With our definition 0.8 is practically unreachable: 98.8 % of
draws stay below it even after 20 attempts, and p90 of a single view is 0.63.

What a coverage value looks like, from `yarn h3 render` of `Race for Ardintinny.h3m` (144×144) and
`Land of Titans.h3m` (108×108) at 1920×1080:

- **0.02** (Land of Titans, underground): the whole view is black rock with one corner of a cave.
  This is the case the feature exists for.
- **0.2**: two islands at the top, open sea with reefs below. Acceptable, not dull.
- **0.3**: a coast, a snowy town region, sea with islands. Good.
- **0.5**: a dense snow region full of towns, mines and roads.

On maps from 72×72 up, 16.6 % of today's random views are below 0.1. On the 144×144 maps, p10 is 0.00.

Share of draws below the threshold after N candidates (maps ≥ 72×72, 355 maps, one random level per
candidate):

| Threshold | N = 1 (today) | 5 | 10 | 20 | 40 |
| --- | --- | --- | --- | --- | --- |
| 0.2 | 26.5 % | 0.3 % | 0.1 % | 0.0 % | 0.0 % |
| 0.3 | 35.8 % | 2.0 % | 0.8 % | 0.3 % | 0.0 % |
| 0.4 | 47.2 % | 9.1 % | 5.7 % | 3.7 % | 3.1 % |

**Decision**:

- `BUSY_COVERAGE = 0.15` and `CANDIDATES_PER_LEVEL = 10`. On a two-level map with the level setting
  "random" that gives 20 candidates: 10 on the drawn level, then 10 on the other one (spec FR-003).
  Otherwise there are 10.
- Today's place stays the first candidate. About 85 % of draws (R4) are accepted at once and look
  exactly as before, so random places keep their variety.

**Rationale** (owner's decision, 2026-10-28): the only case to avoid is a view of solid black
underground rock. Open sea with reefs, a coast or a sparse plain are all fine. 0.15 sits below the
0.2 view (islands and reefs), which is acceptable, and well above the 0.02 rock view. 0.3 was the
first proposal, from the views that "look good". It was declined because it moves about one draw
in four instead of one in seven, and so narrows random places towards the denser regions for no
gain the owner wants.

## R4. The planned algorithm, simulated

The algorithm (data-model.md "Choice") was replayed over all 447 maps with 50 seeds each and the
R2 denominator.

Threshold 0.15 (the decision):

| View | Draws below 0.15 today | After | Maps ≥ 72: today → after | Draw worse than its first candidate | Mean coverage, first → chosen | Other level chosen |
| --- | --- | --- | --- | --- | --- | --- |
| 1280×720 | 15.2 % | 0.2 % | 17.6 % → 0.0 % | 0 | 0.439 → 0.489 | 1 678 |
| 1920×1080 | 14.6 % | 0.2 % | 17.2 % → 0.0 % | 0 | 0.438 → 0.492 | 2 311 |
| 3840×2160 | 15.2 % | 0.3 % | 18.1 % → 0.1 % | 0 | 0.452 → 0.518 | 3 060 |

Threshold 0.3 (the first proposal, for comparison):

| View | Draws below 0.3 today | After | Maps ≥ 72: today → after | Draw worse than its first candidate | Mean coverage, first → chosen | Other level chosen |
| --- | --- | --- | --- | --- | --- | --- |
| 1280×720 | 26.5 % | 0.3 % | 29.0 % → 0.1 % | 0 | 0.439 → 0.537 | 3 859 |
| 1920×1080 | 25.8 % | 0.4 % | 28.1 % → 0.2 % | 0 | 0.438 → 0.532 | 4 477 |
| 3840×2160 | 23.4 % | 1.1 % | 25.8 % → 1.1 % | 0 | 0.452 → 0.547 | 4 821 |

The draws below 0.15 that remain after the change come from small and nearly empty maps, where no
candidate can do better. SC-002 asks for a quarter of today's share and gets about 1/70 at
1920×1080. SC-001 holds in every
draw (the result is the best candidate, and the first candidate is today's place).

## R5. Cost and where it runs

- A grid of covered tiles plus a summed-area table per level, one pass over the objects, takes 2.6 ms
  warm and 11–24 ms on the first (cold JIT) call. The test maps were `paragon-ultimate-edition.h3m`
  (144×144, 30 015 objects) and `[HotA] The Devil Is in the Detail.h3m` (252×252, 23 803 objects),
  on Node 22 without throttling.
- With the table, one candidate costs four lookups, so 20 candidates cost microseconds.

**Decision**: build the table lazily on the main thread on the first random draw for a world, and
reuse it for later draws on that map. It is cached in the engine under `world.objects`, because
`applyEvent` replaces the `WorldState` object on every time step but keeps the objects map.
`yarn verify budget` records `placeMs`, the first random draw after a map is shown, under 4× CPU
throttling; SC-003 caps it at 20 ms. If the cap is ever exceeded, the table moves into the decode
worker (it is a pure function of the world).

**Alternatives considered**:

- **Build the table in the decode worker and cache it with the world.** This needs a cache schema bump
  and a protocol field for 250 KB of data, for 3 ms of work. Kept as the fallback.
- **Count tiles per candidate without a table.** That is 60×34 lookups per candidate and is fine
  speed-wise too. The table is about as short to write and makes the CLI's candidate listing free.

## R6. Determinism and the controller

- The controller already hands `placeView` a placement seed and a level seed per draw (spec 004/007),
  and nothing there changes.
- The candidates come from one RNG stream of the placement seed: (fx, fy) pairs in order. The first
  pair is exactly the pair drawn today.
- The drawn level is today's level draw. The other level is `1 − drawn`.
- The result depends on the map, both seeds, the level setting and the view size in tiles, that is
  width / scale and height / scale (FR-004).
- Only `{ mode: 'random' }` placements choose. A level change, resize or scale change, and the
  coordinates and centre modes, still arrive as `coords`/`centre` placements and are untouched (FR-007).

## R7. What is affected

- `test/core/render/view-placement.test.ts` checks determinism and the range of a random place. Both
  still hold when no coverage is given, which keeps today's behaviour for callers without a world.
- Browser engine tests use `coords` placements only.
- Host simulations (`yarn verify hosts`) check that random draws differ and that intervals fire, not
  exact coordinates. They are re-run as part of the change.
- Fidelity, the corpus and captures use fixed regions, so they are unaffected (SC-005).

## R8. Results (2026-10-28)

- `yarn verify places` (1920×1080, 50 seeds, 446 distinct maps, 22 300 draws): below 0.15
  14.67 % → 0.23 %, maps ≥ 72×72 17.24 % → 0.01 %; mean coverage 0.438 → 0.493; 2 290 draws
  switched level; no draw below its first candidate, every repeat identical. The grid of the largest
  map (`[HotA] Noble Nemesis.h3m`, 252×252) took 3.6 ms in Node. The whole check runs in under 2 s.
- `yarn verify budget` (4× throttling, 1920×1080): the first random place on a shown map, grid
  included, took 3.8 ms (Arrogance), 10.6 ms (test_map), 11.2 ms (Pandora's Box), 9.1 ms
  (test_map_hota) and 12.9 ms (synthetic 252×252×2), all under the 20 ms limit (SC-003); start-up
  budgets unchanged and passing.
- `yarn test` 553 passed, 11 skipped; `yarn build`, `yarn verify layers`, `yarn verify store-texts`,
  `yarn verify hosts` pass; `yarn verify corpus` unchanged at 15 602 pixels over 82 views (SC-005).
- Seen with `yarn h3 map place "Land of Titans.h3m" --level underground`: that underground stays below
  0.08 everywhere, so with the level fixed the best candidate is shown. It is a cave strip with towns
  rather than solid rock, which is what the owner asked for. Bare cave floor counts as uncovered
  (only objects count), so such a view can score low and still look fine.
