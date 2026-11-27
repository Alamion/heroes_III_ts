---
name: map-rendering
description: Maintain Heroes 3 map object rendering, object atlas residency and engine-worker synchronization. Use for graphics memory, view changes, atlas generation or draw fidelity.
---

# Map object rendering

## When to Use

Use for object graphics, atlas packing, region selection and engine/worker lifecycle.
For KDE host startup use `.claude/skills/kde-wallpaper/SKILL.md`.

## Steps

1. Read the constitution and `AGENTS.md`; inspect callers before changing contracts.
2. Resolve/render objects in `src/core/state/render-objects.ts` with the existing RNG.
   Reuse `ObjectIndex` in `src/core/state/object-index.ts` for view intersection.
3. Pack DEF frames with `src/core/render/object-atlas.ts`; preserve palette markers,
   full animation groups and deterministic packing. Do not add another packer/shader.
4. Decode through `src/runtime/decode.ts` and `worker.ts`; update `protocol.ts` and
   the no-worker route in `engine.ts` together.
5. Keep the atlas, object index and displayed camera consistent. Reuse engine load
   generations, prepared-world handling and renderer replacement methods.
6. Run targeted synthetic tests, real browser rendering and relevant corpus/budgets.
   Inspect fresh screenshots after the last rendering edit. Game files and derived
   images stay in ignored directories.

## Verified current behavior and reuse map

- The eager `decodeObjects` route resolves the entire map, reads each
  distinct DEF, packs the whole atlas and caches it by sources/map/seed/page size.
  An optional `ObjectRegion` now selects candidates before DEF pixel reads; full-map
  normalization still occurs first so phases/outcomes remain identical.
- `ObjectIndex.query` queries anchor buckets with `MAX_SPRITE_EXTENT`; it is conservative
  with primary-map dimensions checked in `test/real/object-region-extents.test.ts`
  (737 base / 1100 HotA sprites, maximum 256×192; not a promise for future mods).
- `src/core/render/camera.ts` owns `visibleRange` and `rangeContains`.
- `src/runtime/cache-key.ts` owns schema/key conventions and eight-map LRU limits.
- `src/runtime/engine.ts` owns all view setters and async preparation; the shared
  wallpaper controller calls `prepareMap` then synchronous `showPreparedMap`.
- `src/core/render/webgl-renderer.ts` owns GPU upload and object layer replacement;
  object plans use the per-tile draw order, never a global sprite sort.

## Regional wallpaper lifecycle

`EngineOptions.objectRegions: true` enables regional residency. It uses
2048 pages, the real worker protocol and the same no-worker decoder. The latest
requested camera is separate from the displayed camera; old complete graphics remain
until a matching region is ready. `renderNow` returns false while that target is pending.
Requests that become obsolete are discarded without committing their atlas.

`Engine.stats()` exposes `requestedCamera`, `objectRegion`, `objectRegionPending`,
`objectSpriteCount` and `objectAtlasBytes` on this route. Readiness checks must wait for
`objectRegionPending === false`, not only the existing terrain-ready status.

Regional disk caching overwrites one slot per source set/map/page size, with exact
region/seed identity in the payload. It does not append one record per visited place.
The existing map LRU owns eviction; whole-map cache entries remain compatible.

The first scenario has maintainer acceptance. `loadMap` and `prepareMap` accept the
future `PreparedView`; the controller selects it before decoding, avoiding an initial
center atlas. Folder preparation builds off-screen; `showPreparedMap` swaps complete
scenes. `whenViewReady()` is awaited by controller `idle()`, render harness and host
frame checks. Resize, scale, archive changes and context recovery rebuild matching
graphics; source versions reject stale work. `browser-controller.ts` in
`src/adapters/shared/` selects regions for WE/Lively/KDE; interactive web/dev harness
stay eager by default. No user setting is added.

Owner refinement: regional reads target non-interactive wallpaper hosts, with all animation
frames retained. Keep the browser's eager route for existing drag/scroll interaction. Future
wallpaper interaction may choose another residency/prefetch policy; do not bake host identity
or interaction assumptions into parsers, the atlas packer or draw plans.

Evidence: `test/runtime/object-regions.test.ts` covers selection, identity, bounded
cache and unseen types; `test/browser/object-regions.test.ts` exercises actual workers,
pixel equality, both levels, delayed replacement and rapid requests. Real HotA views
are compared with the whole-map route at fixed seed/time, at 960×540 and 480×540.
Personally inspected the eight `check-reports/region-atlas/hota-*.png` captures.
See `specs/010-region-atlas/research.md` for results and the next acceptance point.
Final rollout checks: strict build, 570 passing tests (11 skipped), layers, all-host
packages, real-file host simulations, corpus, determinism and budgets pass.
Twenty-cycle tests cover bounded GPU/cache residency; decoder spies check actual
archive reads. Native KDE install/restart and settings restoration passed.
Personally inspected final map-only crops live in
`check-reports/accept/2026-11-27T12-27-08-801Z/`:
`kde-wallpaper-crop.png` and `kde-objects-crop.png`. This does not establish real
Windows-host acceptance or reporter-specific CachyOS behavior.

Good: select complete intersecting sprites and all their frames in the worker.
Bad: filter anchors alone, append every visited region to disk forever, or switch
the displayed camera before its matching atlas exists.

## Checks

`yarn build`, `yarn test`, `yarn verify layers`, `yarn verify corpus`,
`yarn verify budget`, `yarn verify hosts`, `yarn verify packages`.
Use `test/browser/objects.test.ts`, `engine.test.ts`, `engine-prepare.test.ts` and
synthetic object helpers as current test entry points.
