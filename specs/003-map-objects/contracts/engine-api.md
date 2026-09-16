# Contract: Engine API (changes in spec 003)

Base contract: [002 engine-api.md](../../002-foundation-rewrite/contracts/engine-api.md). Only
additions and changed guarantees are listed; everything else is unchanged.

```ts
interface EngineOptions {
  // … unchanged fields (canvas, clock, logger, useWorker, cache, preserveDrawingBuffer,
  //     schedulerHost, borderTiles)
  seed?: number         // default 1; decides random-object outcomes (research §6)
  objects?: boolean     // default true; false draws terrain only (diagnosis, checks)
}

interface Engine {
  // … unchanged methods
  loadDataArchive(file: File | Blob & { name: string }): Promise<LoadResult>
                                              // h3bitmap.lod: Objects.txt (random outcomes) and
                                              // PLAYERS.PAL (flag colours); required for objects —
                                              // without it only terrain is drawn and a
                                              // data-archive-missing diagnostic is emitted
  setObjectsVisible(visible: boolean): void   // dev harness key `O`
  drawList(): DrawListEntry[]                 // objects in the current view, draw order
                                              // (data-model.md), test builds only
}

interface EngineStats /* extends 002 RendererStats */ {
  objectQuads: number
  objectPages: number          // object atlas pages
  objectDrawCalls: number
  objectPlanBuilds: number
  animatedObjectsInView: number
  nextChangeMs: number | null  // time of the next visible change (research §9)
}

type EngineDiagnostic =
  | /* 002 kinds */
  | { kind: 'missing-sprite'; def: string; objectIds: number[] }
  | { kind: 'object-atlas-overflow'; pages: number; bytes: number }
  | { kind: 'data-archive-missing' }
```

## Behaviour guarantees (new or changed)

- Objects of the current level are drawn after roads and before the map border, in the order of
  research §4; hidden classes are never drawn.
- A frame is presented only after a state/camera change, a palette step with rotating tiles in
  view, or an object tick with animated objects in view. The scheduler wakes at `nextChangeMs`;
  hidden or paused → no pending callbacks (unchanged).
- The same (archive, map, camera, time, seed, objects flag) gives the same pixels.
- A missing object sprite never fails `loadMap`: the object is skipped and one `missing-sprite`
  diagnostic lists all affected objects.
- Per-frame work, draw calls (1 terrain + ≤ object pages) and vertex capacity depend on the view,
  not on the map size or object count outside the view.

## Worker protocol

`mapReady` gains `objectAtlas: {layout, pages[], palettes}` (transferred) and `renderObjects`
(structured clone). The object atlas is built after the archive is open; `loadMap` before
`loadArchive` defers it. IndexedDB store `objectAtlas`, key
`objectAtlas:<schema>:<archiveId>:<mapId>:<seed>`; `CACHE_SCHEMA` is bumped.

## Render page (checks)

`render.html` `RenderParams` gain `dataArchiveUrl?: string` (h3bitmap.lod; objects are drawn only
with it), `seed?: number`, `tick?: number` (object tick; default derived
from `timeMs`, or equal to `step` when `step` is given), `objects?: boolean` (default true),
`objectFrames?: Record<def, frame>` (fidelity state search override) and `drawList?: boolean`
(return the draw list with the pixels).
