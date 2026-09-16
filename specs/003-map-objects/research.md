# Research: Map Objects and Animations

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-16

Facts already measured in spec 002 ([research](../002-foundation-rewrite/research.md)) are not
repeated: RGB565 display colour, palette step 180 ms with one global counter, stills catching a
sprite one step behind, object anchor at the tile's bottom-right, hero anchor one tile right of the
standing tile, generated starting heroes, floating tiles.

Items marked **SPIKE** are measured on captures of `test_map.h3m` before the code that depends on
them is written; the decision states the hypothesis the code starts from and what would change it.
Every measured value lands in a typed data module and in the "Measurements" section at the end of
this file.

## Measured while planning (2026-09-16)

- `test_map.h3m` uses 729 DEFs (702 map templates + 18 hero bodies + 8 hero flags + editor hero
  DEFs), 3 537 distinct frames, 15.4 MB of cropped frame pixels (one byte each); largest frame
  256×192. It is the largest of all 216 install maps by this measure.
- No install map needs a sprite found only in `H3ab_spr.lod`; `h3sprite.lod` alone suffices for the
  base game (Complete). The engine keeps one sprite archive.
- Of the 703 map DEFs, 504 have one frame and 199 are animated (one group; 8, 9, 12 and 30 frames
  are the common counts).
- Palette index 5 appears only in sprites of ownable objects (mines, dwellings, towns), not in
  creature banks, boats or heroes. Hero bodies (`ah00_.def`–`ah17_.def`) have 10 groups: 5 idle
  directions (1 frame) and 5 moving directions (8 frames); hero flags `af00.def`–`af07.def` (one DEF
  per player) have 10 groups × 8 frames.
- Towns have three sprites per faction in `h3sprite.lod`: `AVC<f>0` / `AVC<f>x0` / `AVC<f>z0`
  (e.g. `AVCCAST0`, `AVCcasx0`, `AVCCASZ0`); the editor stored `…x0` for every town on the test map.
- `PLAYERS.PAL` (h3bitmap.lod) is a RIFF palette of 256 colours = 8 players × 32 shades.

## 1. Object atlas

**Decision**: a second atlas, the **object atlas**, built in the worker per (sprite archive, map,
seed) from the DEFs the resolved world state needs: map templates after random resolution (§6),
hero body and flag DEFs of heroes present, and boats. Frames are stored **cropped** (their
`width×height` at `x, y` inside the full frame), shelf-packed by height into LUMINANCE pages of
2048×2048, as many pages as needed (test map: ~4 pages, 16 MB). One palette row per DEF in a shared
RGBA palette texture (256 × rows), with `toDisplayColor` applied as for terrain. Cached in
IndexedDB (`objectAtlas` store) keyed by archive identity + map identity + seed + schema.

**Rationale**: terrain atlas cells are fixed 32×32 and one page; object frames are variable-sized
and far more numerous. Only the DEFs a map uses are uploaded (full `Objects.txt` would be ~1 300
DEFs). 2048² is safe on the minimum GPU class. GPU memory is bounded by the map's distinct sprites,
not by object count or map size.

**Alternatives considered**: one texture per DEF (hundreds of textures, hundreds of draw calls);
full frames uncropped (×3–4 memory); building all `Objects.txt` DEFs once per archive (cache
reusable across maps, but 2–3× memory and cold start on every archive change).

## 2. Drawing objects in the renderer

**Decision**: objects are a separate draw plan, `buildObjectPlan`, drawn after roads and before
the map border, with a second shader program (same vertex format plus a per-vertex `owner` byte).
Per atlas page one draw call. The vertex buffer holds quads of objects whose sprite rectangle
intersects the plan range; it is rebuilt when the plan range changes **or** when the object
animation tick changes and animated objects are in the plan (only UVs change, the rebuild is
O(objects in view)).

Objects are found through a **spatial index** built once per world state: buckets of 8×8 tiles per
level holding object ids by anchor tile. A query scans the buckets that intersect the view range
extended by the largest sprite size in tiles (8 right, 6 down from the anchor, per template size),
so work depends on the view, not the map.

Buffer capacity grows in powers of two from the largest count seen and never shrinks while a map
is loaded; the budget check compares synthetic maps with equal object density in view (§12).

**Rationale**: keeps the terrain path untouched and bit-identical; the palette lookup shader
already exists; draw calls are bounded by atlas pages (≤ 8 expected).

**Alternatives considered**: frame selection in the vertex shader via a frame table texture
(avoids per-tick rebuilds but needs vertex texture fetch, not guaranteed on WebGL 1.0 minimum
hardware); instancing (`ANGLE_instanced_arrays` is an extension; unnecessary at these counts).

## 3. Special palette indices, shadows and player colour

**Decision** (hypothesis, SPIKE on `test_map.h3m` owned mines/dwellings/towns zone x 7–33,
y 65–97 and heroes x 55–59, y 63–67):

- index 0: transparent;
- indices 1–4 and 6–7: shadow — the game darkens the pixel below. The exact formula is measured
  from pixel pairs (terrain without shadow vs the same terrain under a shadow) in stills; the
  starting point is spec 002's `OVERLAY_ALPHA` (1–2: 25 %, 3–4: 50 %, 6: 50 %, 7: 25 %);
- index 5: flag colour — replaced by one colour per owner (8 players + neutral); **measured:
  `game.pal` entries 64–71 and 72** (see Measurements, T045). **No colour values are committed** (Principle I: palettes and anything derived from game files). The typed table
  `PLAYER_FLAG_SHADES` in `src/core/data/players.ts` stores only *where* the colour comes from: a
  shade index inside each player's 32-colour block of the user's `PLAYERS.PAL` (and, for neutral,
  a source file + index found by the spike). The spike measures capture colours at index-5 pixels
  and searches the user's palettes for the matching entry; if no palette entry matches, the source
  is looked for in other game files (e.g. `game.pal`, interface PCX palettes), never written down as
  RGB. Unit tests use a synthetic `PLAYERS.PAL`;
- all other indices: the DEF palette through RGB565 (`toDisplayColor`).

**Shadow exactness**: the game blends in 16-bit colour, so the result is quantised after blending.
WebGL fixed blending cannot quantise its output. Order of options, first that reproduces captures
bit for bit wins:

1. If the measured shadow is a darken that is exact in 8-bit after RGB565 input (e.g. halving each
   565 channel), use `blendFunc(ZERO, SRC_COLOR)`-style multiplication with a constant whose result
   rounds identically — verify on all 32/64/32 levels in a unit test of the formula.
2. Otherwise draw terrain and objects into an offscreen RGBA framebuffer the size of the surface
   (still ≤ display × DPR) and resolve shadows in a final pass that reads the framebuffer as a
   texture and applies the exact 565 formula per pixel.

The software reference rasterizer implements the exact formula directly; the GPU check keeps
requiring bit equality with it.

**Rationale**: h3lwp and VCMI (study only) replace index 5 with a per-player colour for adventure
objects; the measured data above agrees (index 5 only in ownable sprites). Values are measured, not
copied.

**Alternatives considered**: palette rows per (DEF, owner) — up to 9× rows for ownable DEFs,
more memory and cache work for no gain over a per-vertex owner.

## 4. Draw order

**Measured (T047): flat → non-visitable → visitable → row y → heroes → map order; see Measurements.**

**Original hypothesis** (SPIKE on dense zones of `test_map.h3m`): one comparator in
`src/core/render/object-order.ts`, keys in order:

1. flat objects first: templates with the `isOverlay` flag (Objects.txt last column) — lakes,
   craters, cursed ground and the like;
2. anchor `y` ascending (objects lower on the map drawn later);
3. heroes after non-hero objects on the same row (heroes over the town gate they stand in);
4. visitable (`active` mask non-empty) after non-visitable on the same row;
5. anchor `x` ascending;
6. map file order (object index) as the final tie-break.

The spike renders every dense 19×17 zone and reports differing pixels grouped by the pair of
overlapping objects; a changed key order is recorded here with the counter-example.

**Rationale**: spec 002 recorded these candidates from h3lwp study; a deterministic total order is
required by Principle III.

**Alternatives considered**: sort by sprite bottom edge in pixels (equivalent to anchor y for
bottom-right anchoring); per-tile depth buffer (no depth in WebGL 1.0 minimum profile without
cost, unnecessary).

## 5. Which objects are drawn, and with which sprite

**Decision**: typed tables in `src/core/data/object-classes.ts`:

- `HIDDEN_CLASSES`: event (26), grail (36) — not drawn. Hero placeholder (214) and random hero (70)
  are replaced by a resolved hero (§6).
- Heroes (class 34 objects and prisons are distinct): drawn from `WorldState.heroes`, not from the
  object template. Body DEF `ah{class:02}_.def` with the class from a typed hero type → class table
  (`src/core/data/heroes.ts`; types 0–143 are 18 classes × 8, the SoD special heroes 144–155 are
  listed individually — `test_map.h3m` uses type 144), flag DEF `af0{owner}.def`. Group = idle direction; the default facing
  of a hero that has not moved is a **SPIKE** (hypothesis: right, group 2; left facings mirror the
  right ones). Flags animate (8 frames) even when the body is idle. Prisons draw their template.
- Towns: sprite chosen by fort state, from a typed table per faction `{village, fort, capitol}`
  (`AVC<f>0`, `AVC<f>x0`, `AVC<f>z0`), **SPIKE** to confirm which built state maps to which
  sprite (hypothesis: no fort → village, fort → `x0`, capitol building → `z0`), using the town
  zone of `test_map.h3m` (default towns have a fort).
- Boats: template sprite. A hero placed on water starts in a boat: drawn with the boat-hero sprites
  (`ab01_.def`–`ab03_.def` by boat type, flag DEF per player found by the spike) instead of the hero
  body. `test_map.h3m` has no such hero; the rule is checked on an install map that has one if a
  capture exists, otherwise listed as a known gap in the compliance review.
- Everything else: the template's DEF, group 0, all frames in file order.

## 6. Random objects

**Decision**: `resolveRandomObjects(state, rng, templates)` in `src/core/state/random.ts`, run once
when the world state is built for rendering (not stored in the parsed map), seeded by
`WorldState.seed`, visiting objects in map order. Outcomes follow the constraints the map stores:

- random monster (any / level 1–7): a creature of that level from a typed creature table
  (`src/core/data/creatures.ts`: id → faction, level, upgraded) excluding creatures the map bans;
- random artifact (any / treasure / minor / major / relic): an allowed artifact of that class from
  a typed artifact class table;
- random resource: one of the 7 resources;
- random town: the owner's allowed faction (or any faction), sprite by fort state (§5);
- random dwelling (any / by level / by faction): a dwelling template of `Objects.txt` class 17
  matching the linked town or faction set and level range;
- random hero / hero placeholder / generated starting hero: a hero type of the owner's allowed
  heroes not used by another hero on the map.

The resolved outcome selects a template row of `Objects.txt` (for the DEF). Tiles of all random
objects stay floating (computed from all candidates, spec 002) — the resolution only decides what
the wallpaper shows.

**Rationale**: deterministic and cheap; exact reproduction of the game's generator is impossible
(item 1: libfaketime cannot pin it) and unnecessary because these tiles are excluded from checks.

**Alternatives considered**: showing the random placeholder sprite (`AVWmrnd0`, etc.) — looks like
the editor, not the game.

## 7. Object animation timing

**Superseded in part by Measurements (T062 part 1): phases are per object and random per launch.**

**Decision** (hypothesis, SPIKE with a clip of an animated zone of `test_map.h3m`, both monsters and
decorations and an owned flag): object frames advance on the **same global adventure-map tick as
the palette**: `frame = tick mod frameCount`, `tick = floor(timeMs / 180)`, one counter for all
objects (all objects of the same DEF in lock). The spike measures from clip frames: (a) median
interval between object frame changes, (b) whether different DEFs and different instances of one DEF
change on the same grab as the palette step, (c) frame order (file order vs reversed or ping-pong).
The result is recorded in `src/core/data/animation.ts` (`OBJECT_FRAME_MS`, `OBJECT_PHASE_MODEL:
'global' | 'perDef' | 'perObject'`, with a phase rule if not global).

If objects step on their own timer, the scheduler's next wake-up becomes the minimum of the next
palette step and the next object step (`nextChangeMs`, §9).

**Rationale**: the game drives the adventure map from one timer (palette rotation evidence: one
global counter); the clip will confirm or reject.

## 8. Fidelity check with objects

**Decision** (changes in `tools/checks/fidelity`):

- The render and the software reference rasterizer draw objects; pixel class `object` disappears
  for non-random objects. Floating (random objects, generated heroes) and UI corners stay excluded.
- Volatile-mask override extends from palette-animated tiles to **pixels covered by an animated
  object sprite** (per-pixel owner from the rasterizer), since the still's volatile mask marks every
  animated pixel.
- State search for stills: palette step `k` (72 states) as in spec 002, then per animated DEF a
  frame `f` (coordinate descent: pick each DEF's best frame with the others fixed, two passes, in
  draw order). The report adds `objectFramesByDef` and `tickConsistent` (every DEF frame equals
  `(k + d) mod frameCount` for one tick with `d ∈ {−1, 0, +1}` per sprite, as measured for palette
  animation). A still fails if pixels differ after the search.
- Clips: every frame change must advance each DEF's frame and the palette step in order; the
  measured object frame interval must equal `OBJECT_FRAME_MS` within one grab interval.
- Captures whose recorded map hash differs from the current file are skipped with the new reason
  `map-changed` (was mislabelled `no-game-files`); `findCaptures` gains a hash filter so the newest
  matching capture is chosen.
- The misregistration retry (`capture-misaligned`) stays, but is only attempted for records without the
  `verification` block added by the fix in §10; verified captures that differ fail normally.
- Report schema: `specs/003-map-objects/contracts/report.schema.json` supersedes 002's (additive).

## 9. Scheduler and engine

**Decision**: the renderer exposes `nextChangeMs(timeMs): number | null` (earliest time at which
something visible changes: next palette step if animated rows are in view, next object tick if
animated objects are in view; null if nothing animates). The scheduler uses it instead of the
hard-coded 180 ms step. Engine options gain `objects: boolean` (default true; the dev harness toggles
it with `O` for diagnosis) and `seed` (default: world state seed). The **data archive**
(`h3bitmap.lod`, `engine.loadDataArchive`) is required for objects: it supplies `Objects.txt` (random
outcomes) and `PLAYERS.PAL` (flag colours). Without it terrain renders, objects are not drawn, and
one `data-archive-missing` diagnostic is emitted (a map with uncoloured flags would look wrong).
Worker protocol: `openMap`
returns the world state and the object atlas (built after the archive is open), `objectAtlasReady`
is part of `mapReady`.

## 10. Capture tooling: top-edge misalignment

**Finding**: the three misaligned stills of `Arrogance.h3m` were recorded by commit `a869065`, whose
minimap rectangle reader treated a top edge as unclipped when the side dashes started in a gap; the
view origin y −1 (the game lets the view extend above the map) was recorded as 0. Commit `656e762`
fixed the reader (`drawnEdges`), but the stale records remain and nothing guards against a wrong read.

**Decision**:

- Prune the stale records (`yarn ref prune --id …`) and re-capture those views.
- Add a record-time guard in `positionView`/`gameRecordBase`: the rectangle read back must have the
  expected size (19×17 tiles in minimap pixels) on every edge that is drawn; clipped edges must lie
  on the minimap border; otherwise `POSITION_MISMATCH`.
- Add a content cross-check after grabbing: render the recorded visible range with the terrain-only
  software rasterizer at the recorded mapping and at the 8 one-tile shifts; if a shift matches
  clearly better than the recorded mapping on non-object, non-animated terrain pixels, fail with
  `MAPPING_UNVERIFIED` and a failure screenshot (FR-019). This uses the project renderer as an
  independent check of the minimap read and never stores a capture with a wrong mapping.
- Minimap scale on 144×144 maps is 1 px per tile; `yarn ref calibrate` gains a run on
  `test_map.h3m` to confirm dashed-edge detection at that scale.

## 11. Capture tooling: level switch and reveal

**Level switch — finding**: the current level is recognised by the hash of the level button
calibrated on a red human player. The interface is skinned in the human player's colour
(`Shadow Valleys.h3m`: blue), so the hash never matches, the tool believes it is on level 1, and
toggling leads to a wrong level; a level 1 request on such a map would silently capture the surface.

**Decision**: detect the level from **map content**, not UI colour: quantise the minimap to one cell
per tile and compare its structure with each level's terrain grid from the parsed map (agreement of
"same colour ⇔ same terrain" over neighbouring cells, plus shroud share); the level with the higher
agreement wins with a required margin, otherwise `LEVEL_UNKNOWN`. Applied after reveal and after
each toggle; the recorded level is verified before grabbing. The button hash probe is removed.

**Reveal — finding** (weaker): on `Merchant Princes.h3m` the first code (`nwcwhatisthematrix`) had
no effect and the second (non-working) code was typed into the chat. Most likely the scenario intro
dialog was not recognised (its OK-button hash was calibrated on `Arrogance.h3m`) and the first
attempt's keys were consumed by that dialog.

**Decision**: SPIKE first — run `still` on `Merchant Princes.h3m` with step screenshots
(`--debug-steps`, new flag writing each step's grab to the failures folder). Planned fix: before
typing, make sure no modal is open by pressing Return until the adventure map is detected by a
colour-independent probe (the minimap/viewport areas change when the view is scrolled by one
minimap click, and do not change while a modal is open); verify the reveal after each attempt
(minimap shroud share, already implemented) and retry the working code up to 3 times instead of
falling through to the non-working one. The cause found by the spike is recorded here.

## 12. Budgets with objects

**Decision**: the synthetic archive gains object DEFs (static and animated, with shadow and flag
indices, sizes 32×32 to 192×192, generated by committed code), and both synthetic maps (36×36 and
252×252×2) get the same repeating object pattern, so the SC-007 comparison of draw calls, vertex
capacity and GPU bytes at the same view stays meaningful. Real-map budgets run on `Arrogance.h3m`,
`test_map.h3m` and the largest install map. Expected: +1 draw call per object atlas page in view,
object atlas ≤ 4 pages (≤ 16 MB) on `test_map.h3m`, runtime JS growth ≤ 10 KB gzipped.

## 13. Inspection

**Decision**: `yarn h3 map draw-list MAP --level Z --region … (--time MS | --tick N) [--seed S]`
prints the object draw list (contract: [inspect-cli.md](contracts/inspect-cli.md)); `yarn h3 render`
gains `--seed`, `--tick`, `--no-objects`. `yarn h3 map random MAP [--seed S]` lists resolved random
outcomes.

## Measurements

Filled by the spikes (§3 shadow and flag colours, §4 order, §5 hero facing and town sprites,
§7 timing, §11 reveal cause), each with date, capture ids and counts.

### Mapping verification on existing captures (T027, T019, 2026-09-16)

`verifyMapping` with terrain-only software renders (non-animated terrain outside object and floating
footprints) over all Arrogance stills: every correctly recorded view passes with its recorded mapping
best (0–1 266 differing of 40 000–113 000 compared pixels; the residue is the UI corner ornaments);
the three stills recorded by commit a869065 fail with best shift (0, −1):
`2026-09-14T15-24-36-062Z_x1-19_y0-16` (79 681 vs 134 differing), `2026-09-14T15-25-55-503Z_x1-19_y0-16`
(79 677 vs 134), `2026-09-14T16-48-40-460Z_x1-19_y0-16` (level 1, 1 078 vs 0). The same view taken
with request y = 8 (`2026-09-14T15-17-44-724Z_x1-19_y0-16`) passes (33 differing). The three were
pruned. Views with no comparable terrain (e.g. corners of the underground, all rock under objects)
compare 0 pixels and cannot be verified this way; they pass without evidence. ~0.3 s per still.

### Artifact classes and random dwellings (T009, T012, 2026-09-16)

Artifact classes are read from the user's `artraits.txt` (class column S/T/N/J/R; 144 rows in the
Complete edition: 7 special, 37 treasure, 21 minor, 39 major, 40 relic) instead of a committed table.
Random dwellings choose any creature generator template allowed on the terrain (no dwelling → creature
table in the base game's text files); their tiles are floating. Hero allowed-list bit set = allowed,
artifact list bit set = disabled (checked on 8 install maps: 127–144 of 160 hero bits set, 14–21
artifact bits set).

### Level detection and reveal on previously failing maps (T022–T026, T033, 2026-09-16)

- **Level metric.** The first metric (neighbour agreement) separated levels poorly on the real
  minimap (0.775 vs 0.708 on the Arrogance surface: the game draws each terrain in two shades,
  passable and blocked, plus object colours). Replaced by purity (tiles of one colour share a
  terrain) × coverage (a terrain's tiles use at most two main colours): Arrogance surface 0.916 vs
  0.201, Arrogance underground 0.916 vs 0.256, Shadow Valleys underground (blue interface) 0.987 vs
  0.297, Shadow Valleys surface 0.931 vs 0.294. Margin threshold 0.1 kept.
- **Reveal cause** (`--debug-steps` on `Merchant Princes.h3m`): the map shows a scenario intro message
  whose box is smaller than Arrogance's, so the OK-button probe did not match ("no scenario intro
  message detected"); the first `nwcwhatisthematrix` attempt went into the open message and its
  Return closed it; the second code `nwctheone` is not a cheat in this build and was typed into
  the chat. Fix: type the working code up to three times before other codes. Result: capture
  succeeds with `nwcwhatisthematrix`.
- **Live results** (SC-003): `Arrogance.h3m` top edge (request 10,7) → `2026-09-16T20-02-55-786Z_x1-19_y0-15`,
  origin (1, −1), mapping 134 differing of 75 014; `Shadow Valleys.h3m` level 1 →
  `2026-09-16T20-04-38-086Z_x11-29_y12-28` (1 599 of 278 485); level 0 →
  `2026-09-16T20-06-15-259Z_x11-29_y12-28` (723 of 124 998); `Merchant Princes.h3m` →
  `2026-09-16T20-09-50-536Z_x11-29_y12-28` (0 of 78 037). All mappings best at shift (0, 0).

### Captures of test_map.h3m and terrain confirmation (T034, T035, 2026-09-16)

Captures (all with verified mapping, best shift (0, 0)): towns `2026-09-16T20-20-17-814Z_x11-29_y73-89`,
heroes `2026-09-16T20-21-37-299Z_x48-66_y57-73`, dense `2026-09-16T20-22-56-244Z_x57-75_y51-67` and
`2026-09-16T20-24-15-106Z_x76-94_y51-67`, rivers/roads top edge `2026-09-16T20-25-34-179Z_x109-127_y0-13`,
top-left corner `2026-09-16T20-26-52-867Z_x0-18_y0-16`, bottom-right corner
`2026-09-16T20-28-11-893Z_x125-143_y127-143`, underground `2026-09-16T20-29-31-280Z_x50-68_y14-30`, random
zone `2026-09-16T20-30-51-005Z_x19-37_y34-50`, owned objects `2026-09-16T20-35-30-614Z_x29-47_y62-78`; clips
dense `2026-09-16T20-32-03-439Z_x57-75_y51-67` and heroes `2026-09-16T20-33-27-659Z_x48-66_y57-73` (4 s each).

Terrain-only fidelity (`--exclude-objects`):
- **Roads confirmed**: all three road types on the surface top edge and underground, and the 28 road
  tiles of `Merchant Princes.h3m`, match with 0 differing pixels at the +16 px offset (FR-020, SC-004).
- **Mud and lava river palettes corrected**: both failed (7 270 and 10 954 differing pixels). Colour
  matching of river pixels against the DEF palette showed mud river rotating the twelve colours
  228–239 and lava river the nine colours 240–248, with shifts consistent with one global step
  (mud k ≡ 10 mod 12, lava k ≡ 4 mod 9 in the same stills). The h3lwp ranges (mud 183–188 + 240–245,
  lava 240–247) were wrong. After the fix both stills pass with 0 differing pixels (35 000 and 67 000
  compared animated pixels). The joint palette period is now 36 (LCM 12, 9, 6).
- **Map corners**: the top-left corner view passes with 0 differing pixels (corner frame 16 confirmed).
  The bottom-right corner view differs on 89 pixels in tiles (142–143, 141–142) — swamp tiles next to
  the corner, not the border; examined with objects drawn (T055).
- The town zone differs on 2 589 pixels next to towns (plain dirt, no rivers or roads): town sprites
  the game draws differ from the template's footprint (see T047), so these are object pixels.
- `Arrogance.h3m` (32 views), `Shadow Valleys.h3m` (2) and `Merchant Princes.h3m` (1) all pass.

### Flag colours (T045, 2026-09-16)

On `2026-09-16T20-35-30-614Z_x29-47_y62-78` (owned towns, dwellings and mines of players 0, 5, 7) and the
towns still (neutral towns), every index-5 pixel of each owner has one colour: red (255, 0, 0),
purple (140, 45, 165), pink (197, 121, 140), neutral (132, 130, 132) — the RGB565 display colours of
`game.pal` entries 64, 69, 71 and 72. Entries 64–71 of `game.pal` are the eight player colours in H3M
order (red, blue, tan, green, orange, purple, teal, pink) and 72 the neutral grey, so flags use
`game.pal` 64 + player and 72 for neutral — not `PLAYERS.PAL`, which is not needed. Players 1–4 and 6
are not owners of index-5 objects on the test map; their entries follow the same block (not yet
seen in a capture). Hero flags (`af0?.def`) have no index-5 pixels: their colour is in the sprite.
Only entry numbers are committed (`PLAYER_FLAG_SHADES`); colours are read from the user's `game.pal`.

### Shadows (T046, 2026-09-16)

Pairs (colour below from the terrain render, captured colour) at object shadow pixels on the owned,
towns and dense stills, per channel in 16-bit units (5-bit red/blue, 6-bit green): index 4 gives
`c >> 1` (e.g. red 8→4, 9→4, 10→5; green 18→9), index 1 gives `(c >> 1) + (c >> 2)` (red 8→6, 9→6,
10→7, 12→9, 16→12, 20→15; green 18→13, 26→19). Indices 2, 3, 6, 7 did not occur. WebGL fixed
blending cannot reproduce these floors, so the decision is option 2 of §3, refined: body pixels are
drawn into a colour target while a second target counts dark/light shadow steps since the last body
pixel (blend ONE, ONE_MINUS_SRC_ALPHA: body resets, shadow adds); a resolve pass applies the steps in
16-bit colour; the map border is drawn afterwards. The software rasterizer uses the same counting
model. It differs from the game only where two shadows of different kinds stack on one pixel (applied
dark-then-light instead of in draw order). After the change, the towns still differs on 33 pixels (a
chest) and the owned still only on animated dwellings.

### Animation phase (T062 part 1, 2026-09-16)

Rendering the dense view at every tick and choosing, per animated object, the tick whose frame
matches its pixels best gave different frames for instances of the same DEF (e.g. `avlref20.def`
reefs at frames 0, 1, 3, 4, 5, 7, 8, 9, 10, 11). A second still of the same view
(`2026-09-16T20-56-55-986Z_x57-75_y51-67`, another launch) gave per-object frame differences spread over
all values 0–11 (69 objects), so the game picks each object's animation phase at random per launch.
Decision: `OBJECT_PHASE_MODEL = 'perObject'`, phase = hash(seed, object id, position); stills search
the frame of every animated object separately (report field per object, not per DEF); clips check
that every object advances one frame per tick in lock with the others. Reefs and lava lakes animate by
frames whose pixels use shifted colour indices, not by palette rotation.

### Draw order, towns and fidelity with objects (T047, T051, T055, T062, 2026-09-17)

- **Town sprites**: the town zone still passes with objects compared (60 526 object pixels, 0
  differing): village (`…0`) for towns without a fort, `…x0` with one — the hypothesis holds. Capitol
  sprites were not in a capture.
- **Draw order**: overlapping pairs decided by exact body colours on six test_map stills: VCMI's key
  (flat, y, heroes, visitable, x) agrees with 210 of 243 strongly decided pairs, y + map order with
  215. Side-by-side views of `Arrogance.h3m` showed the decisive rule: **visitable objects are drawn
  after all non-visitable objects** (a library over the trees in front of it, a windmill over the
  mountains below it). Adopted order: flat → non-visitable → visitable → row y → heroes → map order.
  Arrogance differing pixels fell from 543 604 to 422 813 over 32 views. Remaining order differences
  sit in dense mountain clusters (bottom-right corner of test_map.h3m, 58 163 pixels on static objects)
  and follow no tested key (x ascending/descending, map order ascending/descending, sprite left edge,
  width, top edge): accepted by the owner (below).
- **Hero flags**: 7–14 differing pixels per flag on the owned still after the per-object frame search.
  Update 2026-09-17: 7 of them per flag were the last flag column, which the game covers with the
  flagpole of the body — the game draws `af0?.def` before `ah??_.def`. With the flag drawn first the
  owned still has 1 differing pixel (29 before). Only the idle direction (group 2) was seen; the rule
  is kept minimal (`KIND_RANK` in `object-order.ts`) and may be revisited for moving heroes.
- **Reefs** (`avlref*`, 12 frames, overlapping) on the heroes and dense stills: after the grouped
  per-object frame search all remaining differences (8 549 and 43 255 pixels) are on animated reefs,
  about half on their shadows over palette-animated water; applying water palette rotation to reef
  palettes made it worse (8 943 → 9 639). Accepted by the owner (below).
- **Timing** (T062): both clips measure 183.3 ms per palette step and per object tick at 60 grabs/s
  (180 ms), all objects advance in lock with the palette: `OBJECT_FRAME_MS = 180` confirmed; phases per
  object as above.
- **GPU = reference rasterizer**: bit-equal in every still and clip check with objects, shadow count
  targets and resolve pass included.
- **Headless file serving**: `h3bitmap.lod` (100 MB) crashed Chromium when served by Playwright request
  interception; files are now streamed by a local HTTP server with CORS.

### Accepted deviations (owner review, 2026-09-17)

The project owner compared reference, render and diff images of the failing test_map stills and
accepted the remaining differences as permissible losses; they are not to be chased further:
- **Dense mountain clusters** (x125-143, y127-143): some overlapping sprites swap places; the picture
  reads the same. The black area outside the map edge in the reference is a game rendering artefact,
  not something to reproduce.
- **Reefs** (x48-94, y51-73): the game shows no reef shadows over the water while the render does; the
  render is kept as it is. Overlapping elements swap places as with mountains.
- **Hero flags**: the flagpole column was fixed (above); the remaining pixel inside the flag cloth is
  accepted.

Consequence: `yarn verify fidelity` still reports these captures as `fail` (no per-zone thresholds were
added); treat those outcomes on these views as expected. The same applies to the Arrogance, Shadow
Valleys and Merchant Princes object differences listed below.

### Budgets, determinism, tests (T068–T074, 2026-09-17)

`yarn verify budget` (1920×1080, DPR 1, 4× CPU throttling, SwiftShader), second consecutive run:

| Budget | Map | Measured | Limit | Status |
| --- | --- | --- | --- | --- |
| runtime-js-gzip | — | 46 061 | 102 400 bytes | pass |
| cold-start | test_map.h3m | 4 628 | 10 000 ms | pass |
| warm-start | Arrogance / test_map / Pandora's Box / synthetic 252 | 1 768 / 1 281 / 1 625 / 1 593 | 2 000 ms | pass |
| memory | test_map.h3m | 41 421 208 | 314 572 800 bytes | pass |
| object-atlas-bytes | test_map.h3m | 16 777 216 (4 pages) | 67 108 864 bytes | pass |
| idle-cadence | all | 28 | 28 frames | pass |
| hidden-frames / hidden-timers | all | 0 / 0 | 0 | pass |
| sc007 draw calls / object quads / vertices | synthetic 96 vs 252 | 3 / 78 / 47 520 each | equal | pass |

Notes: warm start with objects varies between runs (1.1–2.2 s; one run measured 2.18 s on the first
map of the session): **budget risk** tracked in TODO.md. Transferring the cached object atlas pages
from the worker without copying cut the test_map warm start from 2.03 s to 1.28 s. The idle-cadence
limit now uses the real idle window (page clock); the requested 5 s lasted a little longer and
produced a 29th legitimate frame. The SC-007 small synthetic map is now 96×96×2: at 1920×1080 the view
(60×34 tiles) did not fit into 36×36, so object counts differed. `yarn verify determinism --runs 10`:
10 identical images of test_map region 57,51,75,67 with 205 objects. `yarn test`: 33 files, 190 tests
pass (11 skipped live/optional). `yarn verify layers`: pass.

`yarn verify all` fails on fidelity for the known deviations: test_map.h3m (5 of 10 stills pass;
clips fail only on the reef views), Arrogance.h3m (32 views, 2 256–14 838 differing pixels per view
after the order fix; objects are compared on 40 000–150 000 pixels per view), Shadow Valleys.h3m
(353 and 9 697), Merchant Princes.h3m (14 337). Terrain-only fidelity (`--exclude-objects`) passes on
every capture of all four maps.
