# Research: Map Folder and Map Rotation

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-25

Each entry: Decision, Rationale, Alternatives considered. Measurements are marked with their date and
environment; everything else is a design decision to be confirmed during implementation.

## R1. How a folder reaches the page on each host

**Decision**: one internal notion, the *map catalogue* (a list of candidate entries, each readable on
demand), filled per host as follows:

| Host | User control | How the page lists the maps |
| --- | --- | --- |
| Browser | "Choose a folder of maps" button (`<input webkitdirectory>`), dropping a folder, dropping a `.zip` | The browser hands over `File` objects (a dropped folder is walked with `webkitGetAsEntry()`); no listing needed |
| Wallpaper Engine | `mapfolder` text input, path relative to the wallpaper folder, default `game/maps` | `file://` XHR of the directory returns Chromium's directory listing (R2); a value ending in `.zip` is read as an archive (R3) |
| KDE Plasma | `mapfolder` folder dialog in the settings page (generated `config.qml`), plus the text field it fills | Same `file://` directory listing as Wallpaper Engine (the page is `file://` with `localContentCanAccessFileUrls`) |
| Lively | `mapfolder` `folderDropdown` with filter `*.zip` (copies the archive into `userfiles/`) | The archive is read (R3); Lively serves the page over a WebView2 virtual host, which is not expected to list directories |

**Rationale**:
- Wallpaper Engine's `directory` property only takes images and videos (its docs, `context/wallpaper_dev_wiki/user_properties.md`),
  and its CEF reads only inside the wallpaper folder (004 research, 2026-09-19). A text path inside the
  wallpaper folder is the pattern the archives already use, so the maps go to `game/maps/` next to them.
- Chromium lists a `file://` directory for XHR (measured, R2), so no host-side helper is needed on Wallpaper
  Engine and KDE.
- Lively has no folder property; its `folderDropdown` copies one chosen file. A `.zip` of the maps is one file,
  which Lively already handles. Any host also accepts a `.zip`, so a user can use one method everywhere.
- Every host keeps paths and listing out of the controller: it receives a catalogue source and asks it for
  entries.

**Owner review (2026-09-25)**: accepted as a first iteration, with a concern: file selection already differs
per host (a path on Wallpaper Engine, a picker/drop in the browser, a `.zip` on Lively, a folder dialog on KDE),
and a more uniform way should be looked for later. Consequences for this feature: all host differences stay
inside `openCatalogue` (one function per host, returning the same `CatalogueEntry[]`), so a later uniform method
replaces only those functions; the `.zip` path is implemented once and works on every host, so it is the
uniform fallback today; the follow-up is recorded in TODO.md (task T061).

**Alternatives considered**:
- Wallpaper Engine `directory` property in `fetchall` mode: gives full paths, but only for image/video files
  (documented), and the paths lie outside the sandbox unless the folder is inside the wallpaper folder anyway.
  Kept as a Windows-session probe (open question WE-F2), not planned.
- KDE: list the folder in QML (`Qt.labs.folderlistmodel`) and pass names through `configJson()`: works without
  relying on Chromium's listing but is not recursive and adds QML logic; kept as the fallback if QtWebEngine
  does not list (open question KDE-F1).
- A user-written index file (`maps.txt`): works everywhere, but is a manual step users forget to update.
  Rejected.
- Lively: a text field with a folder path outside the wallpaper folder — WebView2's virtual host maps only the
  wallpaper folder; rejected unless the Windows session finds otherwise (LV-F1).

## R2. Chromium's `file://` directory listing (measured)

**Measured 2026-09-25**, desktop Chromium (system `chromium-browser`, via `playwright-core`), page loaded from
`file://` with `--allow-file-access-from-files`: `XMLHttpRequest` `GET maps/` completes with status 0 and an
HTML body in which every entry is one line

```text
<script>addRow("Карта.h3m","%D0%9A%D0%B0%D1%80%D1%82%D0%B0.h3m",0,2,"2 B",1790293378,"25.09.2026, 02:42:58");</script>
<script>addRow("sub","sub",1,60,"60 B",1790293378,"25.09.2026, 02:42:58");</script>
```

Arguments: display name, URL-encoded relative name, `1` for a directory, size in bytes, size text, mtime
(seconds), date text. Cyrillic names and spaces are returned correctly; sub-folders are marked. `fetch('maps/')`
returned the same listing in this run.

**Decision**: parse the listing by extracting the argument list of each `addRow(` call and reading it as a JSON
array (Chromium writes the strings with JSON escaping). The parser is a pure function with its own unit tests
(fixtures are hand-written listing lines, not game content). Recurse into sub-folders up to **4 levels**, stop at
**5 000 entries** (logged when reached); skip `.`/`..` and hidden names starting with a dot.

**Rationale**: no host helper, one code path for Wallpaper Engine and KDE; the mtime and size in the listing
give a cheap identity for the "folder changed" check (R9).

**Open questions** (answered by the Windows session and `yarn accept kde`, not blocking the plan):
- **WE-F1**: does Wallpaper Engine's CEF return the same listing for a folder inside the wallpaper folder?
- **KDE-F1** (answered yes, see "Measurements during implementation"): does QtWebEngine 6.10 (Chromium 13x) return it for a `file://` page? Checked during implementation
  over the DevTools port (AGENTS.md "KDE live debugging"); fallback in R1.
- **LV-F1**: does WebView2's virtual host list a folder? Expected no; the `.zip` path does not depend on it.
- **WE-F2**: does a `directory` property in `fetchall` mode report `.h3m` files at all?

## R3. `.zip` of maps

**Decision**: a small ZIP reader in `src/core/formats/zip/`: find the end-of-central-directory record, read the
central directory, and read members that are *stored* (method 0) or *deflated* (method 8, inflated with
`DecompressionStream('deflate-raw')`). Other methods, encryption and ZIP64 raise a typed `FormatError`. Only
member names ending in `.h3m` are catalogue entries; members are read lazily with `Blob.slice`, so a large
archive is never inflated in full.

**Rationale**: needed for Lively (R1) and useful everywhere; the format is simple, bounded and documented
(PKWARE APPNOTE), so no dependency is justified (constitution VIII). `.h3m` files are already gzip streams, so
users zipping them with "store" or "deflate" both work.

**Alternatives considered**: a dependency (fflate, ~8 KB gz, MIT) — rejected, the reader is ~150 lines and the
platform already inflates; `.tar` — not something Windows users make by default.

## R4. Reading a map's summary cheaply

**Decision**: `readMapSummary(bytes)` in `src/core/formats/h3m/summary.ts` reads the version (and HotA
sub-version and header fields), then `readInfo` — size, `hasUnderground`, map name — from the first inflated
bytes (reusing `inflatePrefix`, bounded at 64 KB like `classifyFile`). It returns
`{ version, size, levels, title, needsHota }` or a typed error.

**Rationale**: size and levels sit in the first few dozen bytes after the version; the title comes right after
and is what the browser panel shows (clarification "map name"). Filters therefore never need a full parse
(FR-018).

**Size classes** (new typed table `src/core/data/map-sizes.ts`): S 36, M 72, L 108, XL 144, H 180, XH 216,
G 252; a non-standard size belongs to the smallest class not smaller than it; anything above 252 is G.

## R5. Picking without reading the whole folder

**Decision**: the catalogue first lists names only (cheap). A seeded shuffle (R7) orders the entries; the picker
walks that order: read the file → summary → filter → full load. The first entry that passes is shown. Summaries
and failures are remembered for the session, so a later cycle does not re-read a failed or filtered entry
(filters are re-evaluated from the remembered summaries when they change).

"All filtered out" and "all unreadable" are known only after a full pass; the messages of FR-005 appear then.
The owner's folder (225 maps, 8.6 MB) is at most 225 × 64 KB of inflated prefixes in the worst case.

**Rationale**: satisfies FR-022/SC-001 — the first usable map costs one listing, one header and one load.

## R6. Switching maps without an empty frame

**Finding** (code, 2026-09-25): `engine.loadMap` sets the new world and terrain as soon as the map is parsed,
drops the object layer (`renderer.setObjects(undefined)`), centres the camera, and only then builds the object
atlas; the controller places the view after `loadMap` resolves. A switch through `loadMap` would therefore show
the new terrain without objects, at the map centre, for the whole object build (seconds on a cold cache).

**Decision**: two new engine calls (contract [engine-api.md](contracts/engine-api.md)):
- `prepareMap(file, name)` parses the map and builds its object layer in the worker **without touching the
  renderer**; the result (world, object index data, atlas pages as transferred buffers, flag colours) is kept on
  the main thread as a `PreparedMap`.
- `showPreparedMap(prepared, level, placement)` swaps terrain, object layer and camera in one synchronous step,
  releases the previous map's GPU resources and invalidates one frame.

The worker keeps worlds by identity (it already does); it keeps the **current and the prepared** map instead of
clearing all worlds on every `openMap`. The single-map source keeps using `loadMap` (unchanged behaviour); the
folder source uses prepare/show for every map, including the first.

A prepared map is discarded (and its buffers dropped) if the sprite or data archive changes while it is being
prepared, or if a newer prepare supersedes it (generation counter, as for the other loads).

**Memory**: during a switch the previous map's GPU atlas and the next map's CPU pages coexist; atlas pages are
uploaded in `showPreparedMap` and the CPU copies dropped right after, the old textures deleted in the same step.
Peak = one GPU atlas + one CPU atlas. The budget check measures the peak across a switch (plan, Performance).

**Alternatives considered**: a `staged` flag on `loadMap` — same work, but mixes two behaviours in one call;
cross-fade — rejected by the owner (instant switch); keeping two GPU atlases — doubles peak GPU memory.

## R7. Rotation order and randomness

**Decision**: rotation lives in a DOM-free module `src/runtime/rotation.ts`: a Fisher–Yates shuffle of
catalogue indices driven by the project's seeded RNG (`src/core/util`), seed derived from the controller seed and
a cycle counter (as `nextSeed` does for places). When a new cycle starts with the entry that ended the previous
one, it is swapped with the next entry (FR-011). Entries that failed stay excluded for the session; a filter
change re-evaluates the remaining order (current map kept if it still matches, FR-017).

**Multi-screen**: every wallpaper instance has its own seed already (clarification), so screens rotate
independently without any coordination.

## R8. The map interval counts visible time only

**Decision**: unlike the place timer (which counts wall time from the last draw and fires on return), the map
timer accumulates *active* time: it is armed with the remaining active milliseconds while the wallpaper is
showing, not paused and not hidden; on pause/hide the elapsed part is banked and the timer cleared. When it
fires, the controller starts preparing the next map; the current map keeps running until `showPreparedMap`.
"Next map now" starts the same path at once and resets the counter.

**Rationale**: FR-009 (no load while hidden) and constitution IV (no timers while hidden).

## R9. Remembering and following the folder

**Browser**: the remembered-files database (`h3dynam-files`, store `userFiles`) gets the folder's maps under new
keys (`folder:<relative path>`) plus one `folder` record (folder name, entry count, saved time). Choosing a new
folder replaces them in one transaction. A quota failure keeps the folder for the session only and logs it
(constitution VII); the single-map record stays untouched, so switching the source back works (FR-021). Size:
the owner's 225 maps are 8.6 MB; the store is capped at **5 000 entries / 256 MB** with a logged refusal above.

**Hosts**: the catalogue is rebuilt on start and whenever `mapfolder` changes (FR-020). An entry that is missing
when picked (`FILE_MISSING` on read) is dropped from the session's catalogue and the next one tried.

## R10. Bounding the decode cache

**Finding** (code): the IndexedDB decode cache (`h3dynam`, stores `atlas`/`world`/`objects`) has no eviction.
Rotation through hundreds of maps would store a world and an object atlas (8–128 MB, spec 005) per map.

**Decision**: keep `world` and `objects` entries for the **8 most recently used map identities**; a small
`recent` store records use order; eviction runs after each `put` in those stores. `CACHE_SCHEMA` goes to **9**
(new store). Archive entries are not affected. The single-map source benefits as well (switching the single map
no longer grows the cache).

**Alternatives considered**: not caching rotated maps — loses warm starts for the map shown at start; a byte
budget — needs sizes of structured clones, which IndexedDB does not report cheaply. The count bound can be
revisited with measurements.

## R11. Settings shape

**Decision** (contract [settings.md](contracts/settings.md)):

| Key | Type | Values / default | Visible when |
| --- | --- | --- | --- |
| `mapsource` (reserved) | enum | `single` (default), `folder` | always |
| `mapfolder` (reserved) | folder | null; Wallpaper Engine default `game/maps` | `mapsource = folder` |
| `maprotation` (reserved) | int, number field | 0–1440, default 0 | `mapsource = folder` |
| `mapsizemin` | enum | `s`…`g`, default `s` | `mapsource = folder` |
| `mapsizemax` | enum | `s`…`g`, default `g` | `mapsource = folder` |
| `mapunderground` | enum | `any` (default), `two`, `one` | `mapsource = folder` |
| `mapfile` | file | unchanged | `mapsource = single` (where hosts support conditions) |
| `viewinterval` | int | max 120 → **1440** | unchanged |
| action `mapnext` | action | "Next map now" | `mapsource = folder` |

A minimum above the maximum is treated as the same range swapped (logged), never as an empty filter.

**Rationale**: reserved keys keep their meaning from spec 004; two enums are the only range control every host
renders (Wallpaper Engine combo, Lively dropdown, KDE combo box, browser select).

## R12. Messages

**Decision**: three new message codes, English and Russian, shown by the existing overlay only while nothing is
showing:
- `FOLDER_EMPTY` — the folder cannot be read or holds no `.h3m` (detail: the folder name).
- `FOLDER_FILTERED` — maps exist but none matches (detail: the size range and underground rule).
- `FOLDER_UNREADABLE` — every map failed (detail: count and the first failure).
Skipped maps are logged at `warn` with file and reason, never shown (FR-004). Every map shown is logged at `info`
with its title and file (clarification "map name").

## R13. Verification on Linux

- **Unit (Node, Vitest)**: listing parser (R2), ZIP reader on synthetic archives, `readMapSummary` on synthetic
  maps of every size class and level count, size classes, rotation (no repeat per cycle, no immediate repeat,
  seeded reproducibility, filter changes), controller with a fake engine and fake catalogue (skip on failure,
  messages, interval counting active time only, next-map action, source switch back to single).
- **Synthetic fixtures**: the committed H3M generator produces small maps of chosen size/levels; a ZIP writer
  (already in `tools/shared/archive.ts` for packages) builds test archives; nothing game-derived is committed.
- **Host simulations** (`yarn verify hosts`): new invariants for the folder source on every host driver —
  Wallpaper Engine and KDE with a real `file://` folder (exercises R2 in Chromium), Lively with a `.zip`,
  browser with a directory input (`setInputFiles` on a directory, playwright-core 1.63) and a dropped folder;
  upgrade from stored single-map settings (SC-006); 100 forced switches with a canvas sample every frame around
  each switch — never an all-black or placeholder frame — and GPU bytes/JS heap within 10 % (SC-002).
- **Budget** (`yarn verify budget`): a folder case — the owner's `Maps` folder when present (skips otherwise),
  a synthetic folder always — warm start ≤ 2 s to the first map, and peak memory across a switch within 300 MB.
- **Real maps** (`test/real`, skip without files): a full rotation cycle over the local map folders with every
  filter combination shows only matching maps (SC-004); a folder with injected broken files still rotates through
  the good ones (SC-005).

## Measurements during implementation (2026-09-25)

- **R2 in the host simulations**: the Wallpaper Engine and KDE drivers open the packages from `file://`
  in headless Chromium (`--allow-file-access-from-files`) and list real folders (sub-folders, a
  Cyrillic folder name) through the parser; invariants 14–20 pass there. WE-F1 and KDE-F1 still need
  the real hosts (CEF, QtWebEngine).
- **R6**: the swapped frame equals a fresh `loadMap` of the same map bit for bit and `gpuBytes` within
  1 % (test/browser/engine-prepare.test.ts). Invariant 16 samples every animation frame around 100
  switches on every host: no empty or placeholder frame; GPU memory flat.
- **JS heap over 100 switches**: without a forced collection Lively's heap grew 38 → 56 MB (maps read
  out of the `.zip` leave garbage the collector had not reached); with `gc()` before each measurement
  (the check's browser runs with `--expose-gc`) it stays within 10 % on every host. The check measures
  retained memory since then.
- **R10**: after ten maps the IndexedDB stores hold exactly 8 worlds and 8 object atlases (browser test).
- **Real maps**: the owner's Complete `Maps` folder lists 216 maps (`yarn h3 map catalogue`); full
  rotation cycles over it and the HotA maps with five filter combinations showed only matching maps
  (test/real/map-folder.test.ts).
- **Deviations from the contracts**: `mapfolder` is a `file` setting with `pick: 'folder'` instead of a
  new `folder` type (validation, Wallpaper Engine text inputs and Lively's `folderDropdown` needed no
  change); `supplyFolder(name, entries)` takes a catalogue function; the remembered folder lives in the
  browser adapter, the only host that needs it. The contracts were updated accordingly.
- **Budget, folder case** (`yarn verify budget`, 4× CPU throttling, 1920×1080, two runs): the owner's
  Complete `Maps` folder through the Wallpaper Engine package — cold start 3.1 / 4.1 s (limit 10 s),
  warm start 1.70 / 1.77 s (limit 2 s), peak JS heap + GPU over five switches 63 MB (limit 300 MB); the
  synthetic folder 1.0–1.2 s warm, 59 MB. The R6 memory fallback (T040) is therefore not needed.
- **Budget failures that are not this feature's**: the dev-harness warm starts (Arrogance, test_map,
  Pandora's Box, the synthetic 252×252) fail on `testing` as well (2.2–3.0 s there, 1.8–2.8 s here;
  TODO "Housekeeping" already lists them), and `sc007-frame-cpu` is noise at the 0.1 ms timer
  resolution: five paired samples gave small/large medians of 1.2–3.9 / 2.0–3.1 ms on this branch and
  1.8–2.4 / 2.0–3.5 ms on `testing`, with identical draw calls, quads, vertices and GPU bytes.
- **KDE-F1 answered (real Plasma 6 session, QtWebEngine 6.10, 2026-09-25)**: `yarn accept kde --apply
  --folder "<bundleDir>/Maps"` with the DevTools port open: the page listed the Complete `Maps` folder
  through the `file://` listing (216 maps, 0 failed) and showed "Вперед, Викинги!" (144×144); three "next
  map" switches took 3.7 s, 1.1 s and 2.1 s (cold decodes of 144/36/72 maps) with `phase` `showing`
  throughout and the old map on screen until the swap. The QML `FolderListModel` fallback is not needed.
  `yarn accept kde` gained `--folder DIR` for this.
- **Windows**: the remaining questions (WE-F1, WE-F2, LV-F1) and a first HotA check on the real Windows
  hosts are handed over in [windows-handoff.md](windows-handoff.md).

