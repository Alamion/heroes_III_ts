# Contract: Engine, Runtime and Core Additions

Extends [spec 004 contracts/engine-api.md](../../004-platform-adapters/contracts/engine-api.md). Rationale:
[research.md](../research.md) R3, R4, R6, R10.

## Engine (`src/runtime/engine.ts`)

```ts
interface PreparedMap {
  readonly name: string
  readonly identity: string
  readonly size: number
  readonly levels: number
}

interface Engine {
  // … existing members unchanged; loadMap keeps its behaviour for the single-map source …

  /**
   * Parses the map and builds its object layer off the renderer. The currently shown map keeps rendering
   * and animating. Resolves with a handle, or a LoadResult error (same codes as loadMap). A newer
   * prepareMap, or a change of the sprite, data or HotA archive while preparing, supersedes it
   * (error code SUPERSEDED).
   */
  prepareMap(file: Blob, name?: string): Promise<{ ok: true; prepared: PreparedMap; fromCache: boolean; warnings: Diagnostic[] } | Extract<LoadResult, { ok: false }>>

  /**
   * Shows a prepared map in one step: terrain, object layer and camera are replaced together before the next
   * frame, the previous map's GPU resources are released, and one frame is invalidated. Returns the placed
   * view like placeView, or undefined if the handle is stale (superseded or already shown).
   */
  showPreparedMap(prepared: PreparedMap, level: LevelChoice, placement: ViewPlacement): { level: number; fx: number; fy: number } | undefined

  /** Drops a prepared map that will not be shown (filter change, source switched). */
  discardPreparedMap(prepared: PreparedMap): void
}
```

Guarantees checked by tests:
- Between `prepareMap` and `showPreparedMap`, `stats()` reports the old map (same `objectPages`, camera) and
  frames keep coming at the usual cadence; `world()` is the old world.
- After `showPreparedMap`, the first frame drawn already has the new terrain, the new objects and the placed
  camera; `gpuBytes` equals that of a fresh engine that loaded the same map directly (± 1 %).
- Without a data archive, the prepared map has no object layer and the `DATA_ARCHIVE_MISSING` diagnostic works
  as for `loadMap`.
- `EngineStats` gains `preparedMaps: number` (0 or 1) so checks can see a leaked handle.

## Worker protocol (`src/runtime/protocol.ts`, `worker.ts`)

- `openMap` gains `keep: 'replace' | 'add'`: `add` keeps the currently shown world in the worker's map, so
  objects can be built for the prepared world; the worker keeps at most two worlds (shown and prepared) and a
  new request message `dropMap { identity }` releases one.
- `objectsReady` is unchanged; the engine holds its buffers until `showPreparedMap` uploads them.

## Decode cache (`src/runtime/cache.ts`, `cache-key.ts`)

- `CACHE_SCHEMA = 9`; new store `recent` (map identity → last use, ms).
- `DecodedCache.touch(mapIdentity)` records a use; after `put` into `world` or `objects`, entries of all but the
  **8** most recently used map identities are deleted from both stores. Failures degrade to a warning, as every
  cache failure does.

## Core

- `src/core/formats/zip/zip.ts`: `ZipArchive.open(source: ByteSource, name)` → `entries(): { path, method,
  compressedSize, size, offset }[]`, `read(entry): Promise<Uint8Array>` (stored or deflate-raw via the existing
  inflate helper). Errors: `FormatError` with codes `UNSUPPORTED_VERSION` (ZIP64, encryption, other methods) and
  the usual bounds errors, carrying file, offset and structure.
- `src/core/formats/h3m/summary.ts`: `readMapSummary(inflatedPrefix: Uint8Array, fileName): MapSummary`
  (throws `FormatError` like the full parser; a prefix that ends before the name is an error of kind
  `TRUNCATED`).
- `src/core/data/map-sizes.ts`: `MAP_SIZE_CLASSES` (`s`…`g` with tile counts) and `sizeClassOf(size)`.
- `src/runtime/file-kind.ts`: `summarizeMapFile(blob, name): Promise<MapSummary>` (inflate prefix +
  `readMapSummary`), bounded like `classifyFile`.

## Inspection CLI

`yarn h3 map info` already prints size and levels; new: `yarn h3 map summary MAP` prints `MapSummary` as JSON
(the same code path the wallpaper uses), and `yarn h3 map catalogue DIR|ZIP [--size-min m --size-max xl
--underground two] [--hota HotA.lod]` prints the catalogue with summaries and the filter verdict per entry — the offline twin of
what the wallpaper would pick from.
