# Research: Foundation Rewrite

Phase 0 of [plan.md](plan.md). Each topic: Decision, Rationale, Alternatives considered. Sources:
the proof of concept (`src/`), `context/homm3-parser` (MIT, port with attribution),
`context/heroes_iii_android` (h3lwp, no license — facts only), item 1 tooling
(`tools/reference-env/`), and the local Complete install.

## Environment facts (measured 2026-09-14)

- Node 22.22.2 runs `.ts` directly (type stripping); `tsconfig` uses `erasableSyntaxOnly`,
  `verbatimModuleSyntax`, `allowImportingTsExtensions` — no enums/namespaces/parameter
  properties, `.ts` import extensions, `import type`.
- `/usr/bin/chromium-browser` 152 is installed; no Playwright browsers are downloaded.
- Install `Maps/` holds 215 `.h3m`: 47 RoE (0x0E), 54 AB (0x15), 56 SoD (0x1C), 58 HotA (0x20).
  Base-game sizes 36/72/108/144; largest base-game map is 144×144 (18 maps). No real base-game
  252×252 map exists.
- Install `Data/` archives: `h3sprite.lod` (64 MB), `H3ab_spr.lod`, `h3bitmap.lod`,
  `h3ab_bmp.lod`, plus RoE-era `sprite.lod`/`bitmap.lod` and HotA archives (not used).

## 1. Runtime stack

**Decision**: plain TypeScript + raw WebGL 1.0, no runtime dependencies. Drop `pixi.js`,
`preact`, `@preact/preset-vite`, `pako`, `fflate`, `lzma-purejs`. Decompression uses the
platform's `DecompressionStream` (`deflate` for zlib LOD entries, `gzip` for H3M), available in
Chromium ≥ 80 (all target hosts: current CEF, Qt WebEngine 6) and Node ≥ 18. Build with Vite,
test with Vitest (kept).

**Rationale**: the renderer needs exactly one textured-quad program with a palette lookup;
Pixi.js (~100 KB+ gzipped alone) exceeds the whole runtime budget and its abstractions caused
the PoC's per-tile sprites and re-baked textures. The dev harness UI is two file inputs and a
status line — DOM APIs suffice, no framework. Native decompression costs 0 bytes and is faster
than JS inflate. Estimated runtime: parsers ~15 KB, state/sim ~5 KB, renderer ~8 KB, runtime
(worker, cache, scheduler) ~5 KB gzipped — well under 100 KB.

**Alternatives considered**: Pixi.js (budget, WebGL 2 paths, no palette shaders); twgl/regl
(small but unnecessary for one program); fflate (~8 KB, justified only if a host lacks
`DecompressionStream` — none of the targets does; revisit in item 3 if a host proves otherwise);
Preact (~4 KB, nothing to render declaratively).

## 2. Development-only tooling

**Decision**: add `playwright-core` (Apache-2.0, dev only) driving the system Chromium
(`/usr/bin/chromium-browser`, overridable by `H3_CHROMIUM` env) with SwiftShader WebGL
(`--use-angle=swiftshader --enable-unsafe-swiftshader`) for headless render, fidelity, and
budget checks. PNG encode/decode is a small in-repo module on `node:zlib` (tools only).
Layer-dependency check is an in-repo script using the TypeScript compiler API (already a dev
dependency).

**Rationale**: SwiftShader gives deterministic, GPU-independent output (SC-008) and runs on a
headless Linux box. `playwright-core` downloads no browsers. ffmpeg-based PNG I/O from item 1
works but costs a process per image; a node:zlib codec is ~150 lines and needed for CLI PNG
export anyway. dependency-cruiser would add a large dev dependency for a ~80-line check.

**Alternatives considered**: headless-gl in Node (native build, old WebGL, differs from
Chromium); a CPU software renderer duplicating the GPU path (double implementation — instead
the renderer's CPU-side draw plan is unit-tested in Node); Puppeteer (similar, Playwright CDP
access for throttling/metrics is equally good).

## 3. Porting vs rewriting parsers

**Decision**: rewrite all parsers on a hand-written bounds-checked `ByteReader` over
`DataView`; use `homm3-parser` as the layout reference for H3M (port of structure →
attribution to Sergey Kostyrko, MIT, in `THIRD_PARTY_NOTICES.md`), cross-checked against VCMI
behavior (study only). Object bodies are an exhaustive `switch` over class id that yields an
explicit `unsupported` error for unknown ids.

**Rationale**: `homm3-parser` is built on the `binary-markup` DSL with no offsets or typed errors
(Principle VII unmet) and pixel arrays via `concat`. Its skip values are correct; known defects
to fix while porting: AB placeholder-hero ids not read; player hero block layout (face/name and
hero list conditions) to verify; `DefeatMonster` victory condition missing (desync); no 0xFF
"none" for win/loss; town building bitmask typos; event player masks lost; unmapped object
classes fall through silently; `content.buffer` ignores byteOffset.

**Alternatives considered**: vendoring `homm3-parser` + `binary-markup` (fails VII, extra
runtime dep); keeping PoC `H3mReader` (guesses skips).

## 4. Format details (facts for implementation)

- **LOD**: magic `LOD\0`, u32 at 4 = 200 (base game), file count u32 at 8, entries from offset 92,
  32 bytes each: name[16] NUL-terminated, offset u32, size u32, type u32, compressedSize u32
  (0 = stored, else zlib). Lookup case-insensitive. HotA 1.8 header marker (byte 12 == 135)
  → `unsupported` error.
- **DEF**: u32 type, fullW, fullH, groupCount; 768-byte palette; groups: type u32, count u32,
  8 unknown bytes, count × name[13], count × u32 offset. Frame header 32 bytes: size, compression,
  fullW, fullH, w, h, x, y. Compression 0 raw; 1 u32 row offsets + (index, len−1) runs, 0xFF =
  raw; 2 and 3 packed code bytes `idx=code>>5, len=(code&0x1F)+1`, idx 7 = raw, 3 with per-32px
  u16 offsets. Old-format quirk: compression 1 with w>fullW && h>fullH → use full size, x=y=0,
  data 16 bytes earlier. Special indices: 0 transparent, 1–4 shadow, 5 flag/selection, 6–7
  shadow variants (renderer treats per layer; terrain uses none).
- **PCX** (in LOD): u32 size, width, height; size == w×h → 8-bit + trailing 768-byte palette;
  size == w×h×3 → 24-bit BGR.
- **H3M tiles**: size² × levels records of 7 bytes (terrain, terrainView, river, riverView,
  road, roadView, flags); index `z·size² + y·size + x`. Flags: bits 0/1 terrain H/V flip, 2/3
  river, 4/5 road, 6 "coast" (kept, unused in rendering).
- **Ids**: terrain 0–9 dirttl, sandtl, grastl, snowtl, swmptl, rougtl, subbtl, lavatl, watrtl,
  rocktl (10/11 highland/wasteland are HotA). River 0 none, 1 clrrvr, 2 icyrvr, 3 mudrvr, 4 lavrvr
  (PoC was off by one). Road 0 none, 1 dirtrd, 2 gravrd, 3 cobbrd.
- **Frame selection**: the view index addresses the concatenation of all groups' frame lists in
  file order (PoC read only group 0). Terrain frames are placed at (x, y) inside the full 32×32
  frame, not stretched.
- **Draw order**: terrain → river → road → (objects, later) → map border.
- **Road offset** (measured 2026-09-15): roads are drawn 16 px (half a tile) **down**. Evidence: an
  original-editor still of `Merchant Princes.h3m` (28 road tiles in view) matches best with +16
  (7 402 differing road pixels vs 12 814 at 0 and 10 982 at −16, same result with RGB565 and raw
  colours) and matches visually. Game stills with roads could not be taken: `yarn ref still` failed
  on two road maps (level switch on `Shadow Valleys.h3m`, reveal cheat on `Merchant Princes.h3m`) —
  a reference-tooling limitation recorded for item 3.1. The editor draws true colour (no RGB565),
  so editor stills are placement references only (constitution II).
- **Object anchor**: the full frame's bottom-right corner sits on the bottom-right of the
  object's tile; sprites extend up-left. Sort (later feature): placement order, y, heroes last,
  visitable after non-visitable, x.
- **Map border** (measured 2026-09-15 on Arrogance edge stills, not random): `edg.def` frames tile
  the world in a 4×4 pattern — fill `4·(y mod 4) + (x mod 4)`, top edge row `20 + (x mod 4)`,
  bottom edge row `28 + (x mod 4)`; right/left edge columns `24 + (y mod 4)` / `32 + (y mod 4)`
  and corners 16–19 follow the same scheme (not yet seen in a capture). Border pixels are compared,
  not masked.

## 5. Palette animation

**Decision**: typed table (from h3lwp facts, corrected for inclusive/exclusive ends):
water `watrtl` indices 229–240 and 242–253; lava `lavatl` **246–254 (nine colours, measured
2026-09-15: all mismatching underground lava pixels had index 254 with the eight-colour range; with
nine colours every underground still matches)**; clear river `clrrvr` 183–194
and 195–200; mud river `mudrvr` 183–188 and 240–245; lava river `lavrvr` 240–247; icy river none.
Direction (**measured 2026-09-15**, opposite to h3lwp): each step `new[i] = old[i−1]`, the last
colour moves to the start — in five water clips the matching step index decreases by one per step.
Step duration: **180 ms** — the dominant interval between palette changes in five 60 fps clips
(167 or 183 ms, as expected for 180 ms at 60 fps). About one step in nine is held for an extra
~180 ms, which makes the mean 195–203 ms; the matched step index still advances by exactly one per
change. The holds are attributed to the capture environment (Wine on Xvfb) and not reproduced; the
clip check measures the median interval.

**Phase model (to confirm by measurement, T066)**: working hypothesis — one global step counter
`k` advanced every step for all rotations, each range rotated by `k mod length`. Cycle lengths
12, 8 and 6 give a joint period of LCM = 24 steps, so a still's animation state is searched over
`k = 0…23`. If the clip shows ranges advancing independently (different step durations or
unrelated phases), the table gets per-rotation `stepMs` and the fidelity search becomes
per-rotation (each range's step chosen independently on its own pixels). The chosen model is
recorded here and used by both the renderer and `verify fidelity`.

**Implementation**: terrain/river/road frames are uploaded once as 8-bit index textures
(`LUMINANCE`, NEAREST); each DEF's palette is one row of a 256×N `RGBA` palette texture. On an
animation step the CPU rotates the affected rows and updates them with `texSubImage2D`
(≤ 5 rows × 256 texels) — data update of an existing texture, no new textures (IV). The fragment
shader samples index → palette row → color; index 0 on river/road layers is discarded.

**Alternatives considered**: computing rotation in the shader from a uniform step and range
table (possible, but index remapping with mediump float on old GPUs is error-prone; the
row-update is cheaper to verify); PoC's baking a texture per step (forbidden by IV).

## 6. Screen-bound renderer design

**Decision**:
- Canvas backing size = CSS size × DPR (capped at display × DPR); tile size 32 device-independent
  pixels at scale 1 (scale setting is item 3).
- One atlas per archive session built from the terrain, river, road and border DEFs (~1,200
  frames × 32² ≈ 1.2 MP → 1–2 textures of ≤ 2048², within HD 3000 limits).
- A dynamic vertex buffer holds quads only for tiles in view (+1 tile margin) for the three
  layers plus border; rebuilt when the camera crosses a tile boundary or state changes, otherwise
  reused. Scrolling within a tile updates only a translation uniform. One program, ≤ 4 draw calls.
- No `ANGLE_instanced_arrays` (not needed). `webglcontextlost/restored` rebuild GPU resources from
  retained CPU-side atlas bytes.
- The CPU "draw plan" (tile → atlas frame, flip, palette row) is a pure function tested in Node.

**Rationale**: GPU memory and per-frame work depend only on viewport size (IV, SC-007).

**Alternatives considered**: chunked static map meshes (memory scales with map size); instancing
(extension dependency without benefit at this quad count).

## 7. Frame scheduling and lifecycle

**Decision**: a scheduler requests an animation frame only when (a) the camera or state changed,
or (b) a palette-animated tile is in view and the next animation step time is reached (timer
aligned to step boundaries of the injectable clock). Hidden/paused → no scheduled callbacks at
all; resume recomputes the step from the clock. The harness forwards `visibilitychange`.

## 8. Off-main-thread work and cache

**Decision**: one module Worker performs archive entry reads, DEF decode, atlas packing, and map
parsing → world state; transfers `ArrayBuffer`s back. Files are read by range (`File.slice`) —
the 64 MB LOD is never loaded whole. Cache: IndexedDB database `h3dynam`, stores `atlas` and
`world`, key = `formatVersion:cacheSchema:identity`. Identity: map = SHA-256 of file bytes
(small); archive = SHA-256 of (size, lastModified, header + entry table bytes) — full hashing of
64 MB under 4× CPU throttle would threaten the cold-start budget. Cache failures log a warning and
fall back to decoding.

**Alternatives considered**: full-file hash for archives (slow); Cache Storage API (awkward for
binary blobs keyed by identity); OPFS (less supported in older Qt WebEngine).

## 9. Floating tiles and object masks

**Decision**: footprints are computed from real sprite pixels, not tile counts:
- Candidate outcomes per random class come from the game's own template table read at run time
  from the user's `h3bitmap.lod`: `Objects.txt` (1326 templates: DEF, masks, terrains, class,
  subclass). **Measured 2026-09-15**: `ObjTmplt.txt` in the Complete install is a 2-line stub
  (random-map generator leftovers), and `CrTraits.txt` has no creature level column (level is
  implied by row order only). Decision: candidates are chosen conservatively per outcome class —
  every template of class 54 (monsters) for any random monster level, class 5 for random
  artifacts, 79 for random resources, 98 for random towns, 17 for random dwellings, 34 for random
  heroes/placeholders — and filtered by the random object's allowed terrain only where the game
  also does. Over-masking a few pixels is safe for floating tiles; under-masking is not. Classes:
  random artifact 65–69, random hero 70, random monster 71–75 and 162–164, random resource 76,
  random town 77, random dwellings 216–218 (respecting faction/level constraints from the object
  body), and hero placeholder 214. Nothing derived is committed (Principle I).
- **Generated starting heroes**: a player's main town with `generateHero` gets a hero from the
  game at start that is *not* in the object list. In `fixed` start mode the hero choice is set,
  but it is not tied to the map, so its sprite is treated as random: candidates = hero map DEFs
  of every hero class (`Objects.txt` class 34), anchored at the town's entrance tile (the
  town's visitable tile from its template's active mask); for random towns, at the same tile for
  every town template. These tiles are floating.
- Footprint of a candidate = union over all frames of non-transparent pixels (shadows included),
  anchored bottom-right at the object tile; floating tile set = union over candidates; a tile is
  floating if any such pixel falls in it. This yields the 2×2 monster areas naturally.
- Output format for `--floating-tiles`: `"x,y;x,y"` per level (item 1 keys carry no level;
  selfcheck runs on level 0), plus a JSON form with causing objects.
- Fidelity object masks (non-random objects, not yet drawn) use the same pixel footprints of the
  object's actual DEF.

**Alternatives considered**: tile-level bounding boxes (over-masks trees/mountains, reducing
checkable area); hardcoded 2×2 for monsters (wrong for dwellings and towns — town sprites span
up to 8×6).

## 10. Fidelity check

**Decision**: `yarn verify fidelity --map M --level L --region x0,y0,x1,y1 [--capture ID]`:
1. `findCaptures` (item 1 `store/lookup.ts`, imported in-process) → newest still (and clip).
2. Headless Chromium renders the capture's visible tile range at the capture's pixel mapping
   (tile size 32, origin) for every animation state of the phase model (§5: `k = 0…23`, or
   per-rotation steps); the best-matching state is chosen (the still's phase is unknown).
3. Pixel classes: `excluded:outside-viewport`, `excluded:volatile` (capture mask),
   `excluded:object` (object footprints), `excluded:floating` (random objects and generated
   starting heroes), `excluded:border` (if border proves random), `compared`, `differing`.
   **Palette-animated pixels are not excluded as volatile**: the still's volatile mask is built
   from ~2 s of grabs (`tools/reference-env/commands/still.ts`), so it marks all water and lava.
   Pixels of tiles that the draw plan marks as animated (their terrain/river frame uses a
   rotating palette) ignore the volatile mask and are compared under the chosen animation state;
   object, floating and viewport exclusions still apply to them.
4. Outcome: `fail` if any compared pixel differs; otherwise `not-checkable` when compared pixels
   < **25 %** of in-map viewport pixels of the region, for any cause, with the excluded share per
   cause (and `randomCauses` when floating contributes) — appended to
   `reference-captures/visual-review.json`; otherwise `pass`. `skip` when game files or captures
   are absent. A region never passes on a near-empty comparison.
5. Clips: for each distinct captured frame find the matching palette step on water/lava tiles;
   consecutive steps must advance by one in the table's direction; mean step duration within one
   capture frame interval of the table value (SC-005).

**Rationale**: 25 % of a region still leaves thousands of pixels in an ordinary view, while
regions dominated by random monsters/dwellings or dense objects are reported honestly instead of
passing on almost nothing; `fail` takes precedence because any real difference is a finding. The
number is tunable in the data module and recorded in each report.

## 11. Budget checks and SC-007 tolerance

**Decision**: `yarn verify budget` builds, then in headless Chromium at 1920×1080, DPR 1, CPU
throttling 4× (CDP `Emulation.setCPUThrottlingRate`):
- runtime JS size: gzip of `dist` JS reachable from the runtime entry (harness-only code excluded);
- cold start (empty IndexedDB) and warm start: `performance.mark` from files supplied to first
  presented frame;
- memory: CDP `JSHeapUsedSize` + renderer-accounted GPU bytes (every texture/buffer allocation
  goes through a counting wrapper);
- surface: canvas `width×height` vs `screen × DPR`;
- idle cadence: frames over 10 s ≤ 10 000 / step ms + 1; hidden: 0 frames and 0 pending timers
  over 5 s (`document.visibilityState` emulated via CDP).
- SC-007 tolerance: for 36×36 vs synthetic 252×252 two-level map at the same viewport, draw calls,
  vertex count and GPU bytes MUST be equal (±1 % for GPU bytes), and median per-frame CPU time
  within **20 %** or 0.5 ms, whichever is larger.
- Maps used: `Arrogance.h3m` (36×36), the largest install 144×144 SoD map, synthetic 252×252.

## 12. Synthetic fixtures

**Decision**: committed TS generators (`test/fixtures/synthetic/`) build in memory: an H3M writer
producing maps of any size/version with every object class body (RoE/AB/SoD), and a LOD writer
with synthetic DEFs/PCX (procedural patterns and palettes, all compression types). The 252×252
two-level stress map uses these. Generated files are written only to temp dirs.

**Rationale**: Principle I — no game content in the repo; lets CI run without game files.
The `homm3-parser` fixture maps (author-made, MIT repo) are used only locally from `context/`
as extra regression inputs (context is git-ignored), not copied.

## 13. Real-file test sets

**Decision**: tests resolve game files via item 1 config (`H3REF_BUNDLE_DIR` /
`reference-env.config.json` `bundleDir`) → `<bundle>/Maps`, `<bundle>/Data`, plus
`public/dev-assets/`; absent → `describe.skip` with a logged reason. Parse-all test iterates
every `.h3m` in `Maps/` (SC-002a: base-game parse fully, HotA → typed unsupported). Known values
are recorded as file name + SHA-256 + expected values in test code (facts, not game data).

## 14. PoC removal and sync script

**Decision**: delete `src/` PoC modules, `test/{h3m,lod,palette-rotation}.test.ts`,
`scripts/sync.js`, and the `sync`/`sync:watch` scripts. Wallpaper Engine packaging returns as an
adapter build step in item 3; `project.json` stays for that feature but is not copied by this
feature's build. `.opencode/skills/developing-preact` is dropped (Preact removed).

## Implementation findings (2026-09-15)

- **16-bit display colour**: the original game shows palette colours through RGB565. Every capture
  channel has exactly 32/64/32 distinct values; a palette colour (r, g, b) appears as
  `(round((r>>3)·255/31), round((g>>2)·255/63), round((b>>3)·255/31))`. The atlas palette applies
  this conversion (`toDisplayColor`), which made dirt/rough/sand/river tiles match captures exactly.
- **Viewport corner ornaments**: the adventure map viewport (592×544 at (8, 8)) has UI ornaments in
  its four corners (about 45×45 px each) drawn over the map. They are identical in all 111 local
  stills, so the fidelity check derives the mask at run time from the local captures (pixels in
  64×64 corner squares that are equal across stills of different positions); the mask is not
  committed (derived from game output).
- **Terrain match**: with RGB565, the measured border rule and object/floating footprints, a software
  render of 31 of 32 distinct captured views differs from the capture only in the corner ornament
  areas (600–2100 px of 120 000–265 000 compared). Outlier: level 1 view at origin (1, 0) —
  investigated in the fidelity task.
- **Palette phase**: one global step counter for all sprites (water, clear river and lava steps in
  every still agree modulo their cycle lengths; joint period LCM(12, 9, 6, 8) = 72 states). In clips
  all sprites stay in lock. **Stills can catch the game mid-update**: in 5 of 30 stills of the same
  view the clear river is exactly one step behind the water. The still comparison therefore lets
  each animated sprite use the global step or a neighbour (report field `paletteStepsBySprite`);
  clips still require all sprites in lock.
- **Generated starting heroes**: heroes are not in Objects.txt; the adventure-map hero sprites are
  `ah00_.def`–`ah17_.def` (+ flags `af00.def`–`af07.def`), and a hero's anchor is one tile right of
  the tile it stands on (hero templates in maps have their visitable bit at x − 1).
- **Misaligned captures (item 1 tooling defect)**: the stills of the view requested at the top map
  edge with visible range x1–19, y0–16 (both levels) record `originPixel.y` 32 px too small; with a
  one-tile shift they match. `verify fidelity` detects this and reports `skip: capture-misaligned`.
- **Roads**: Arrogance captures contain no road tiles; the offset was measured on an editor still of another map (see §4).
- **Parser corpus**: all 157 base-game install maps + Arrogance + 18 homm3-parser fixtures parse with
  strict padding checks, and parse → write reproduces all 158 install/dev maps byte for byte. Layout
  corrections versus homm3-parser: message/guard block (`hasMessage` → message, `hasGuards` → army,
  4 zero bytes); player block (face/name only when a main hero is set; AB+ unknown byte and hero list
  always); unplayable player slots are a fixed 6/12/13-byte block; AB placeholder hero ids; SoD seer
  huts without a quest end with 3 zero bytes; map files end with zero padding (usually 124 bytes).

## Floating tiles end to end (T063, 2026-09-15)

`yarn ref selfcheck --map Arrogance.h3m --runs 3 --samples 0 --floating-tiles "$(yarn -s h3 map
floating Arrogance.h3m --level 0 | jq -r .tiles)"` against the original game: ok, all runs
identical outside floating tiles (0 differing pixels); the differences between launches (6–32 px)
fell on the generated floating tiles 20,25 and 21,25 (SC-003).

## Fidelity results (T089, 2026-09-15)

`yarn verify fidelity --map Arrogance.h3m --all-regions` (32 distinct still views + 1 clip view,
26 s): **30 stills pass with 0 differing compared pixels**, 2 stills `skip: capture-misaligned`
(item 1 record defect above), the clip passes (median step 183 ms, all steps in order). The WebGL
frame matched the reference rasterizer bit for bit in every check. Passing views cover both levels,
water (up to 167 000 compared animated pixels in one view), lava, clear rivers, and the top and
bottom map edges with border (SC-004, SC-005). No region was not-checkable; floating exclusions
were 3 000–50 000 px per view. Mud rivers, lava rivers, roads and map corners are not in any game
capture yet.

## Budget results (T095, 2026-09-15)

`yarn verify budget` at 1920×1080, DPR 1, CPU throttling 4×, system Chromium 152 with SwiftShader
(all pass). Memory is the main-thread JS heap plus renderer-accounted GPU bytes; the decode worker
holds no data after loading. SC-007 compares the vertex buffer capacity (sized by the view), because
a 36×36 map is smaller than a 1920×1080 view and shows border where the large map shows terrain.

| Budget | Map | Measured | Limit | Status |
| --- | --- | --- | --- | --- |
| runtime-js-gzip | — | 32111 | 102400 bytes | pass |
| cold-start | Arrogance.h3m | 684.3 | 10000 ms | pass |
| warm-start | Arrogance.h3m | 428.6 | 2000 ms | pass |
| memory | Arrogance.h3m | 5733984 | 314572800 bytes | pass |
| surface | Arrogance.h3m | 2073600 | 2073600 px | pass |
| hidden-frames | Arrogance.h3m | 0 | 0 frames | pass |
| hidden-timers | Arrogance.h3m | 0 | 0 callbacks | pass |
| idle-cadence | Arrogance.h3m | 28 | 28 frames | pass |
| cold-start | Pandora's Box .h3m | 1405.3 | 10000 ms | pass |
| warm-start | Pandora's Box .h3m | 580.3 | 2000 ms | pass |
| memory | Pandora's Box .h3m | 6658404 | 314572800 bytes | pass |
| surface | Pandora's Box .h3m | 2073600 | 2073600 px | pass |
| hidden-frames | Pandora's Box .h3m | 0 | 0 frames | pass |
| hidden-timers | Pandora's Box .h3m | 0 | 0 callbacks | pass |
| idle-cadence | Pandora's Box .h3m | 28 | 28 frames | pass |
| cold-start | synthetic-252x252x2.h3m | 853.9 | 10000 ms | pass |
| warm-start | synthetic-252x252x2.h3m | 655.6 | 2000 ms | pass |
| memory | synthetic-252x252x2.h3m | 5503340 | 314572800 bytes | pass |
| surface | synthetic-252x252x2.h3m | 2073600 | 2073600 px | pass |
| hidden-frames | synthetic-252x252x2.h3m | 0 | 0 frames | pass |
| hidden-timers | synthetic-252x252x2.h3m | 0 | 0 callbacks | pass |
| idle-cadence | synthetic-252x252x2.h3m | 28 | 28 frames | pass |
| sc007-draw-calls | — | 1 | 1 calls | pass |
| sc007-vertices | — | 47520 | 47520 vertices | pass |
| sc007-gpu-bytes | — | 2017408 | 2037582.1 bytes | pass |
| sc007-frame-cpu | — | 0.3 | 0.8 ms | pass |

## Open items resolved during implementation (not blocking the plan)

| Item | How resolved | Fallback |
| --- | --- | --- |
| Palette step duration and direction | **resolved**: 180 ms, last colour moves to the start | — |
| Shared vs independent palette phases | one clip with water and a river/lava in view | per-rotation search |
| River/road shadow indices 1–4 | fidelity diffs on river/road tiles (T089) | treat 1–4 as shadow alpha |
| Road vertical offset direction | **resolved**: +16 px (down), from an editor still | game-still confirmation when the capture tooling handles road maps |
| Border frame randomness | **resolved**: deterministic 4×4 pattern (see §4) | — |
| Player hero block / placeholder heroes layout | parse all 157 base-game install maps to exact end | VCMI study |
