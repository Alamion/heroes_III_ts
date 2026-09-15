# Data Model: Foundation Rewrite

Types are described language-neutrally; names are the intended TypeScript names. All integers
are non-negative unless stated. Coordinates: `x` right, `y` down, `z` level (0 surface,
1 underground). Layer owning each type is given in brackets.

## Common [core/util]

- **ByteSource** — random-access input: `name: string`, `size: number`,
  `read(offset, length): Promise<Uint8Array>`. Implementations: in-memory bytes, Node file handle
  (tools), browser `File` (runtime).
- **FormatError** — `code` (`TRUNCATED | BAD_MAGIC | UNSUPPORTED_VERSION | UNSUPPORTED_OBJECT |
  INVALID_VALUE | DECOMPRESS_FAILED | TRAILING_DATA`), `file`, `offset`, `format`
  (`lod|def|pcx|h3m|text`), `version?`, `structure` (dotted path, e.g.
  `objects[12].body.town.buildings`), `message`. Serializable to JSON.
- **Clock** — `now(): number` (ms). **Rng** — seeded, `next(): number`, `int(max)`.

## Formats [core/formats]

### LodArchive
- `source: ByteSource`, `entries: LodEntry[]`, `byName: Map<lowercase name, LodEntry>`.
- **LodEntry**: `name`, `offset`, `size` (uncompressed), `compressedSize` (0 = stored), `type`.
- Validation: magic `LOD\0`; every `offset + stored length ≤ source.size`; inflated length ==
  `size`; HotA 1.8 marker → `UNSUPPORTED_VERSION`; duplicate names keep first, reported in
  `warnings`.

### DefSprite
- `name`, `type`, `fullWidth`, `fullHeight`, `palette: Uint8Array(768)`, `groups: DefGroup[]`,
  `frameOrder: DefFrameRef[]` (concatenated group frame lists — the view-index space).
- **DefGroup**: `type`, `frames: DefFrameRef[]`.
- **DefFrameRef**: `name`, `offset`, `frame: DefFrame` (shared when offsets repeat).
- **DefFrame**: `compression 0..3`, `fullWidth`, `fullHeight`, `width`, `height`, `x`, `y`,
  `pixels: Uint8Array(width×height)` palette indices.
- Validation: row offsets and runs inside frame data; decoded length exact; `x+width ≤
  fullWidth`, `y+height ≤ fullHeight` after the old-format quirk.

### PcxImage
- `name`, `width`, `height`, `kind: 'indexed' | 'bgr24'`, `pixels`, `palette?: Uint8Array(768)`.

### H3mMap
- `version: 'RoE' | 'AB' | 'SoD'` (+ raw `versionCode`), `size`, `hasUnderground`.
- `info`: `hasHero`, `name`, `description`, `difficulty`, `levelCap?` (AB+).
- `players[8]`: `canHuman`, `canComputer`, `behavior`, `allowedFactions` (mask),
  `randomFaction`, `mainTown? {generateHero, generateHeroAtTown?(SoD), x, y, z}`,
  `randomHero`, `mainHero? {type, portrait, name}`, `heroes[] {type, name}`,
  `placeholderHeroes?` (AB+).
- `victory`: discriminated union by kind (`none`, `acquireArtifact`, `accumulateCreatures`,
  `accumulateResources`, `upgradeTown`, `buildGrail`, `defeatHero`, `captureTown`,
  `defeatMonster`, `flagDwellings`, `flagMines`, `transportArtifact`) + `allowNormal`,
  `appliesToAi`. `loss`: `none | loseTown | loseHero | timeExpires`.
- `teams: number[8] | null`, `allowedHeroes` (mask), `placeholderHeroIds[]` (AB+),
  `customHeroes[]` (SoD), `allowedArtifacts`, `allowedSpells`, `allowedSkills` (SoD),
  `rumors[] {name, text}`, `heroSettings[156]?` (SoD: experience, skills, artifacts, biography,
  gender, spells, primary skills — each optional).
- `tiles: Uint8Array(levels×size²×7)` with accessor `tile(x,y,z) → MapTile`.
- **MapTile**: `terrain 0..9`, `terrainView`, `river 0..4`, `riverView`, `road 0..3`,
  `roadView`, `flags` (bit 0/1 terrain flip H/V, 2/3 river, 4/5 road, 6 coast).
- `templates: ObjectTemplate[]`, `objects: MapObject[]`, `events: TimedEvent[]`.
- **ObjectTemplate**: `defName`, `passable: 48-bit mask (6 rows × 8)`, `active: mask`,
  `allowedTerrains` (mask), `editorGroup` (mask), `classId`, `subclassId`, `group`,
  `isOverlay` (placement order byte).
- **MapObject**: `index`, `x`, `y`, `z`, `templateIndex`, `classId`, `subclassId`,
  `body: ObjectBody`.
- **ObjectBody** (discriminated by `kind`): `none`, `hero`, `monster {count, disposition,
  message?, resources?, artifact?, neverFlees, noGrowth}`, `artifact {guard?}`, `spellScroll`,
  `resource {amount, guard?}`, `town {owner, name?, garrison?, formation, buildings:
  {built, forbidden} | {hasFort}, spellsMustHave, spellsMayHave, events[], alignment}`,
  `randomDwelling {owner, factions | linkedTown, minLevel, maxLevel}` (216–218 variants),
  `owned {owner}` (mines, generic dwellings, lighthouse, shipyard), `garrison`, `seerHut`,
  `questGuard`, `pandora`, `event`, `sign`, `shrine {spell}`, `scholar`, `witchHut`,
  `grail {radius}`, `placeholderHero`, `prison`. Unknown class → `FormatError
  UNSUPPORTED_OBJECT` (never a silent skip).
- **TimedEvent**: `name`, `message`, `resources[7]`, `players` (mask), `humanAffected`,
  `aiAffected`, `firstDay`, `repeatEvery`; town events add `buildings`, `creatures[7]`.
- Validation: parse ends exactly at end of decompressed data (else `TRAILING_DATA`).

### Text tables (from `h3bitmap.lod`)
- **ObjectsTxtRow** (`Objects.txt`): `defName`, `passable`, `active`, `allowedTerrains`,
  `editorGroup`, `classId`, `subclassId`, `group`, `isOverlay` — same fields as ObjectTemplate.

## Game data [core/data] (committed, typed, facts only)

- `TERRAINS[id] → {defName, animated: PaletteRotation[]}`; `RIVERS`, `ROADS` likewise.
- **PaletteRotation**: `start`, `length`, `stepMs` (default 180, confirmed by measurement).
- `RANDOM_CLASSES`: class id → candidate rule (`artifact`, `monsterAny`, `monsterLevel(n)`,
  `resource`, `town`, `dwellingFactionLevel`, `dwellingFaction`, `dwellingLevel`, `hero`).
- `PLAYER_COLORS[8]`, `OBJECT_CLASS_NAMES`.
- `CHECK_THRESHOLDS`: `notCheckableComparedShare = 0.25`, `sc007CpuTolerance = 0.20`,
  `sc007CpuFloorMs = 0.5`, `gpuBytesTolerance = 0.01`.

## World state [core/state]

- **WorldState**: `mapIdentity {sha256, name, version}`, `size`, `levels`,
  `terrain: Uint8Array` (7-byte tile records, immutable in this feature),
  `objects: Map<ObjectId, WorldObject>`, `heroes: Map<ObjectId, HeroState>`,
  `towns: Map<ObjectId, TownState>`, `players[8] {alive, team}`, `day`,
  `animationTimeMs`, `visited: Set<ObjectId>`, `removed: Set<ObjectId>`, `seed`.
- **WorldObject**: `id` (stable = original object index), `x`, `y`, `z`, `template`,
  `classId`, `subclassId`, `owner: 0..7 | null`, `details` (the ObjectBody), `random:
  RandomObjectInfo | null`.
- **HeroState**: `id`, `type | null`, `owner`, `x`, `y`, `z`, `army`, `artifacts`.
- **TownState**: `id`, `faction | random`, `owner`, `hasFort`, `buildings`.
- **Footprint**: `objectId`, `z`, `pixels`: list of `{tileX, tileY, mask: Uint32Array(32×32
  bitset)}` — union of non-transparent pixels over all frames of all candidate DEFs, anchored at
  the object's bottom-right tile corner.
- **FloatingCause**: `{kind: 'randomObject', objectId}` or `{kind: 'generatedHero', townObjectId,
  player}` (hero created by the game at a main town with `generateHero`, not in the object list).
- **FloatingTileSet**: per level `tiles: Array<{x, y, causes: FloatingCause[]}>`; serializations
  `toTileList(z) → "x,y;x,y"` (item 1 format) and JSON.
- State transitions: `fromH3m(map) → WorldState` (day 1, time 0). Only `applyEvent` produces a
  new state; renderer receives read-only views.

## Simulation [core/sim]

- **SimEvent** (discriminated): `advanceTime {deltaMs}` (implemented now); reserved kinds for
  later features documented but not implemented: `objectRemoved`, `objectVisited`, `heroMoved`,
  `ownershipChanged`, `dayAdvanced`.
- `applyEvent(state, event) → state` (structural sharing; terrain buffer shared).

## Render [core/render]

- **Camera**: `level`, `centerPx {x, y}` (world pixels), `viewportCss {w, h}`, `dpr`, `scale = 1`.
- **VisibleRange**: `x0, y0, x1, y1` tiles (inclusive, may extend outside the map for border).
- **AtlasLayout**: `pages[] {width, height}` (≤ 2048²), `frames: Map<"def#viewIndex", {page, u,
  v, w, h, offsetX, offsetY}>`, `paletteRows: Map<defName, row>`, `bytesPerPage`.
- **DrawPlan** (pure output for a range): `layers[terrain|river|road|border] → Float32Array
  quads (x, y, u, v, paletteRow)`, `animatedRows: number[]` in view, `quadCount`.
- **PaletteState**: animation state derived from `animationTimeMs` — a global step `k` (joint
  period 24) or per-rotation steps, depending on the phase model confirmed in research §5;
  `nextChangeMs`. Fidelity searches over all distinct states.
- **DrawPlan.animatedTileMask**: per visible tile, whether any drawn frame uses a rotating palette
  (used by fidelity to override the capture's volatile mask).
- **RendererStats**: `drawCalls`, `vertices`, `gpuBytes`, `surface {w, h}`, `framesPresented`,
  `lastFrameCpuMs`.

## Runtime [runtime]

- **SourceIdentity**: map → `sha256(file)`; archive → `sha256(size, lastModified, header +
  entry table)`; cache key `"${kind}:${cacheSchema}:${identity}"`.
- **CacheRecord**: `key`, `createdAt`, `payload` (`AtlasPayload {layout, pages: ArrayBuffer[],
  palettes: ArrayBuffer}` or `WorldPayload {state serialized}`).
- **WorkerRequest/Response**: `openArchive {file}` → `archiveReady {identity, atlas}`;
  `openMap {file}` → `mapReady {identity, world}` | `failed {error: FormatError JSON}`.
- **EngineStatus**: `idle | loading | ready | error`, `diagnostics: Diagnostic[] {level, code,
  message, file?}`.

## Checks [tools/checks]

- **FidelityReport**: see [contracts/report.schema.json](contracts/report.schema.json):
  `outcome pass|fail|skip|not-checkable`, `capture {id, kind, dir}`, `map`, `level`, `region`,
  `paletteStep`, `pixels {inMap, compared, comparedAnimated, differing, excluded
  {outsideViewport, volatile, object, floating, border}}`, `tiles[] {x, y, compared,
  differing}`, `diffImage`, `randomCauses[]`, `thresholds`, `clip? {steps[], stepMsMeasured,
  stepMsExpected}`. Outcome order: `skip` → `fail` (any differing) → `not-checkable`
  (compared < threshold, any cause) → `pass`.
- **BudgetReport**: `ok`, `budgets[] {id, measured, limit, unit, pass}`, `maps[]`,
  `throttle`, `viewport`, `sc007 {small, large, pass}`.
- **VisualReviewEntry**: `map`, `level`, `region`, `captureId`, `reason`, `addedAt` (stored in
  git-ignored `reference-captures/visual-review.json`).
