# Feature Specification: Foundation Rewrite

**Feature Branch**: `002-foundation-rewrite`

**Created**: 2026-09-14

**Status**: Implemented (2026-09-15) — see plan.md "Compliance Review" for deviations and known gaps

**Input**: User description: "см. второй пункт TODO" — TODO item 2: the layered structure, format
parsers, a renderer that only draws what's on screen, the headless checking scripts and budget
checks. Scope: LOD (base game), DEF, PCX, H3M RoE/AB/SoD (full object details parsed, even if
only terrain/rivers/roads are rendered at first), world-state model, terrain renderer with
palette-lookup animation, browser dev harness, inspection CLIs, budget checks. Carried-over
requirement from item 1: the H3M object parser must list tiles covered by random objects (whole
sprite footprint) so reference checks can treat them as floating.

## Context

The code in `src/` is a proof of concept that renders terrain of SoD maps but fails the project
constitution: it sizes its drawing surface to the whole map (a 252×252 map crashes the GPU
driver), re-bakes images for every palette animation step, guesses byte skips when reading map
objects, cannot read compressed or HotA archives, and decodes sprites slowly. Item 1 delivered a
reference environment that captures stills and clips from the original game; nothing consumes
those captures yet.

This feature replaces the proof of concept with the foundation every later feature builds on:
reading the base game's files correctly, a version-independent world state, an adventure-map
terrain view (terrain, rivers, roads, animated) whose cost depends on the screen and not on the
map, a browser page for development, command-line inspection tools, and the automated checks —
data-level, image-level against reference captures, and budget — that prove fidelity and
performance without a human. Map objects are parsed completely but drawn by a later feature.

## Clarifications

### Session 2026-09-14

- Q: Can image-level fidelity checks always run automatically, given that many maps re-roll
  random monsters and dwellings on every launch (item 1 could not make generation static)? →
  A: No. Automated image checks apply only where randomness does not dominate: random-object
  footprints are excluded, and a map region whose comparable area falls below a threshold is
  reported as "not checkable automatically" (an explicit outcome, neither pass nor fail) and left
  to less frequent visual review. Check regions are chosen with little randomness.
- Q: Which maps may checks and tests use? → A: Any map from the local game install's `Maps`
  folder (224 files, configured via the item 1 reference-environment config), plus the game's own
  data archives there; `public/dev-assets/` holds only the developer's examples and is not a
  limit. Local-only rules still apply: nothing from those files is committed.

### Session 2026-09-14 (analysis follow-up)

- Q: What if a region's compared share is low for reasons other than randomness (dense objects,
  volatile areas)? → A: Also "not checkable automatically", with causes listed; no region passes
  on a near-empty comparison.
- Q: Are water/lava pixels excluded because the still's volatile mask marks them? → A: No; they
  are compared by matching the palette animation step.
- Q: Are heroes generated at players' main towns (not in the map's object list) handled? → A: Yes,
  their possible sprite area is floating (the hero class is random).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent inspects game files from the command line (Priority: P1)

A coding agent needs to know what is inside the user's game files: the entries of a LOD archive,
the groups, frames and palette of a DEF sprite, a PCX image, the header, tiles and objects of an
H3M map. It runs an inspection command naming the file (and optionally an entry, a tile, or an
object) and gets a machine-readable description, or a PNG of a decoded frame/image. No browser
is involved.

**Why this priority**: every other story depends on correct parsing; inspection tools make
parsing verifiable and let agents debug without a UI (Constitution III, VII).

**Independent Test**: with the dev assets present, list `H3sprite.lod`, dump a terrain DEF from
it and export one frame as PNG, and dump `Arrogance.h3m` header, tile (10, 12, surface) and its
object list; all complete and the values match known values recorded in the tests. With the
dev assets absent, the same tests skip with a clear message and synthetic-fixture tests still
pass.

**Acceptance Scenarios**:

1. **Given** `H3sprite.lod`, **When** the agent lists it, **Then** every entry is reported with
   name, size, and compression, and any entry can be extracted byte-exact (compressed entries
   included).
2. **Given** a DEF entry, **When** the agent dumps it, **Then** it gets type, dimensions, groups
   with frame names, per-frame offsets and sizes, and can export any frame as a lossless PNG with
   correct palette and transparency/shadow indices reported.
3. **Given** `Arrogance.h3m`, **When** the agent dumps it, **Then** it gets format version, size,
   levels, players, victory/loss conditions, every tile (terrain, terrain view index, river,
   road, mirroring flags) and every object with its template and fully decoded type-specific
   details (e.g. monster count and disposition, town buildings, hero army, event contents).
4. **Given** a map whose format the base game does not support (`По праву силы.h3m`, HotA),
   **When** the agent dumps it, **Then** the command fails with a typed "unsupported version"
   error naming the file and version, without partial garbage output.
5. **Given** a truncated or corrupted file, **When** it is parsed, **Then** a typed error names
   the file, byte offset, format version and structure being read.

---

### User Story 2 - Agent gets floating tiles for a map (Priority: P1)

An agent running a reference reproducibility check (`yarn ref selfcheck`) on a map needs the
tiles whose appearance changes between game launches because of random map objects. It asks the
map inspection tool for the floating tiles of a level (optionally within a region) and passes the
result to the reference tooling instead of typing them by hand.

**Why this priority**: an explicit requirement carried over from item 1; without it
reproducibility checks on maps with random objects need hand-maintained tile lists.

**Independent Test**: for `Arrogance.h3m`, the reported floating tiles for the view centred on
(18, 18) include `20,24;21,24;20,25;21,25` (recorded in spec 001 research), and a selfcheck run
using the reported list passes.

**Acceptance Scenarios**:

1. **Given** a map with random monsters, artifacts, resources, dwellings, random towns or random
   heroes, **When** floating tiles are requested, **Then** every tile any possible outcome of each
   random object can draw on is listed (for monsters the 2×2 sprite area up and left of the object
   tile, not only the object tile), per level.
2. **Given** the output of the floating-tiles request, **When** it is passed to the reference
   tooling, **Then** it is accepted in the tooling's tile-list format without conversion by hand.
3. **Given** a map with no random objects, **When** floating tiles are requested, **Then** an
   explicit empty result is returned.

---

### User Story 3 - Developer views an animated terrain map in the browser (Priority: P1)

The developer opens the development page in a browser, selects game files (the sprite archive
and a map) from disk, and sees the adventure map's terrain, rivers, and roads at native 32 px
tiles filling the window, with water, lava and other rotating-palette terrain animated at the
original game's speed. They can scroll the view, switch between surface and underground, and
resize the window. Opening the huge 252×252 map behaves the same as a small one once parsing is
supported for its format; for now a large base-game map is used.

**Why this priority**: the visible product; proves that parsing, state and rendering fit
together and replaces the proof of concept.

**Independent Test**: open the page, load `H3sprite.lod` and `Arrogance.h3m`, see the terrain of
both levels, scroll across the whole map, and watch water animate; reload the page and the map
appears again without decoding the files from scratch.

**Acceptance Scenarios**:

1. **Given** the page is open, **When** the developer supplies a sprite archive and a base-game
   map, **Then** the terrain, rivers and roads of the current view appear with correct tile
   choice and mirroring.
2. **Given** a map is shown, **When** the developer scrolls or switches level, **Then** the view
   updates immediately and never shows gaps inside the map area; outside the map edge a
   consistent border is drawn.
3. **Given** water or lava is visible, **When** time passes, **Then** its colors cycle through the
   same steps and at the same rate as in the original game, and nothing is re-drawn while nothing
   visible changes.
4. **Given** the page is hidden (another tab, minimized), **When** it becomes hidden, **Then**
   drawing and animation timers stop, and resume when it becomes visible.
5. **Given** the same files were loaded before, **When** the page is reloaded and the files are
   supplied again, **Then** decoded data is reused from the local cache.
6. **Given** a map cannot be read (unsupported or corrupted), **When** it is supplied, **Then**
   the page stays responsive and shows a short, non-intrusive diagnostic instead of crashing.

---

### User Story 4 - Agent verifies terrain fidelity against the original game (Priority: P2)

An agent changes terrain rendering and needs to know whether it still matches the game. It runs
one command that renders a map region headlessly at a given animation time, finds the matching
reference captures (via the item 1 capture index), aligns them by tile, masks volatile and
floating areas and non-terrain content, and reports matching and differing pixels with a diff
image.

**Why this priority**: required by Constitution III for every visible feature; comes after the
renderer exists.

**Independent Test**: capture a still and a clip of an Arrogance region with the reference
tooling; the fidelity command reports zero differing terrain pixels for the still, and for the
clip finds a render time whose water pixels match each captured animation step; deliberately
breaking terrain mirroring makes the command fail and the diff image highlights the broken tiles.

**Acceptance Scenarios**:

1. **Given** reference captures exist for a region, **When** the fidelity check runs, **Then** it
   produces a machine-readable report (captures used, compared/ignored/differing pixel counts per
   tile) and a diff image, and exits non-zero when non-ignored pixels differ.
2. **Given** captured tiles are covered by map objects, heroes, UI or random objects, **When** the
   check runs, **Then** those pixels are excluded using the parsed object data and the capture's
   volatile mask, and the report states how many pixels were excluded and why.
3. **Given** no capture exists for the region or the game files are absent, **When** the check
   runs, **Then** it skips with an explicit message.
4. **Given** a region where random monsters, dwellings, other objects or volatile areas cover so
   much that the compared pixels fall below the plan's threshold, **When** the check runs,
   **Then** it reports the region as "not checkable automatically" with the excluded share per
   cause and the causing random objects, exits without failure, and lists the region for visual
   review.
5. **Given** a map region rendered twice with the same data, camera and time, **When** the images
   are compared, **Then** they are identical.

---

### User Story 5 - Budget checks guard performance (Priority: P2)

Before merging, an agent runs the budget checks. They build the wallpaper runtime and measure its
size, then load maps of different sizes headlessly at 1920×1080 with CPU throttling and measure
start-up time (cold and warm), memory, drawing surface size, draw work per frame, frames produced
while idle, and frames produced while hidden. The result is a machine-readable pass/fail report
against the constitution's budgets.

**Why this priority**: Constitution IV requires automated budget enforcement; it guards against
repeating the proof of concept's crash.

**Independent Test**: run the budget checks on the current build and get a passing report;
introduce a change that sizes the surface to the map and the check fails naming the surface
budget.

**Acceptance Scenarios**:

1. **Given** a build, **When** budget checks run, **Then** each budget from the constitution is
   reported with measured value, limit, and pass/fail, and the command exits non-zero on any
   failure.
2. **Given** a small (36×36) and the largest available base-game map, **When** per-frame work and
   memory are measured, **Then** the difference between them stays within the tolerance stated in
   the plan (work scales with the viewport, not the map).
3. **Given** a synthetic 252×252 two-level map built from committed fixtures, **When** it is
   loaded, **Then** the same budgets hold, so the size stress test does not wait for HotA support.

---

### User Story 6 - Contributors work on a clean layered codebase (Priority: P3)

A contributor (human or agent) adding a later feature (objects, adapters, saves) finds the code
split into formats → state → simulation → renderer → adapters, with game data tables in typed
modules, one logger, updated development guide (stack, layout, commands), attribution for ported
code, and the proof of concept removed.

**Why this priority**: long-term maintainability; follows naturally from the other stories.

**Independent Test**: an automated check confirms no lower layer imports a higher layer, parsers
and state run in Node without a browser, and the runtime has no platform-specific references;
AGENTS.md commands all work.

**Acceptance Scenarios**:

1. **Given** the repository, **When** the layer check runs, **Then** it passes, and a deliberate
   import from the renderer into a parser makes it fail.
2. **Given** code ported from `context/homm3-parser`, **When** the repository is inspected,
   **Then** a third-party notices file lists it with its license.
3. **Given** the Windows-only sync script, **When** this feature is done, **Then** it is removed or
   replaced by a Linux-compatible step, and AGENTS.md no longer lists it as broken.

---

### Edge Cases

- LOD entries that are compressed, zero-sized, or have duplicate names; entry names with
  unusual casing (lookup is case-insensitive as in the game).
- HotA LOD archives with encrypted names or unsupported compression: reported as unsupported,
  not misread.
- DEF frames using different compression formats, frames with zero size, and palette indices
  reserved for transparency and shadows.
- H3M files are gzip-compressed; uncompressed map files are also accepted.
- H3M objects of every class in RoE/AB/SoD, including object types with no extra data, quest
  guards and seer huts with version-dependent layouts, events, and objects referring to missing
  templates: all decoded or reported as explicitly unsupported, never skipped by guess.
- Maps without underground; maps of every standard size (36, 72, 108, 144) and the non-standard
  sizes encountered in community maps.
- The view near map edges and corners, and window sizes larger than the whole map.
- Very large windows and high device pixel ratios: the surface is still bounded by the display.
- The graphics device context is lost (e.g. driver reset): the view recovers without a reload.
- The user supplies the files in the wrong slot (a map where the archive is expected) or a
  sprite archive without terrain sprites.
- The local cache is unavailable (private mode, storage full) or holds data from a different
  file with the same name: it is keyed by file identity and the app still works without it.
- Parsing a large map must not freeze the page.

## Requirements *(mandatory)*

### Functional Requirements

**Formats**

- **FR-001**: The system MUST read base-game LOD archives: list entries and extract any entry
  byte-exact, including compressed entries, with case-insensitive lookup.
- **FR-002**: The system MUST decode DEF sprites (all compression variants used by the base
  game): type, groups, frames, frame offsets and full-size bounding boxes, and palette, producing
  palette-indexed frames so palette animation needs no re-decoding.
- **FR-003**: The system MUST decode base-game PCX images (palette-indexed and true-color).
- **FR-004**: The system MUST parse H3M maps of RoE, AB and SoD formats completely: header,
  players, victory/loss conditions, teams, allowed heroes/artifacts/spells/skills, rumors, hero
  customizations, all tiles, object templates, and every object with its type-specific details,
  and global events. HotA and other versions MUST produce a typed unsupported-version error.
- **FR-005**: All parsers MUST be bounds-checked, MUST NOT use fixed skips for variable-length
  structures, and MUST fail with typed errors carrying file name, byte offset, format version,
  and structure. Parsers MUST run without a browser.
- **FR-006**: The system MUST compute, for each level of a parsed map, the floating tiles: every
  tile that any possible outcome of a random object can draw on (random monsters of all levels,
  random artifacts of all classes, random resources, random dwellings of all kinds, random towns,
  random heroes, and heroes the game generates at players' main towns, whose class is random),
  covering the largest sprite footprint an outcome can have.

**World state and simulation**

- **FR-007**: Parsed maps MUST be converted into a version-independent world state holding
  terrain, rivers, roads, all objects with ownership and details, heroes with positions and
  armies, towns, and the day, and able to represent what a save file adds (visited and removed
  objects, moved heroes, changed ownership) without a later restructuring.
- **FR-008**: The state MUST be changeable only through simulation events, with at least the
  passage of animation time implemented in this feature; the renderer MUST only read state.
- **FR-009**: Game data tables used by this feature (terrain types and their sprites, palette
  rotation ranges and speed, river/road types, object class identifiers, player colors) MUST live
  in typed data modules.

**Rendering**

- **FR-010**: The renderer MUST draw terrain, rivers and roads for the visible viewport and level
  at native 32 px tiles with tile choice and mirroring matching the original game.
- **FR-011**: Palette-rotating terrain (water, lava, and any other rotating ranges in the base
  game) MUST animate by palette lookup with the original game's rotation ranges, direction, and
  timing; no per-step images may be created.
- **FR-012**: Rendering MUST be a deterministic function of data, state, camera, and time; time
  MUST come from an injectable clock and randomness from a seeded generator.
- **FR-013**: The drawing surface MUST never exceed display size × device pixel ratio; per-frame
  work and graphics memory MUST depend on the viewport, not the map size; no per-tile objects may
  exist for the whole map.
- **FR-014**: Frames MUST be produced only when something visible changes (animation step,
  camera move, state change), and no frames or animation timers may run while hidden or paused.
- **FR-015**: The renderer MUST work on WebGL 1.0-class graphics without extensions beyond those
  broadly available on the constitution's minimum hardware, and MUST recover from context loss.
- **FR-016**: Archive decompression, sprite decoding, and map parsing MUST run off the main
  thread in the browser, and decoded results MUST be cached locally keyed by source file identity;
  cache failure MUST fall back to decoding.

**Development harness**

- **FR-017**: A browser development page MUST let the developer supply a sprite archive and a
  map from local files, show the map filling the window, scroll the view, switch level, and show
  load diagnostics non-intrusively. It is not a wallpaper platform adapter.
- **FR-018**: The core (formats, state, simulation, renderer) MUST contain no platform-specific
  references; the harness talks to it through the same interface later adapters will use
  (supply files, settings, visibility/pause events).

**Inspection and checks**

- **FR-019**: Command-line inspection tools MUST dump LOD, DEF, PCX and H3M contents as
  machine-readable output, export DEF frames and PCX images as lossless PNG, inspect a map tile
  or object, list floating tiles in the reference tooling's tile-list format, and render a map
  region at a given time to PNG headlessly.
- **FR-020**: A terrain fidelity check MUST render a region, locate reference captures through
  the item 1 capture index, align by tile, exclude object-covered, floating, and volatile pixels,
  and emit a machine-readable report and diff image; it MUST skip with a clear message when game
  files or captures are absent. When the compared share of a region falls below a threshold
  fixed in the plan, for any reason (random objects, map objects, volatile pixels), the result
  MUST be "not checkable automatically" — distinct from pass, fail and skip — with the excluded
  share per cause, the random objects responsible if any, and an entry in a visual-review list;
  a region never passes on a near-empty comparison. Palette-animated terrain pixels (water, lava,
  animated rivers) MUST be compared by matching the animation step, not excluded as volatile.
- **FR-020a**: Checks and tests MUST be able to take maps and archives from the local game
  install configured for item 1 (its `Maps` folder and `Data` archives), not only from
  `public/dev-assets/`; test sets of real maps are described by file name/identity, never copied
  into the repository.
- **FR-021**: Data-level checks MUST verify parsed values against known values (from real files
  when present, synthetic committed fixtures always), including a round of all H3M object classes.
- **FR-022**: Budget checks MUST measure and enforce every constitution budget (runtime size,
  warm and cold start, memory, surface size, idle frame cadence, zero frames while hidden) plus
  viewport-bounded per-frame work across map sizes, including a synthetic 252×252 two-level map
  built from committed synthetic data.
- **FR-023**: An automated check MUST enforce one-directional layer dependencies and the absence
  of browser dependencies in parsers and state.
- **FR-024**: All checks MUST run headlessly on Linux, non-interactively, with non-zero exit on
  failure.

**Project hygiene**

- **FR-025**: The runtime stack MUST be decided in the plan with each runtime dependency justified
  by gzipped size, license, and what it replaces; a UI framework or general rendering engine may
  be kept only if the plan shows the budget holds and a simpler approach does not suffice.
- **FR-026**: Code ported from compatibly licensed sources MUST be attributed in a third-party
  notices file; no code may be copied from GPL or unlicensed references.
- **FR-027**: The proof-of-concept code MUST be removed or replaced; the Windows-only sync script
  MUST be removed or replaced by a Linux-compatible step; AGENTS.md MUST be updated with the
  stack, folder layout, and commands.
- **FR-028**: No game files or data derived from them may be committed; tests needing real game
  files MUST skip with a clear message when absent.

### Key Entities

- **LOD Archive / Entry**: a container of named game resources; entry has name, size, and
  compression.
- **Sprite (DEF)**: palette-indexed animation resource with groups of frames, frame geometry, and
  a palette.
- **Image (PCX)**: a single palette-indexed or true-color image.
- **Map File (H3M)**: the parsed contents of a map file, tied to its format version.
- **Object Template**: sprite name, passability and visibility masks, allowed terrains, class and
  subclass, placement layer.
- **Map Object**: an instance of a template at a position with type-specific details.
- **Floating Tile Set**: per level, the tiles random objects may draw on, with the object that
  causes each.
- **World State**: version-independent adventure-map state (tiles, objects, heroes, towns,
  ownership, visited/removed markers, day, animation time).
- **Simulation Event**: a change applied to world state over time.
- **Camera / Viewport**: level, position, and visible area in tiles and pixels.
- **Fidelity Report**: captures used, pixel counts compared/excluded/differing per tile, diff image.
- **Budget Report**: per budget measured value, limit, pass/fail.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of LOD entries in `H3sprite.lod` extract without error, and 100% of its DEF
  entries decode without error.
- **SC-002**: `Arrogance.h3m` parses completely with the parser ending exactly at the end of the
  data, and every object has decoded details or an explicit unsupported record (zero guessed
  skips); synthetic fixtures cover every RoE/AB/SoD object class.
- **SC-002a**: Every RoE/AB/SoD map in the local game install's `Maps` folder either parses
  completely or fails with a typed unsupported-version error (for non-base-game formats); zero
  maps fail with any other error.
- **SC-003**: The floating-tile list for `Arrogance.h3m` contains the hand-found tiles from spec
  001 research, and a reference selfcheck using the generated list passes.
- **SC-004**: The terrain fidelity check reports 0 differing non-excluded terrain pixels for
  reference stills of at least 3 checkable regions (from Arrogance or other install maps)
  covering both levels, water and a map edge, where water pixels are actually compared (not
  excluded); regions reported "not checkable automatically" do not count toward the 3.
- **SC-005**: For a captured water/lava clip, every captured palette step matches a rendered
  frame and the step duration matches within one capture frame interval.
- **SC-006**: All constitution budgets pass at 1920×1080 with CPU throttling: runtime ≤ 100 KB
  gzipped, warm start ≤ 2 s, cold start ≤ 10 s, memory ≤ 300 MB, surface ≤ display × DPR,
  0 frames while hidden, idle frames no more frequent than the animation cadence.
- **SC-007**: Per-frame work and graphics memory for the synthetic 252×252 two-level map stay
  within the plan's stated tolerance of the 36×36 map's figures (JS heap may grow with map size
  but stays within the SC-006 memory budget), and the page never allocates a surface larger than
  the window.
- **SC-008**: Rendering the same region with the same inputs twice gives pixel-identical images
  in 10 of 10 runs.
- **SC-009**: A developer can load a map in the development page and see animated terrain in
  under 10 seconds on first load and under 2 seconds on reload.
- **SC-010**: The full test and check suite runs headlessly on Linux without human input, and
  zero game-derived files appear in git status after running it.

## Assumptions

- Base-game assets come from the user's Complete edition. `public/dev-assets/` holds the
  developer's example files only; checks may use any map and archive (e.g. `h3sprite.lod`,
  `h3ab_spr.lod`, `h3bitmap.lod`) from the local install configured for item 1.
- Random map generation cannot be made static in the original game (item 1 research), so
  image-level automation covers only regions where randomness does not dominate; the rest is
  reviewed visually and less often.
- Rendering scope is terrain, rivers, and roads only; objects, heroes, towns, fog of war, player
  flags, and UI panels are drawn by later features but parsed now. Fidelity checks therefore mask
  every tile area covered by objects.
- The largest base-game map available locally may be smaller than 252×252; the size stress test
  uses a synthetic map built from committed synthetic data (no game content), since the only real
  252×252 map is HotA.
- Scrolling in the development page is a developer convenience; idle/mouse scrolling for users
  belongs to the interactive extras feature.
- Platform adapters (Wallpaper Engine, Lively, KDE) and user-facing settings such as scale are out
  of scope; the harness proves the adapter interface.
- The original game's animation timing values that are not yet known are measured from reference
  clips (item 1 tooling) and recorded in research.
- Constitution budgets are initial targets; if measurement shows a budget is unrealistic, the
  plan proposes an amendment rather than silently relaxing it.
- The stack (whether any of the proof of concept's libraries survive) is decided in the plan; the
  developer has no preference and relies on the constitution's guidance.
