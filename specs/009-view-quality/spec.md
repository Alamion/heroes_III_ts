# Feature Specification: Busy random places

**Feature Branch**: `009-view-quality`

**Created**: 2026-10-28

**Status**: Implemented

**Input**: User description: "View quality for random places: when the wallpaper picks a random place on a map (start, "new random place now", map rotation), it should not show an empty or nearly empty view (open sea, bare terrain, black unexplored edge). Idea from h3lwp (study only, GPL-3.0): reroll the random view while the share of the viewport covered by object sprites is below a threshold (about 0.8 there), then try the other level; give up after a bounded number of attempts and keep the best candidate. Must stay deterministic per seed, run on data only (world state + render objects, no rendering), and ship with a headless data-level check."

Source of the idea (study only, never copy code; AGENTS.md "Reference material"): h3lwp
(`context/heroes_iii_android`, GPL-3.0) rolls up to 20 candidate views. It accepts the first one where
object sprites touch at least 80 % of the view's tile cells, and shows the last one if none passes.
This spec takes the idea, not the numbers: the threshold and the number of attempts are measured on
our own maps (see Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A random place shows the map, not emptiness (Priority: P1)

A user sets the wallpaper to "Random place", which is the default view mode (spec 004 FR-003a). It
lands on a new place at every start, every map change, every "new random place now" and every
re-roll timer. Today the place is uniform over the map, so on many maps a share of those views is
open sea, a wide empty plain or mostly the black area past the map edge. The user sees a wallpaper
that looks broken or boring. With this feature, the place is one where the map has something to show
(towns, forests, mountains, mines, monsters, coast) whenever the map has such a place.

**Why this priority**: it is the whole feature. A random place is what most users see, and an empty
view is the most common "it looks wrong" impression on large maps.

**Independent Test**: a headless check draws many random places on real maps and on synthetic maps
with known empty and busy regions, at a fixed viewport. It measures how much of each chosen view is
covered by map objects and compares with the uniform draw used today.

**Acceptance Scenarios**:

1. **Given** a map that is mostly open water with one busy island, **When** a random place is drawn,
   **Then** the view shows the island (its coverage reaches the threshold), not open water.
2. **Given** a map where busy places exist, **When** random places are drawn with many seeds,
   **Then** the share of views below the threshold is much smaller than with today's uniform draw
   (SC-002).
3. **Given** any map, **When** a random place is drawn, **Then** the chosen view is never less
   covered than the first candidate of that draw (the feature can only improve a place).
4. **Given** a map with no place that reaches the threshold (a nearly empty map), **When** a random
   place is drawn, **Then** the best candidate found is shown, without an error or a message.

---

### User Story 2 - The other level when this one is empty (Priority: P2)

With the level setting "random" on a two-level map, the drawn level may be the one with little on it,
for example an underground that is mostly rock. Candidates are then also tried on the other level. A
fixed level setting ("surface", "underground") is respected: only places on that level are tried.

**Why this priority**: it extends US1 to the level choice. It matters only on two-level maps, and only
when one level is much emptier.

**Independent Test**: a synthetic two-level map has an empty underground and a busy surface (and the
reverse). With level "random", every chosen view is on the busy level; with a fixed level it is
always on that level.

**Acceptance Scenarios**:

1. **Given** a two-level map with an empty underground and level "random", **When** random places are
   drawn with many seeds, **Then** the chosen views are on the surface whenever the underground
   candidates fall below the threshold.
2. **Given** the level setting "underground", **When** a random place is drawn, **Then** the view is
   on the underground even if the surface is busier.
3. **Given** a one-level map, **When** a random place is drawn, **Then** only surface places are tried.

---

### User Story 3 - Reproducible and quick (Priority: P3)

A developer reproduces a reported view from the seed, map and viewport, as with every other random
choice in the project (constitution III). The extra choosing does not make the start noticeably
slower on the largest maps.

**Why this priority**: it is a quality guarantee for P1 and P2, not new user value.

**Independent Test**: the same check repeats each draw and compares results; it also times the
choice on the largest local map.

**Acceptance Scenarios**:

1. **Given** the same map, seed, level setting and viewport, **When** a random place is drawn twice,
   **Then** the same level and position are chosen.
2. **Given** the largest local map (252×252, two levels) and a 1920×1080 view, **When** a random place
   is drawn, **Then** the choice stays within the time in SC-003.

### Edge Cases

- **Map smaller than the view** (for example 36×36 at ×1 on 1920×1080): the position is fixed
  (centred), so only the level can change. Candidates then differ only by level.
- **View past the map edge**: a view may reach into the border band (spec 004). The black area past
  the edge holds no objects, so it counts as uncovered, and edge views lose against inner ones.
- **Objects switched off** or **no data archive yet**: the place is chosen the same way. The map's
  objects are a property of the map, whether or not they are drawn yet, so the place does not depend
  on what has loaded and never jumps when objects appear later.
- **Viewport or scale change**: the shown place is kept as fractions (spec 004 FR-003a). The new view
  size never triggers a new draw.
- **Coordinates and centre modes** are unchanged. The user chose the place, so it is never moved.
- **Map folder rotation** (spec 007): the map is chosen as today. This feature only chooses the place
  and level in the chosen map; it never skips a map.
- **Hidden random objects** (random monsters and the like) count as objects: they are drawn as some
  object in every case.
- **Broken or unusual objects** (a template the tables do not know, a sprite that fails to load):
  the object still counts by the area the map says it occupies; a failure never aborts the choice.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the view mode is "random" and a new random place is drawn (start, map change,
  switch to "random", "new random place now", the re-roll timer), the system MUST choose a place
  whose view is busy enough rather than a uniformly random one. "Busy enough" means that the
  **coverage** reaches the **threshold**. Coverage is the share of the view's tiles that map objects
  occupy or overlap.
- **FR-002**: The system MUST try a bounded number of candidate places per draw, stop at the first
  candidate that reaches the threshold, and otherwise use the most covered candidate. Ties go to the
  earlier candidate, so the result is still a random place.
- **FR-003**: With the level setting "random" on a two-level map, candidates MUST cover both levels.
  The first candidates are on the drawn level; once those fail, the other level is tried. With a fixed
  level setting or on a one-level map, all candidates MUST be on that level.
- **FR-004**: The choice MUST be a deterministic function of the map, the draw's seed, the level
  setting and the view size in tiles. The same inputs MUST give the same level and position.
- **FR-005**: Coverage MUST be computed from map data alone (the map's objects and where they sit),
  with no rendering, no sprite archive and no data archive. The place is then known when the terrain
  is first shown and never changes when objects arrive.
- **FR-006**: The chosen place MUST be reported and kept in the same form as today (level plus the
  two fractions), so that level changes, resizes and the coordinates sliders keep working unchanged.
- **FR-007**: Coordinates mode, centre mode, a resize, a scale change and other setting changes that
  keep the place today MUST NOT run the choice.
- **FR-008**: A data-level headless check MUST cover FR-001 to FR-004 on synthetic maps with known
  busy and empty regions. A report over the local real maps (when present, skipping with a reason
  otherwise) MUST give, per map, the share of views below the threshold before and after the change.
- **FR-009**: The choice MUST be inspectable from the command line for one map and seed: which
  candidates were tried, their coverage and which one won. A reported view can then be explained
  without opening a host.
- **FR-010**: A draw that finds no candidate at the threshold is normal behaviour: no user message,
  only a debug-level log line with the best coverage found.

### Key Entities

- **Candidate place**: a level and a view position (as fractions of the reachable range), drawn from
  the draw's seed, with its coverage.
- **Coverage**: the share (0–1) of the view's tile cells that a map object occupies or overlaps.
  Cells past the map edge count as uncovered. On a map smaller than the view along an axis, only the
  map's extent along that axis is counted there, because no place can avoid that black (research R2).
- **Threshold** and **attempt limit**: two tuned constants with their measurements recorded in the
  spec's research. They are not user settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On every map, every chosen place is at least as covered as the first candidate of its
  draw, which is the place today's uniform draw would show.
- **SC-002**: Over the local real maps (Complete and HotA installs), at 1920×1080 and scale ×1, with
  at least 50 seeds per map, the share of random places below the threshold drops to at most a quarter
  of today's share. The baseline is measured before the change and recorded in the research.
- **SC-003**: Choosing a place on the largest local map (252×252, two levels) at 1920×1080 adds at
  most 20 ms to a draw under the 4× CPU throttling used by the budget check. Start-up budgets
  (constitution "Technical Constraints & Budgets") still pass.
- **SC-004**: The same map, seed, level setting and view size give the same place in 100 % of
  repeated draws.
- **SC-005**: Nothing that is not a random place changes: coordinates and centre views, fidelity
  checks and the capture corpus give identical results.

## Assumptions

- **No new setting.** Busy places become the behaviour of "Random place" on every host. Today's
  uniform draw stays as the first candidate, so a map with nothing anywhere behaves as before.
- **Threshold and attempt limit are measured, not copied.** h3lwp uses 0.8 and 20 attempts for a phone
  screen and sprite bounding boxes. Our views are larger (about 60×34 tiles on 1920×1080 at ×1) and
  coverage comes from the map's object footprints. Planning measures the coverage distribution on the
  local maps and picks both values; the starting point to measure is 0.8 and 20.
- **Object area from the map itself**: an object's area is what the map stores for it (the template's
  occupied and visible tiles). A sprite's exact drawing would need the archives and would arrive too
  late (FR-005). Edge case to measure in planning: objects whose drawing is much larger than their
  footprint.
- **Terrain is not judged.** Coast, rivers and roads do not count. Neither does "too bright" terrain
  (h3lwp's dark-mode check): that is a different, optional idea, not part of this spec.
- **Map choice in a folder is out of scope.** h3lwp also re-rolls the map; here the map is chosen by
  spec 007 rules (filters, rotation order), and only the place inside it is improved.
- The re-roll timer, "new random place now" and the controller's seed sequence stay as in spec 004 and
  007. Only what one draw does with its seed changes.
