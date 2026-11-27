# Implementation Plan: View-scoped object graphics

**Branch**: `testing` | **Date**: 2026-11-27 | **Spec**: [spec.md](spec.md)

## Summary

Introduce region-aware object decoding through the existing worker/engine pipeline.
The opt-in single-map scenario was accepted by the owner. Continue with folder
preparation, tools and non-interactive wallpaper-host rollout. The browser and dev
harness retain eager graphics for their current drag/scroll interaction; callers
select the existing EngineOptions strategy. No new wallpaper setting is introduced.

Owner refinement: genuinely read only the needed object sprite entries for the
current wallpaper view (all animation frames retained). Keep the bounded region
mechanism separate from a future interactive prefetch/residency policy. Do not
implement speculative interaction or automatically disable animations.

## Technical Context

- TypeScript strict, Node 22, WebGL 1.0; no new runtime dependencies.
- Existing IndexedDB object store; one overwriteable regional atlas slot per
  map/archive-set/page-size instead of a record per visited region or seed.
- Vitest synthetic tests and real Chromium engine rendering; existing corpus/budgets.
- Targets remain browser, WE, Lively, KDE; no host-specific atlas implementation.
- Budget limits and minimum 2048 texture support remain unchanged.

## Constitution Check

1. User assets: local-only renders/captures; synthetic fixture generators committed.
2. Fidelity: same render objects, RNG order, atlas packer, palette and draw plans;
   compare deterministic regional views against whole-map output and game corpus.
3. Verification: synthetic selection/cache tests plus actual browser scenario and stats.
4. Performance: region-bound pixel packing/GPU upload; worker does heavy work. Retain
   one resident GPU atlas plus at most one pending CPU replacement. Logical world
   state is not required to be viewport-bound.
5. Platforms: change shared runtime/core only, use existing worker transports.
6. Layers: regional selection uses the existing state index and render camera types.
7. Failure: typed existing diagnostics, retain prior complete scene on failed replacement.
8. Dependencies: none added.

Pre-design and post-design checks pass for the proposed end state. The opt-in scenario
is an intermediate review artifact, not proof the existing whole-map default conforms.

## Project Structure and reuse decision

- `src/runtime/decode.ts::decodeObjects`: extend with optional level/tile region.
- `src/core/state/object-index.ts::ObjectIndex.query`: reuse conservative anchor selection.
- `src/core/render/object-atlas.ts::buildObjectAtlas`: reuse deterministic packing;
  do not introduce another packer or shader.
- `src/runtime/protocol.ts`, `worker.ts`: carry the region through both real worker and
  no-worker paths and include it in decode lock/result identity.
- `src/runtime/engine.ts`: track target vs displayed camera for async regional work;
  commit a complete matching layer/camera together. Keep previous complete view meanwhile.
- Existing `objectsKey`/generation handling rejects stale results; extend, do not fork it.
- Existing render/capture tooling supplies the visual oracle; no game-derived fixtures.

## First complete scenario and review point

Enable the developer option in the actual engine, load `test_map_hota.h3m`, capture
two distant views and both levels, and send rapid view changes. Compare regional
pixels to the old whole-map route at the same seed/time and inspect fresh captures.
Assert the regional sprite count/bytes stay independent of added off-screen objects.
Exercise a 2048 page size in decoding tests.

Accepted by the maintainer after pixel/visual/memory evidence was shown. Continue
the remaining lifecycle work; no new desktop deployment is authorized merely by
accepting the atlas. Keep browser interaction on its current eager route.

## Delivery phases

1. Region contract, selection, cache bounds and deterministic tests.
2. Opt-in engine navigation with old-view retention, real worker verification, screenshots.
3. **Maintainer review point.**
4. Extend `prepareMap` to know/prebuild the selected view before its atomic swap.
   Preserve existing prepared-world and archive-generation checks; do not build a
   whole-map fallback on minimum hardware.
5. Resize/scale/context recovery and tool synchronization; cold/warm/cache/folder matrix.
6. Enable regional objects for WE/Lively/KDE only when host invariants, budgets and
   corpus pass; preserve the interactive browser strategy and update skills.

## Complexity Tracking

No new dependency, UI primitive or rendering subsystem. Developer opt-in is temporary
staging for the explicit review point, not a permanent alternate implementation.
