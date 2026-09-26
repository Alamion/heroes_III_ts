# Data Model: Map Folder and Map Rotation

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

All entities are in-memory and per wallpaper instance, except the remembered folder (browser) and the cache
bookkeeping (IndexedDB, local only).

## MapSource

The user's choice, from settings.

| Field | Type | Rule |
| --- | --- | --- |
| `mapsource` | `'single' \| 'folder'` | default `single`; unknown values → `single` (logged) |
| `mapfolder` | `string \| null` | host value (path, `file://` URL, `userfiles\x.zip`); null = not chosen |
| `mapfile` | `string \| null` | unchanged from spec 004; kept while `folder` is active (FR-021) |

## CatalogueSource

Where entries come from; built by the host bridge, consumed by the controller.

| Variant | Fields | Produces entries by |
| --- | --- | --- |
| `listing` | `rootUrl` | `file://` directory listing, recursive to depth 4 (research R2) |
| `zip` | `url` or `Blob` | central directory of the archive (R3) |
| `files` | `File[]` (browser picker/drop) or remembered blobs | the given list |

Limits for every variant: 5 000 entries, only names ending in `.h3m` (case-insensitive), dot-names skipped.

## CatalogueEntry

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `number` | index in the catalogue, stable for the session |
| `path` | `string` | relative path inside the folder/archive, `/`-separated, for logs and the panel |
| `read` | `() => Promise<Blob>` | reads the map on demand (XHR, `Blob.slice` + inflate, or the `File`) |
| `status` | `'unknown' \| 'ok' \| 'filtered' \| 'failed'` | set by the picker; `failed` is final for the session |
| `summary` | `MapSummary \| null` | filled after the first read |
| `failure` | `string \| null` | reason for `failed` (logged) |

Two entries with the same content but different paths are distinct (spec edge case "duplicates").

## MapSummary

From `readMapSummary` (research R4); DOM-free, in `src/core/formats/h3m/summary.ts`.

| Field | Type | Notes |
| --- | --- | --- |
| `version` | `H3mVersion` | RoE/AB/SoD/HotA |
| `size` | `number` | tiles per side, 1..252 |
| `sizeClass` | `'s' \| 'm' \| 'l' \| 'xl' \| 'h' \| 'xh' \| 'g'` | smallest class ≥ size (`src/core/data/map-sizes.ts`) |
| `levels` | `1 \| 2` | from `hasUnderground` |
| `title` | `string` | the map's own name (may be empty; the panel then shows the path) |
| `needsHota` | `boolean` | version is HotA (`0x20`) |

## MapFilter

| Field | Type | Default | Rule |
| --- | --- | --- | --- |
| `sizeMin` | size class | `s` | if `sizeMin > sizeMax` the two are swapped (logged) |
| `sizeMax` | size class | `g` | |
| `underground` | `'any' \| 'two' \| 'one'` | `any` | `two` → `levels = 2`, `one` → `levels = 1` |

An entry also fails the filter when `needsHota` and no HotA archive is loaded; this is not a user filter and
the entry becomes eligible again when the HotA archive arrives (spec edge case).

## Rotation

| Field | Type | Notes |
| --- | --- | --- |
| `order` | `number[]` | shuffled entry ids of the current cycle (seeded, research R7) |
| `cursor` | `number` | next position in `order` |
| `cycle` | `number` | cycle counter, part of the shuffle seed |
| `current` | `number \| null` | entry shown now |
| `intervalMinutes` | `number` | `maprotation`, 0..1440, 0 = never |
| `activeMs` | `number` | visible running time since the last switch (research R8) |

State transitions of the folder source (controller phase in brackets):

```text
no folder ──set mapfolder──▶ listing [loading]
listing ──no .h3m / unreadable──▶ FOLDER_EMPTY [problem]
listing ──entries──▶ picking [loading]
picking ──entry read+summary+filter ok──▶ preparing [loading, or showing if a map is already shown]
picking ──entry fails/filtered──▶ picking (next entry)
picking ──pass exhausted──▶ FOLDER_FILTERED | FOLDER_UNREADABLE [problem, or keep showing the current map]
preparing ──prepared──▶ showing (showPreparedMap) [showing]
preparing ──prepare fails──▶ picking (entry marked failed)
showing ──interval elapsed (active time) / "next map now" / filter excludes current──▶ picking
showing ──mapsource = single──▶ single-map behaviour of spec 004
```

While a map is showing, a failed pass never removes it: the wallpaper keeps the current map and logs the
reason (the message appears only when nothing is showing).

## PreparedMap (engine)

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | display name |
| `identity` | `string` | map identity (decode cache key part) |
| `world` | `WorldState` | parsed map |
| `objects` | object layer data or `null` | `null` without a data archive |
| `generation` | `number` | discarded if the archives changed or a newer prepare started |

Owned by the engine until `showPreparedMap` or `discardPreparedMap`; see [contracts/engine-api.md](contracts/engine-api.md).

## RememberedFolder (browser only)

IndexedDB `h3dynam-files`, store `userFiles` (research R9):

| Key | Value |
| --- | --- |
| `folder` | `{ name, count, savedAt }` |
| `folder:<path>` | `{ path, blob }` per map |

Limits: 5 000 entries, 256 MB; above them the folder is kept for the session only (logged). Replaced as a whole
when a new folder is chosen; cleared by "forget files" together with the other remembered files.

## Cache bookkeeping

IndexedDB `h3dynam`, new store `recent` (`CACHE_SCHEMA` 9): `mapIdentity → lastUsed` (ms). After a `put` into
`world` or `objects`, entries of all but the 8 most recent map identities are deleted from both stores.
