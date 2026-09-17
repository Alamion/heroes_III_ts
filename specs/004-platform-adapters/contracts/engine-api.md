# Contract: Engine and Runtime Additions

Additive to [003 engine-api](../../003-map-objects/contracts/engine-api.md). Existing methods keep their
behaviour except where noted.

## EngineOptions

```ts
interface EngineOptions {
  // … existing
  /** Creates the decode worker. Default: module worker via import.meta.url (ESM builds only). */
  workerFactory?: () => Worker
}
```

Classic builds pass `() => new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })))`.

## Engine

```ts
interface Engine {
  // … existing
  /** Integer presentation scale 1..3; camera.scale = dpr × userScale; keeps the view centre. */
  setUserScale(scale: 1 | 2 | 3): void
  /** Positions the camera by placement (core/render/view-placement.ts) on the current map. */
  placeView(level: number, placement: ViewPlacement): { level: number; fx: number; fy: number }
  /** Minimum ms between presented frames; 0 = no limit. */
  setFrameLimit(fps: number): void
  /** Deletes all decoded cache entries (all stores). */
  forgetCache(): Promise<void>
}
```

Changed behaviour:
- `resize` and `loadMap` keep the user scale (today they reset `scale` to DPR).
- `loadArchive`, `loadDataArchive`, `loadMap` carry a per-slot generation; a result of an older call that
  finishes after a newer call for the same slot is dropped and returns `{ ok: false, error: { code:
  'SUPERSEDED' } }` without touching state or diagnostics.
- `loadMap` no longer recentres on its own when `placeView` is called before the first frame (the controller
  always calls `placeView` after `loadMap`).

## Runtime

- `src/runtime/file-kind.ts`: `classifyFile(blob: Blob): Promise<FileKind>` (R6).
- `src/runtime/cache.ts`: `DecodedCache.clear(): Promise<void>`.
- `src/runtime/worker.ts`: decode steps wrapped in `navigator.locks.request('h3dynam:decode:<identity>')`
  when available, cache re-checked inside the lock (R13).
- `src/runtime/scheduler.ts`: `minFrameIntervalMs`; a due frame earlier than the interval is deferred with
  one timer (still at most one rAF + one timer).

## Core

- `src/core/render/view-placement.ts`: `placeView(input) → { level, offsetX, offsetY, fx, fy }`, pure,
  DOM-free, unit-tested; uses `core/util` seeded RNG.
