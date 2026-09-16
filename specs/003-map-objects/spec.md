# Feature Specification: Map Objects and Animations

**Feature Branch**: `003-map-objects`

**Created**: 2026-09-16

**Status**: Implemented (2026-09-17) with deviations accepted by the owner — see plan.md "Compliance Review" and research.md "Accepted deviations"

**Input**: User description: "TODO пункт 3.1, объекты и анимации. Здесь же пригодится исправить
инструмент снимков из п.1, чтобы проверить дороги по снимкам игры. (см. результаты последнего
спека)" — TODO item 3.1: map objects, heroes, towns, monsters; draw order; player colors;
animation timings verified against captures. Random-object tiles stay floating in automated
checks. Also fix the item 1 capture tooling so roads (and the other terrain facts still
unconfirmed after spec 002) can be checked against stills of the original game.

## Context

Spec 002 delivered parsers for every base-game format (all H3M object bodies included), a
version-independent world state, and an adventure-map view that draws terrain, rivers, roads
and the map border with palette animation. Automated fidelity checks against stills and clips of
the original game pass on every captured view of `Arrogance.h3m`, but they **exclude every
object's pixels**, because objects are parsed and not drawn.

Spec 002 left these open items:

- Roads are drawn half a tile down, measured only on a map-editor still (editor stills are a
  placement reference, not a pixel baseline). Mud rivers, lava rivers and map corners have never
  been compared with a game still.
- The capture tooling from item 1 has three known defects: stills of views clamped at the top map
  edge record the pixel mapping one tile off (checks report `skip: capture-misaligned`); `still`
  fails on `Shadow Valleys.h3m` (switching to the underground level) and on
  `Merchant Princes.h3m` (the map-reveal cheat). Both failing maps contain roads.

### Primary check map: `test_map.h3m`

The project owner built `test_map.h3m` in the original map editor (SoD, 144×144, two levels,
local-only in `public/dev-assets/` (moved there from `<bundleDir>/Maps` on 2026-09-17, where a symlink
remains for the editor), never committed; sha256 at creation
`6dcdb07d8417f5960e7a197af918ddbacb8433cc90ea4437dc56266506b1b23c`). It is the **primary map for
all automated checks** of this feature (objects, animation, player colors, roads, rivers, levels,
capture tooling). Other maps (`Arrogance.h3m`, `Shadow Valleys.h3m`, `Merchant Princes.h3m`) stay
as secondary cases. Contents measured on 2026-09-16:

- All 10 base terrains on the surface; the underground has dirt, subterranean and rock.
- 2 351 objects, 147 of the 167 object classes and 702 of 1 305 sprites of `Objects.txt`; missing
  classes include tavern, black market, oasis, sanctuary, den of thieves, learning stone, magic
  spring, cover of darkness, refugee camp, rally flag, quest guard, creature generator 4.
- Zones (tile coordinates, level 0 unless noted): random objects almost only in x 0–56, y 17–50
  (other 19×17 views have ≤ 1 % floating tiles); towns of all nine factions, neutral and owned, in
  x 7–33, y 65–97; one hero of each of the eight players in x 55–59, y 63–67; events and the grail
  (never drawn) at x 46–50, y 32–33 and (56, 102); all four river and three road types, 16 tiles
  each, at the top edge x 107–129, y 0–10; underground clear/mud/lava rivers and all road types
  around a 19×17 view at (50, 14) with 102 road tiles; three dwellings underground.
- Players: red human; all eight colors playable and each owns at least one hero; mines, dwellings
  and towns owned by several players and neutral.

This feature makes the adventure map look complete: every visible map object, hero, town and
monster is drawn in the original game's order, with player colors, and animates at the original
game's timing. It also fixes the capture tooling so game stills of road maps can be taken, and
extends the fidelity checks from terrain-only to whole views, objects included.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Objects appear on the map as in the original game (Priority: P1)

A developer opens a map in the development page. Besides terrain, rivers and roads, they see
every map object in the visible area: trees, mountains, lakes and other decorations, mines,
dwellings, resources, artifacts, monsters, heroes, towns, boats, and all other visible objects —
each in the right place, stacked in the right order (objects further down the map cover those
above them; flat objects such as lakes and craters lie under standing ones), and with the owning
player's flag color. Objects the game never draws on the adventure map (events, the grail) are
not drawn.

**Why this priority**: without objects the wallpaper is an empty landscape; placement and order
are the base on which animation and all later features rest.

**Independent Test**: render a captured view of a map with a still frame of all animations and
compare it with the game still — object pixels are now compared instead of excluded.

**Acceptance Scenarios**:

1. **Given** a base-game map and a game still of a view with non-random objects, **When** the
   same view is rendered, **Then** the fidelity check compares object pixels and reports no
   differing pixel outside floating tiles and volatile areas.
2. **Given** two overlapping objects (e.g. a tree in front of a mountain, a hero next to a town),
   **When** the view is rendered, **Then** the one the original game draws on top covers the other.
3. **Given** a mine, dwelling or town owned by a player, **When** rendered, **Then** its flag shows
   that player's color; an unowned flaggable object shows the neutral flag color.
4. **Given** an event object or other object the game hides on the adventure map, **When** the
   view is rendered, **Then** nothing is drawn for it.
5. **Given** a map with objects on both levels, **When** the developer switches level, **Then**
   only the current level's objects are drawn.

---

### User Story 2 - Objects animate at the original game's timing (Priority: P1)

The map is alive: monsters idle, windmills turn, flags wave, campfires flicker, and animated
decorations move, each cycling through its frames in the original order and at the original speed,
together with the terrain palette animation already in place. When nothing changes on screen
between two animation steps, no frame is produced.

**Why this priority**: an animated map is the product; wrong speeds or out-of-sync frames are the
most visible fidelity loss in a wallpaper that runs all day.

**Independent Test**: record a clip of an animated view in the original game and compare frame by
frame with renders of the same view over time — frame order, step duration and the relation
between object and palette animation match.

**Acceptance Scenarios**:

1. **Given** a game clip of a view with animated objects, **When** the fidelity check compares it
   with renders over the same duration, **Then** every compared object frame matches an animation
   step, steps occur in the original order, and the measured step duration matches the game's.
2. **Given** a still capture (animation phase unknown), **When** compared, **Then** the check finds
   an animation state in which all compared object and terrain pixels match, allowing the same
   one-step lag between sprites that spec 002 measured for palette animation.
3. **Given** the same map, camera and time, **When** rendered repeatedly, **Then** the output is
   identical bit for bit.
4. **Given** the wallpaper is hidden or paused, **When** time passes, **Then** no frames are
   produced and no animation timers run; on resume animations continue from the current time.

---

### User Story 3 - Game stills can be taken on any base-game map, roads confirmed (Priority: P2)

The developer (or an agent) requests stills and clips on maps where the capture tooling used to
fail — views at the top map edge, the underground level of `Shadow Valleys.h3m`, and
`Merchant Princes.h3m` — and gets correct captures. With these, roads, mud and lava rivers and
map corners are compared with game stills, and the road placement measured on an editor still is
confirmed or corrected.

**Why this priority**: it removes the last unconfirmed terrain facts from spec 002 and widens the
set of maps the object checks can use, but the renderer can progress on the maps that already
capture correctly.

**Independent Test**: run the capture commands on the three failing cases and then the fidelity
check on the resulting captures, without human involvement.

**Acceptance Scenarios**:

1. **Given** a view requested at the top map edge, **When** a still is captured, **Then** its
   recorded pixel mapping is correct and the fidelity check no longer reports it as misaligned.
2. **Given** `Shadow Valleys.h3m`, **When** a still of its underground level is requested,
   **Then** the capture succeeds and shows the underground level.
3. **Given** `Merchant Princes.h3m`, **When** a still is requested, **Then** the map is revealed
   and the capture succeeds.
4. **Given** game stills with road tiles, **When** the fidelity check runs, **Then** road pixels
   are compared and match, or the road placement is corrected and recorded until they do.
5. **Given** the tooling cannot capture a requested view for a reason it can detect, **When** the
   command ends, **Then** it fails with a specific error and a failure screenshot, never a capture
   with a wrong mapping.

---

### User Story 4 - Agent inspects objects and their drawing from the command line (Priority: P3)

An agent investigating a mismatch lists the objects drawn in a region in draw order with their
sprite, frame group, current frame at a given time, flag color and screen position, and renders a
region with objects at a chosen time.

**Why this priority**: mismatches in draw order and timing are hard to diagnose from images alone;
the constitution requires inspection tools for every visible feature.

**Independent Test**: run the inspection commands on a map and check the output against the map's
parsed objects.

**Acceptance Scenarios**:

1. **Given** a map and a region, **When** the agent asks for the draw list, **Then** it gets every
   drawn object in draw order with sprite name, anchor tile, screen position, frame at the given
   time and player color, as one machine-readable document.
2. **Given** a map, a region and a time, **When** the agent renders it, **Then** the image includes
   objects in the state they have at that time.

---

### Edge Cases

- A random object (random monster, artifact, resource, dwelling, town, hero) or a hero the game
  generates at a player's main town: the renderer shows one deterministic outcome allowed by the
  object's constraints, chosen by the seeded generator; its tiles stay floating in automated
  checks.
- An object whose sprite file is missing from the supplied archives: the rest of the map renders;
  a diagnostic names the missing sprite; nothing crashes.
- An object template that references a sprite with unexpected groups or frame counts: rendered
  with what the sprite provides, reported by the inspection tools.
- Objects whose sprites extend beyond the map edge or into the border: drawn and clipped the way
  the game draws them.
- Objects on tiles hidden behind taller objects or at the viewport edge: sprites of objects whose
  anchor lies outside the viewport but whose image reaches into it are still drawn.
- A hero standing inside a town or on a visitable object's entrance, a hero placed on water (in a
  boat): drawn as the game draws them; the boat case is verified only where a capture of such a hero
  exists (`test_map.h3m` has none), otherwise it is a known gap of this feature.
- The sprite archive is supplied but not the data archive (`h3bitmap.lod`): terrain renders,
  objects are not drawn, and a diagnostic says which file is missing.
- Very dense maps (thousands of objects) and the 252×252 stress map: frame work and memory still
  depend on the visible area, not on the number of objects on the map.
- A still that catches an object animation mid-update (one sprite a step behind another).
- Captures on which the reveal cheat or level switch still fails for a map-specific reason: the
  capture command fails explicitly and the case is recorded as a known limitation.

## Requirements *(mandatory)*

### Functional Requirements

**Objects on the map**

- **FR-001**: The renderer MUST draw every object of the world state that the original game shows
  on the adventure map, for the visible area and current level, using the object's sprite from the
  supplied archives, anchored and placed as the original game places it.
- **FR-002**: Objects MUST be drawn in the original game's order, including the distinction between
  flat objects drawn under others and standing objects, and the ordering between overlapping
  objects, heroes and towns. The draw order rule MUST live in one typed data/rule module.
- **FR-003**: Objects the game does not show on the adventure map (e.g. events, grail) MUST NOT be
  drawn; the set of hidden object classes MUST be a typed data table.
- **FR-004**: Flags and player-colored parts of objects (towns, mines, dwellings, heroes, boats,
  lighthouses, garrisons and other ownable objects) MUST show the owning player's color, or the
  neutral color when unowned, matching the original game's player colors.
- **FR-005**: Heroes placed on the map MUST be drawn with the adventure-map sprite of their class
  and their player's flag, in the facing direction the game uses for a hero that has not moved.
  Heroes the game generates at players' main towns MUST be drawn as the game places them.
- **FR-006**: Towns MUST be drawn with the sprite the game uses for their faction and fort state.
- **FR-007**: Random objects and generated heroes MUST be resolved to one concrete, allowed outcome
  by the seeded generator, deterministically for a given map and seed. Their tiles MUST remain
  floating in automated checks.
- **FR-008**: Shadows and other special sprite pixels MUST be drawn as the original game draws them
  (translucent shadow, transparent background, colored flag pixels).

**Animation**

- **FR-009**: Animated objects MUST cycle through their frames in the original order and at the
  original game's step duration; the duration and the relation between object steps and the
  palette animation step MUST be measured on game clips and recorded in a typed data module.
- **FR-010**: All animation (objects and palette) MUST remain a deterministic function of data,
  state, camera and time from the injectable clock.
- **FR-011**: Frames MUST be produced only when something visible changes; when object animation
  and palette animation step at different moments, only those moments produce frames. No frames
  or timers while hidden or paused.

**Performance**

- **FR-012**: Per-frame work, draw calls and graphics memory for objects MUST scale with the
  visible area, not with the number of objects or the map size; sprite decoding stays off the main
  thread and cached as in spec 002.
- **FR-013**: The runtime bundle, start times and memory MUST stay within the constitution's
  budgets on the 252×252 two-level stress map with objects on it.

**Fidelity checks**

- **FR-014**: The fidelity check MUST compare object pixels of non-random objects instead of
  excluding them; only floating tiles, volatile areas outside animated sprites, and viewport UI
  remain excluded. Every exclusion is reported per cause, as in spec 002.
- **FR-015**: Still comparison MUST search animation states covering both object and palette
  animation; clip comparison MUST verify frame order and step duration of object animation.
- **FR-016**: The headless checks MUST use `test_map.h3m` as the primary map and MUST cover at least: flat vs standing order, overlapping standing
  objects, a hero, a town, an owned flaggable object of a non-neutral player, an animated monster,
  and an animated decoration, each in a still or clip from the original game.

**Capture tooling fixes**

- **FR-017**: Stills of views clamped at the top map edge MUST record the correct pixel mapping.
- **FR-018**: Capturing the underground level MUST work on maps where the level switch used to
  fail (`Shadow Valleys.h3m`), and revealing the map MUST work on maps where it used to fail
  (`Merchant Princes.h3m`); the causes MUST be identified and recorded.
- **FR-019**: When the tooling cannot position, reveal or switch level, it MUST fail with a
  specific error and failure screenshot; a capture with an unverified pixel mapping MUST NOT be
  stored.
- **FR-020**: Road placement, mud and lava river palette animation, and map-border corners MUST be
  checked against game stills, first of all on `test_map.h3m` (surface top-edge and underground
  road/river zones; other base-game maps allowed); the results MUST
  be recorded, and any correction applied to the renderer's data tables.

**Inspection**

- **FR-021**: An inspection command MUST list the objects drawn in a region in draw order with
  sprite, anchor tile, screen position, frame at a given time and player color.
- **FR-022**: The existing region render command MUST include objects at the requested time.
- **FR-023**: The development page MUST show objects and their animation.

### Key Entities

- **Map object (drawn)**: an object of the world state with its sprite, anchor tile, level, class,
  owner, flat/standing kind and draw-order key; random objects carry their resolved outcome.
- **Object sprite**: frames and frame groups of a sprite file, with transparent, shadow and
  player-color pixel indices, and its footprint on the map.
- **Animation timing**: object animation step duration and its relation to the palette step,
  measured from game clips.
- **Player color**: the colors that replace the flag pixels for each player and for neutral, read
  from the user's game files (never stored in the project).
- **Draw list**: the ordered set of sprite frames the renderer draws for a view at a time; what the
  inspection command reports.
- **Capture**: a still or clip from item 1 with its recorded pixel mapping; now also of road maps,
  the underground level of previously failing maps and top-edge views.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On captured still views of every zone of `test_map.h3m` listed in Context (both
  levels) and on the existing `Arrogance.h3m` views, the fidelity check reports
  0 differing compared pixels, objects included, with compared pixels ≥ 25 % of in-map viewport
  pixels or an explicit not-checkable outcome with causes.
- **SC-002**: At least one game clip with animated objects passes: every compared frame matches, all
  object and palette steps occur in order, and the measured object step duration equals the
  recorded duration within one capture frame.
- **SC-003**: Stills and clips of every zone of `test_map.h3m` can be captured, and the three
  previously failing capture cases (top-edge view, `Shadow Valleys.h3m`
  underground, `Merchant Princes.h3m`) produce captures; no still of the checked maps is reported as
  misaligned.
- **SC-004**: Game stills of the `test_map.h3m` road/river zones on both levels (each with 10 or
  more tiles of every road type present) pass the fidelity check.
- **SC-005**: All budgets from the constitution pass on the stress map with objects (runtime JS
  ≤ 100 KB gzipped, warm start ≤ 2 s, cold start ≤ 10 s, memory ≤ 300 MB), and frame work does
  not grow with the number of objects on the map.
- **SC-006**: Rendering the same view at the same time twice gives identical images in every
  determinism run.
- **SC-007**: Every base-game map in the install renders its visible objects without errors (any
  missing sprite reported as a diagnostic).
- **SC-008**: No game files or anything derived from them appear in the repository.

## Assumptions

- Baseline and capture environment are those of specs 001 and 002 (original `Heroes3.exe` under
  Wine, no HotA/HD Mod). HotA objects and maps stay out of scope.
- The map is shown fully revealed (no fog of war), as in the reference captures; hero movement,
  battles, capturing and other interactive changes are later features (TODO 3.4). Heroes stand
  still; only their idle presentation is drawn.
- Random objects show a seeded outcome; checking specific random outcomes against the game is not
  automated (floating tiles, as decided in items 1–2). An object atlas for visual review may be
  built on a separate branch if needed.
- Object placement facts measured in spec 002 (bottom-right anchor, heroes one tile right of their
  standing tile, draw order candidates) are starting points to be confirmed by captures.
- Map-editor stills remain a placement reference only; pixel checks use game stills.
- The reveal cheat, level switch and minimap-based positioning of item 1 remain the capture
  approach; the fixes change how they are driven or verified, not the baseline.
- `test_map.h3m` is the primary check map for this and later features; any base-game map from the
  configured install may also be used. If the owner edits the map, zone coordinates in Context and
  its recorded hash are updated, and captures of the old version are pruned.
