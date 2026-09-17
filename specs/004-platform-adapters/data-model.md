# Data Model: Platform Adapters

Entities for [spec.md](spec.md), decisions in [research.md](research.md). Types are TypeScript-shaped
for precision; field names are the ones the code uses.

## FileSlot and FileKind

```ts
type FileSlot = 'spriteArchive' | 'dataArchive' | 'map'
type FileKind =
  | { kind: 'spriteArchive' } | { kind: 'dataArchive' }
  | { kind: 'map'; version: 'RoE' | 'AB' | 'SoD' }
  | { kind: 'unsupportedMap'; versionCode: number }   // HotA, WoG, Chronicles
  | { kind: 'unknownArchive' } | { kind: 'unknown' }
```

- Classification reads at most the LOD header + index, or the first 64 KB of a map inflated with early
  cancellation (R6); it never inflates a whole map.
- A classified file goes to the slot of its kind, regardless of the setting or drop that supplied it;
  a host setting pointing at a file of another kind yields `WRONG_KIND` naming the expected and found kind.

## UserFile

| Field | Type | Notes |
| --- | --- | --- |
| `slot` | `FileSlot` | after classification |
| `name` | `string` | display name (last path segment, decoded) |
| `source` | `{ type: 'url'; url: string } \| { type: 'blob'; blob: Blob }` | hosts give URLs, browser gives blobs |
| `identity` | `string \| null` | engine `LoadResult.identity` once loaded |
| `status` | `'missing' \| 'reading' \| 'loading' \| 'loaded' \| 'failed'` | |
| `problem` | `UserMessage \| null` | set when `failed` |

Browser only — **RememberedFile** in IndexedDB `h3dynam-files`, store `userFiles`, key = `slot`:
`{ slot, name, blob: Blob, savedAt: number }`. Deleted as a whole by "forget files".

## WallpaperSettings

One definition for all hosts ([contracts/settings.md](contracts/settings.md)).

| Key | Type | Default | Range / values | Applies without re-decode |
| --- | --- | --- | --- | --- |
| `spritearchive` | file | none | — | reload of that slot only |
| `dataarchive` | file | none | — | reload of that slot only |
| `mapfile` | file | none | — | map reload; archives kept |
| `level` | enum | `surface` | `surface`, `underground` | yes |
| `viewmode` | enum | `random` | `random`, `centre`, `coords` | yes |
| `viewx`, `viewy` | int | 50 | 0–100, step 1; shown only when `viewmode = coords` where the host supports conditions (not Lively) | yes |
| `scale` | enum | `1` | `1`, `2`, `3` | yes |
| `objects` | bool | `true` | — | yes |
| `language` | enum | `auto` | `auto`, `en`, `ru` (browser panel only; hosts use their own) | yes |

Reserved for a later phase (FR-018a), not implemented: `mapsource` (`file` default, `folder`),
`mapfolder` (directory), `maprotation` (minutes). Existing keys never change meaning.

Validation: unknown keys ignored (old `lodfile`, `hotalodfile`); out-of-range numbers clamped; unknown enum
values → default; all with one `debug` log line, no user message.

## ViewPlacement

```ts
type ViewPlacement =
  | { mode: 'random'; seed: number }
  | { mode: 'centre' }
  | { mode: 'coords'; fx: number; fy: number }     // 0..1
```

`placeView(world, level, placement, viewSizeWorldPx, borderTiles) → { level, offsetX, offsetY }`:
effective level = requested level if the map has it, else 0; `coords` maps `fx, fy` linearly between the
minimum and maximum clamped offsets; `random` draws `fx, fy` from `mulberry32(seed)`; a view larger than
the map is centred. Pure, in `src/core/render/view-placement.ts`.

Random re-roll happens only on controller start and map change, not on slider, scale or level changes
(level change keeps the fractions).

## HostSignals

What each bridge feeds the controller ([contracts/host-bridge.md](contracts/host-bridge.md)):

| Signal | Payload | WE | Lively | KDE | Browser |
| --- | --- | --- | --- | --- | --- |
| settings | `Partial<WallpaperSettings>` (file values as host paths/URLs) | `applyUserProperties` | `livelyPropertyListener` | `h3wallpaper.apply` | panel, drop, picker |
| paused | `boolean` | `setPaused` | `livelyWallpaperPlaybackChanged` | `h3wallpaper.setPaused` (covered/locked) | — |
| frameLimit | `number` (0 = none) | `applyGeneralProperties.fps` | — | — | — |
| language | `string` (BCP 47) | `navigator.language` (WE-6 may add a host value) | `navigator.language` | `Qt.uiLanguage` via `apply` | setting or `navigator.language` |
| resize | CSS size, DPR | `ResizeObserver` (all hosts) | same | same | same |
| hidden | `document.hidden` | all hosts | | | |

## ControllerState

```text
            files missing                      all needed files loaded
  start ──► Waiting ──(file supplied)──► Loading ─────────────────────────► Showing
               ▲                          │  │                               │
               │   last file removed      │  └─ failure, nothing shown ─► Problem (placeholder + message)
               └──────────────────────────┘                                  │
                                           failure while showing ──► Showing + message (previous map kept)
  Active = Showing ∧ ¬paused ∧ ¬hidden   (inactive → engine.setPaused/setVisible, 0 frames)
```

- `Waiting`: overlay lists missing slots (`spriteArchive`, `map` required; `dataArchive` optional → terrain
  only with message `DATA_ARCHIVE_MISSING`).
- Settings events are coalesced: the latest value per key within 150 ms is applied; file loads use
  last-wins generation numbers so an older read never replaces a newer one.

## UserMessage

`{ code: MessageCode; file?: string; detail?: string; level: 'info' | 'warn' | 'error' }`, rendered from the
string table in the current language. Codes: `MISSING_FILES`, `LOADING`, `FILE_MISSING`, `FILE_UNREADABLE`,
`WRONG_KIND`, `UNSUPPORTED_MAP`, `CORRUPT_FILE` (engine `FormatError`), `DATA_ARCHIVE_MISSING`,
`WEBGL_UNAVAILABLE`, `CONTEXT_LOST`, `CACHE_UNAVAILABLE` (logged only, shown only if a start exceeds the
budget). Messages auto-fade after 10 s except placeholder states; every message is also logged.

## StringTable

`en: Record<StringKey, string>`, `ru: Record<StringKey, string>` — same keys, enforced by type and by
`verify packages`. Keys cover setting labels and option labels, messages, panel texts, package
descriptions and per-host instructions (FR-023).

## Package

| Field | Notes |
| --- | --- |
| `host` | `web`, `wallpaper-engine`, `lively`, `kde` |
| `flavour` | `esm` (web) or `classic` (others), R3 |
| `files` | sorted list of `{ path, bytes, sha256 }` |
| `artifact` | folder (web, WE), `.zip` (Lively), `.tar.gz` (KDE) |
| `runtimeGzipBytes` | gzip of all shipped JS incl. embedded worker; ≤ 100 KB |
| `manifest` | generated host manifest(s) derived from settings + strings |

Package report (`check-reports/packages/<ts>/report.json`) lists these per host plus check outcomes
([contracts/cli.md](contracts/cli.md)).
