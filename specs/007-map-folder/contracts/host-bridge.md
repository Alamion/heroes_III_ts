# Contract: Controller and Host Bridges (additions)

Extends [spec 004 contracts/host-bridge.md](../../004-platform-adapters/contracts/host-bridge.md). Rationale:
[research.md](../research.md) R1, R2, R5, R7, R8, R9.

## Controller (`src/adapters/shared/controller.ts`)

```ts
interface ControllerDeps {
  // … existing …
  /** Builds the catalogue for a `mapfolder` value already turned into a URL (listing or zip). */
  openCatalogue?: (url: string, name: string) => Promise<CatalogueEntry[]>
  /** Map summaries for the filters (default summarizeMapFile). */
  summarize?: (blob: Blob, name: string) => Promise<MapSummary>
}
// The remembered folder stays in the browser adapter (src/adapters/web/main.ts with
// indexedDbRememberedFolder), which calls supplyFolder at start: only the browser needs it.

interface WallpaperController {
  // … existing …
  /** Browser: a folder chosen, dropped or remembered, or a dropped .zip; switches the source to "folder". */
  supplyFolder(name: string, entries: () => Promise<CatalogueEntry[]>): Promise<void>
  /** "Next map now": only with the folder source; ignored while a switch is in progress. */
  nextMap(): void
}

interface ControllerSnapshot {
  // … existing …
  source: 'single' | 'folder'
  folder: {
    name: string | null
    entries: number
    shown: { path: string; title: string; size: number; levels: number } | null
    failed: number
    filtered: number
    switching: boolean
  } | null
}
```

Rules:
- The folder source never touches the `map` slot of spec 004: `mapfile` and its remembered file stay as they
  are, and switching back to `single` loads them again (FR-021).
- Candidates are tried in rotation order; a read, summary, filter or prepare failure moves to the next one with
  one `warn` log line. The problem messages (`FOLDER_EMPTY`, `FOLDER_FILTERED`, `FOLDER_UNREADABLE`) appear only
  when no map is showing; while one is showing it stays and the reason is logged.
- A switch always goes through `engine.prepareMap` → `engine.showPreparedMap`; the placement follows the
  level/view settings exactly as `applyView(true)` does at start (FR-013), and the place timer restarts from it.
- Timers: the map timer runs only while showing, not host-paused and not hidden, and counts active time
  (research R8). Nothing is read or prepared while hidden or paused; a switch that became due resumes when the
  wallpaper is active again.
- Filter change: re-evaluate; keep the current map if it matches, otherwise switch (FR-017). A HotA archive that
  arrives later makes `needsHota` entries eligible again.
- Every map shown is logged at `info`: `map shown: <title> (<path>, <size>×<size>, <levels> level(s))`.

## Wallpaper Engine

- `mapfolder` value (text) → `weFileUrl` → folder URL; `openCatalogue` lists it with the Chromium listing
  parser (recursive, limits in data-model), or opens it as a ZIP when it ends in `.zip`.
- `mapnext` toggles call `controller.nextMap()` (after `flushSettings`, like `viewreroll`).

## Lively

- `mapfolder` value `userfiles\maps.zip` → `livelyFileUrl`; `openCatalogue` reads the ZIP over `fetch`.
  A non-zip value is tried as a listing first and reported as `FOLDER_EMPTY` if the host does not list folders
  (LV-F1).
- `mapnext` button → `controller.nextMap()`.

## KDE

- `mapfolder` (`file://` URL from `FolderDialog`, or a typed path) → `kdeFileUrl`; listing as on Wallpaper
  Engine. If KDE-F1 finds no listing, the QML shell lists the folder with `FolderListModel` and passes
  `"mapfolderentries": [relative paths]` in `configJson()`; the page then builds the catalogue from those names.
- `mapnext` counter → `controller.nextMap()` on change after the first apply.

## Browser

- Panel "Choose a folder of maps" (`<input type=file webkitdirectory>`) and a dropped folder
  (`DataTransferItem.webkitGetAsEntry()`, walked recursively with the same limits) → `supplyFolder`.
- A dropped `.zip` → its entries → `supplyFolder` with the archive name.
- The remembered folder loads on start like the remembered files; "Forget files" clears it too.
- Key `N` = next map (with the folder source), next to `R`.

## Test hook

`__h3wallpaper.controller.state().folder` exposes the fields above; host simulations read it.

## New invariants for `yarn verify hosts`

14. Folder source on every host driver (Wallpaper Engine and KDE: a real `file://` folder with sub-folders and a
    Cyrillic name; Lively: a `.zip` in `userfiles/`; browser: directory input and folder drop) → `showing` with a
    map from the folder; non-map files ignored.
15. `nextMap` / the host's "next map" control 30 times over a folder of 5 maps → every map once per cycle, no map
    twice in a row, same sequence for the same seed.
16. 100 forced switches: a canvas sample every frame around each switch is never all-black and never the
    placeholder; `state().phase` stays `showing`; `gpuBytes` and JS heap after switch 100 within 10 % of after
    switch 1; `engine.preparedMaps` returns to 0.
17. Filters: with `mapsizemax = s` over a mixed folder only S maps are shown; with a filter nothing matches →
    `FOLDER_FILTERED` naming the filter; changing it back shows a map without a reload.
18. A folder where half the maps are broken (truncated, wrong version, not a map) rotates through the good ones
    with no user message; a folder of only broken maps → `FOLDER_UNREADABLE`; an empty folder → `FOLDER_EMPTY`.
19. Hidden/paused with `maprotation = 1` and a simulated 10 min: no map is read or prepared while hidden; after
    showing again the switch happens after the remaining active time.
20. Settings stored by the previous version (no folder keys) → `source = single`, same map and view as before.
