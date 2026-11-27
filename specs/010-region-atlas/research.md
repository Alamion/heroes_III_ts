# Region atlas decisions

**Date**: 2026-11-27

## Selection

Decision: select through `ObjectIndex.query(level, range)` before reading/decoding DEF
pixels. Reuse the same conservative anchor reach as the current renderer. Preserve
all frames for selected DEFs; do not filter animation frames by the current tick.
Normalize/randomize the full object list first so selection never changes RNG outcomes.

Rationale: a new spatial index or partial RNG pass could change object appearance.
Alternative rejected: filtering anchors to the visible rectangle clips large sprites.

Before default rollout, verify the existing `MAX_SPRITE_EXTENT` against base/HotA
full sprite dimensions, including moved anchors. If insufficient, extend the shared
index contract and its tests rather than adding a region-only magic margin.

## Identity and caching

Decision: identities include source identities, seed, page size, level and region.
The disk cache's regional storage key excludes seed/region; store their exact identity
in the value and overwrite this slot after a successful build. Different visited
regions/seeds must not create unbounded entries. Retain existing map LRU bookkeeping.

Rationale: appending viewport coordinates to the existing persistent key would grow
storage for every navigation. Alternative rejected: cache no regional work, which
would unnecessarily lose repeat-view/warm-start reuse.

## Atomic navigation

Decision: keep the previous displayed camera and object layer while a requested region
is built. Reject responses that no longer match the requested view/files/map. Commit
layer and displayed camera together and invalidate one frame. Within an already
covered region, update the displayed camera immediately.

Rationale: no terrain-only flash or stale object layout. Alternative rejected:
synchronously pack pixel data on the main thread.

## Scope staging

Decision: develop an opt-in single-map engine scenario first; retain production behavior
until maintainer review and lifecycle work. Folder preparation cannot simply pass the
current camera: the prepared world's selected view is not known until
`showPreparedMap` today. Phase 2 must bind/prebuild the intended future view.

The existing external Engine methods stay compatible; readiness becomes observable in
engine statistics for integration tools. No host settings or generated manifests change.

## First-scenario evidence (2026-11-27, historical prototype)

- `decodeObjects` accepts a validated `ObjectRegion`, normalizes the full map, then
  queries the existing index before reading selected DEF pixels. All frames are kept.
- The worker request/lock identity and no-worker route carry the same region.
- `EngineOptions.objectRegions: true` opts into a single-map review path using 2048
  pages. Normal host behavior is unchanged. Folder preparation explicitly reports
  `REGION_PREPARE_UNSUPPORTED` instead of allocating a whole-map fallback.
- Requested/displayed cameras are distinct. The old layer and camera stay resident
  while work is pending; matching results commit both together. `renderNow` returns
  false for a pending target; statistics expose pending state, both cameras, regional
  sprite count and atlas bytes.
- Decoder tests cover exact subset/phase preservation, malformed and missing levels,
  one disk slot across seeds/regions, and 1,000 added unseen sprite types.
- Actual Chromium/module-worker tests compare regional vs whole-map pixels at fixed
  seed 71, step 3, tick 7. Four synthetic views and eight real HotA views (four regions
  at 960×540 and 480×540; both levels, including dense highland forests) match exactly.
  Ten rapid requests after posting an older request finish at the latest target.
- Evidence: `check-reports/region-atlas/hota-results.json`, eight personally inspected
  `hota-*.png` screenshots, `check-reports/region-browser.log`. On the 960px views,
  regional atlas residency is 4.04–4.09 MiB (40–92 sprites) and total renderer GPU
  accounting is 13.14–13.57 MiB, versus 42.18–43.30 MiB with the whole-map path.
  At 480px, residency is 4.02–4.08 MiB (17–79 sprites).
- Package check after the prototype: KDE passes at 96,635 gzip bytes. `yarn build`,
  `yarn verify layers` and `git diff --check` pass. Final `yarn test`:
  **82 files passed, 2 skipped; 563 tests passed, 11 skipped**.
  Full-suite log: `check-reports/region-all-tests.log`. The four browser scenario
  tests and five regional decoder tests ran, including local real HotA files.

## Final rollout and checkpoint

The owner accepted the first scenario. T009–T012 are now implemented: initial and
prepared views are selected before sprite decode; complete folder scenes swap
atomically; resize/scale/archive/context recovery waits for matching graphics.
`whenViewReady()` connects controller/tool readiness to regional completion.
WE/Lively/KDE opt in through the existing shared browser controller; interactive web
remains eager. The prototype's `REGION_PREPARE_UNSUPPORTED` limitation is superseded.

Primary-map full sprite extent checks cover 737 base and 1100 HotA sprites (maximum
256×192). Archive spies verify selective reads; twenty navigation cycles verify
bounded GPU/cache residency. All frames are retained.

Final evidence in `check-reports/`: `region-final-tests.log` (570 passed, 11 skipped),
`region-final-layers.log`, `region-hosts-real.log`, `region-corpus.log` (no regressions),
`region-determinism.log`, `region-budget.log`; strict build and all-host packages pass.
The eight normal/narrow regional screenshots were personally inspected again.
Native final package installation/restart passed. After the owner's permission to
show/restore desktop, personally inspected visible terrain and objects in the actual
Plasma session. Retained map-only crops:
`check-reports/accept/2026-11-27T12-27-08-801Z/kde-wallpaper-crop.png` and
`check-reports/accept/2026-11-27T12-27-08-801Z/kde-objects-crop.png`.
Full desktop captures containing unrelated application content were removed.
The wallpaper settings and window visibility state were restored.

Implementation/validation complete locally; changes remain uncommitted. Next:
maintainer release decision. No publication, remote Git write, real Windows-host
acceptance or reporter-specific CachyOS confirmation is claimed.
