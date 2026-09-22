# Data Model: Map Objects and Animations

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

Extends [spec 002's data model](../002-foundation-rewrite/data-model.md). Unchanged entities
(`WorldState`, `WorldObject`, `HeroState`, `TownState`, terrain `Atlas`, `DrawPlan`, capture
records) are referenced, not repeated. Layer in brackets.

## Typed data tables [core/data]

| Table | Module | Content | Source |
| --- | --- | --- | --- |
| `HIDDEN_CLASSES` | `object-classes.ts` | class ids never drawn (event 26, grail 36) | game behaviour, verified by captures |
| `TOWN_SPRITES` | `object-classes.ts` | faction 0–8 → `{village, fort, capitol}` DEF names | `h3sprite.lod` names; mapping to built state measured (research §5) |
| `HERO_CLASS_OF_TYPE` | `heroes.ts` | hero type 0–155 → hero class 0–17 | base-game hero list |
| `HERO_DEFAULT_GROUP` | `heroes.ts` | idle group and mirror flag of an unmoved hero | measured (research §5) |
| `CREATURES` | `creatures.ts` | creature id → `{faction or neutral, level 1–7, upgraded}` | base-game creature list |
| artifact classes | read at run time | artifact id → class from the user's `artraits.txt` (`formats/text/artraits.ts`) | user's data archive |
| `PLAYER_FLAG_SHADES` | `players.ts` | player 0–7 + neutral → source palette file + index (no RGB values) | measured (research §3); colours read from the user's files at run time |
| `SHADOW_KINDS` | `animation.ts` | shadow index → light (`(c>>1)+(c>>2)`) / dark (`c>>1`) per 5/6-bit channel | measured (research T046) |
| `OBJECT_FRAME_MS`, `OBJECT_PHASE_MODEL` | `animation.ts` | object animation step and phase model | measured (research §7) |

All tables are facts (ids, names, numbers), no game content; `Objects.txt` and `game.pal` are read
from the user's archives at run time.

## Resolved object [core/state]

`RenderObject` — what the renderer draws for one visible thing. Built once per world state by
`buildRenderObjects(state, templates, rng)`; later simulation events (moved heroes, removed or
recaptured objects) rebuild the affected entries.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `ObjectId` | world object id; heroes use their object id |
| `kind` | `'object' \| 'heroBody' \| 'heroFlag'` | a hero yields two entries (body, flag) |
| `x, y, z` | tile | anchor tile (bottom-right of the sprite) |
| `def` | string (lower case) | sprite after random resolution / town state / hero class |
| `group` | number | DEF group (0 for map objects; direction for heroes) |
| `mirror` | boolean | horizontal mirror (hero facings) |
| `owner` | `0..7 \| null` | for index-5 flag colour; null → neutral |
| `flat` | boolean | template `isOverlay` |
| `visitable` | boolean | template `active` mask non-empty |
| `order` | number | map file order |
| `phase` | number | animation phase offset in ticks (per object, from the seed) |
| `random` | `RandomOutcome \| null` | what a random object resolved to |
| `floating` | boolean | object's tiles are floating in checks |

**Validation**: `def` must exist in the object atlas, otherwise the entry is dropped and a
diagnostic `missing-sprite {def, objectId}` is emitted (edge case: missing sprite). Hidden classes
never produce entries.

`RandomOutcome` = `{rule: RandomRule, classId, subclassId, def, heroType?}`; chosen by
`resolveRandomObjects` with the seeded RNG in map order (research §6).

## Spatial index [core/state]

`ObjectIndex` — per level, buckets of 8×8 tiles holding `RenderObject` indices by anchor tile;
`query(level, range, margin)` returns candidates for a tile range extended by the maximum sprite
extent (`maxExtentTiles = {left: 8, up: 6}`). Built once per render-object list (O(objects)),
queried per plan build (O(view)).

## Object atlas [core/render]

`ObjectAtlas` = `{layout: ObjectAtlasLayout, pages: Uint8Array[] (2048² LUMINANCE each), palettes:
Uint8Array (256 × rows × 4)}`.

`ObjectAtlasLayout` = `{pageSize, pageCount, rowCount, sprites: Record<def, ObjectSprite>}`;
`ObjectSprite` = `{def, row, fullWidth, fullHeight, groups: FrameCell[][]}`; `FrameCell` =
`{page, u, v, width, height, x, y}` (cropped frame at offset x, y inside the full frame; frames that
share a data offset share a cell).

**Rules**: packing is deterministic (DEFs sorted by name, frames in file order, shelf packing by
height); page count ≤ `MAX_OBJECT_PAGES` (6, one texture unit each) or `RangeError` with the total size; GPU bytes =
`pageCount · pageSize² + 256 · rows · 4`.

## Object draw plan [core/render]

`ObjectPlan` = `{range, level, tick, vertices: Float32Array, pageRuns: {page, first, count}[],
quadCount, animatedInView: boolean, entries: DrawListEntry[] (only when requested for inspection)}`.

Vertex (11 floats since spec 004 T074, 7 before): `x, y` (world px relative to range origin), local
`x, y` in the cell, cell top-left texel `u, v`, cell `width, height` (negative = mirrored), `paletteRow`,
`page`, `owner` (0–7, 8 = neutral). Quad of a frame: `left = (x+1)·32 − fullWidth + cell.x`, `top = (y+1)·32 −
fullHeight + cell.y`, mirrored horizontally inside the full frame when `mirror`.

**State transitions**: rebuilt when the level changes, the view leaves the plan range, the tick
changes while `animatedInView`, or the render-object list changes.

`DrawListEntry` (inspection) = `{id, kind, className, def, group, frame, x, y, screenX, screenY,
owner, flat, visitable, random, floating}` in draw order.

## Animation state [core/render]

**Terms**: *tick* is the one global adventure-map animation step (spec: "animation step"),
`tick = floor(timeMs / OBJECT_FRAME_MS)`; *paletteStep* is the palette rotation position derived
from the same counter under the global phase model (spec 002).

`AnimationState` = `{paletteStep, tick}`; `frame = (tick + phase) mod frames` (per-object phase model). `nextChangeMs(timeMs, inView)` = earliest of the next palette step (if animated
rows in view) and the next object tick (if animated objects in view), or null.

## Fidelity report additions [tools]

`pixels.excluded.object` stays in the schema and is 0 unless `--exclude-objects` is given.
New fields: `objectFramesByObject: Record<'def@x,y', frame>` (per object; phases are random per launch),
`pixels.comparedObject`, `clip.objectSteps[] {frame, tick, differing}`, `clip.objectStepMsMeasured`,
`skipReason: 'map-changed'`. Schema: [contracts/report.schema.json](contracts/report.schema.json).

## Capture record additions [tools/reference-env]

`verification: {minimapRect: {x, y, w, h, drawnEdges}, level: {method: 'minimap-terrain', agreement,
margin}, mapping: {method: 'terrain-render', differingRecorded, bestShift}}` — written by stills and
clips taken after the fix; older records lack it (used to decide whether the misalignment retry
applies, research §8, §10).
