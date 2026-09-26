# Research: Platform Adapters

Decisions for [plan.md](plan.md). Sources: host documentation and host source code read on
2026-09-17 (Wallpaper Engine docs mirrored in `context/wallpaper_dev_wiki/`, Lively
`rocksdanister/lively` source and wiki, libplasma / plasma-workspace / kpackage / Qt WebEngine docs,
three existing Plasma 6 web wallpapers), and the current code (`src/runtime`, `tools/checks`).
Items marked **Spike** (KDE, on Linux) are measured before dependent code is finished; Wallpaper Engine and
Lively facts marked "Windows question" are verified in the follow-up Windows session. Results go to "Measurements".

## Host facts

### Wallpaper Engine (WE)

- The page is opened from the wallpaper folder as `file:///…/index.html` in WE's CEF.
- `window.wallpaperPropertyListener` must be assigned by a top-level classic script, otherwise the
  first `applyUserProperties` call (all properties) can be missed. Later calls carry only changed keys;
  each value is `{ value }`. A file property value is a raw local Windows path without scheme (cleared
  → `""`). `applyGeneralProperties({ fps })` gives the user's frame limit (0 = none); `setPaused(bool)`
  is sent, and WE may also freeze the process.
- `fetch('file:///…')` is reported to fail ("URL scheme 'file' is not supported"); a WE developer
  states `XMLHttpRequest` reads local files without extra flags. (Windows question WE-1)
- Module scripts and `new Worker(url)` from a `file://` page are blocked by Chromium's opaque origin
  unless the host passes `--allow-file-access-from-files`. Windows question WE-3.
- Browser storage lives in a CEF profile shared by all web wallpapers (one `file://` origin), may be
  wiped when the CEF cache is reset, and is separate per monitor. IndexedDB is not documented. The cache
  is therefore best-effort; files are always re-read from their paths. Windows question WE-5.
- `project.json`: `file`, `type: "web"`, `title`, `preview`, `general.properties` (types `file`,
  `combo`, `slider`, `bool`, `textinput`; `condition` strings such as `"viewmode.value == 2"`), and
  `general.localization` keyed by locale (`en-us`, `ru-ru`) mapping `ui_*` tokens. `fileType` must not be
  set (it restricts selection to images/videos). Property keys: English letters and digits only.
- The page gets no documented language value; `applyGeneralProperties` keys are checked in Windows question WE-6;
  fallback `navigator.language`.
- Debugging: WE Settings → General → "CEF devtools port" exposes DevTools on localhost; WE has a command
  line (`wallpaper64.exe -control openWallpaper -file …\project.json`, `-control pause|play`).

### Lively Wallpaper

- `LivelyInfo.json` at the zip root: `AppVersion, Title, Desc, Author, License, Contact, Type, FileName,
  Arguments, IsAbsolutePath, Thumbnail, Preview`. `Type` 1 = web. `Arguments: "--pause-event true"`
  enables `livelyWallpaperPlaybackChanged(jsonString)` with `{ IsPaused }`. Unknown `Arguments` make the
  player exit, so Chromium flags cannot be added.
- The page is served from the wallpaper folder over `https://<hash>.localhost/` (WebView2 virtual host
  mapping): relative `fetch` works, module scripts and module workers work, and the origin (and its
  IndexedDB) is stable while the folder does not move. Storage is persistent under `%LOCALAPPDATA%`.
- `LivelyProperties.json`: `slider {min,max,step,value}`, `dropdown {items[],value index}`,
  `checkbox`, `folderDropdown {folder, filter "*.lod", value}`, `label`, `button`. Values arrive via a
  global `livelyPropertyListener(name, value)`, once per control after page load and on change.
  `folderDropdown` "Browse" **copies** the chosen file into `<wallpaper>/<folder>/`; the value sent is
  `folder\file` with a backslash, or `null`. `LivelyProperties.loc.json` localises `text`, `help`,
  `items` per language (`ru` matches `ru-RU`).
- Input: mouse forwarded by default, keyboard opt-in. CLI: `Lively.exe setwp --file`, `setprop`.
  Debug mode opens DevTools; WebView2 also honours `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`.

### KDE Plasma 6

- Installed on the development machine: plasmashell 6.7.5, Qt WebEngine / WebChannel 6.10.3,
  kf6-kpackage 6.30, `kpackagetool6`, `plasmawindowed` (applets only; no wallpaper viewer).
- Package: `metadata.json` (`KPackageStructure: "Plasma/Wallpaper"`, `X-Plasma-API-Minimum-Version:
  "6.0"`, reverse-domain `KPlugin.Id`), `contents/ui/main.qml` (root `WallpaperItem`, config via
  `root.configuration`), `contents/config/main.xml` (kcfg), `contents/ui/config.qml` (`cfg_*` bindings,
  `QtQuick.Dialogs.FileDialog`). `kpackagetool6 -t Plasma/Wallpaper -i <archive> -p <root>` validates by
  installing into a temporary root. Store archive: `.tar.gz`.
- `WebEngineView` works inside plasmashell (it sets `AA_ShareOpenGLContexts`). The lock-screen greeter
  does not, so a web view there may render black → the plugin shows a plain dark background on the lock
  screen (detected by `Plasmoid.activity` being undefined).
- A `file://` page with `localContentCanAccessFileUrls: true` (default) may read `file://` URLs with
  `XMLHttpRequest`; `fetch` of `file:` is unsupported. Module scripts/workers from `file://` are
  uncertain → same classic build as WE (R3).
- Default QML profile is off-the-record (IndexedDB lost on restart). A persistent
  `WebEngineProfile { storageName; offTheRecord: false }` must be one object per process: two profiles
  with the same storage name corrupt the store. One profile object is shared through a package QML
  singleton (the QML engine is global to plasmashell) — **Spike S3**.
- Visibility: `WallpaperItem` exposes nothing. Established patterns: `org.kde.taskmanager` `TasksModel`
  filtered by screen for maximised/fullscreen windows; DBus `org.freedesktop.ScreenSaver.ActiveChanged`
  for lock. DPMS has no API (not handled; the compositor stops presenting anyway).
- Translations: package `.mo` loading works from Plasma 6.5.6; to avoid gettext tooling the generated
  config UI picks strings from a generated JS table by `Qt.uiLanguage` (R9).
- Real-session driving: `qdbus org.kde.plasmashell /PlasmaShell evaluateScript` can set a desktop's
  `wallpaperPlugin` and config; `QTWEBENGINE_REMOTE_DEBUGGING=<port>` in plasmashell's environment
  exposes CDP.

## Decisions

### R1. One host-neutral wallpaper controller, thin per-host bridges

- **Decision**: `src/adapters/shared/` holds everything common: settings definition, strings, file-kind
  detection, file reading by URL, overlay (placeholder and messages), view placement, settings
  application with coalescing, and the `WallpaperController` that owns the engine. Each host folder
  (`web`, `wallpaper-engine`, `lively`, `kde`) only translates host signals into controller calls
  ([contracts/host-bridge.md](contracts/host-bridge.md)).
- **Rationale**: Principle V (thin adapters); one place to test behaviour (FR-003–FR-010); host checks
  only need to verify the translation.
- **Alternatives**: one adapter per host with its own logic — duplicated behaviour and four times the
  checks.

### R2. Engine additions are generic, not host-specific

- **Decision**: `EngineOptions.workerFactory` (who creates the decode worker), `setUserScale(1|2|3)`,
  `placeView(placement)`, `forgetCache()`, `setFrameLimit(fps)`, and a load generation guard so a newer
  `loadMap/loadArchive` call wins over an older one still in flight. View placement math is a pure
  function in `src/core/render/view-placement.ts` using the seeded RNG from `core/util`.
- **Rationale**: the camera already carries `scale` through shaders and clamping (only `resize` pins it
  to DPR); the worker is created with `import.meta.url`, which classic builds do not have; rapid host
  setting events need last-wins loads (edge case "many changes in a row").
- **Alternatives**: scale by CSS-stretching the canvas — breaks the surface budget rule and smooths
  pixels unless `image-rendering` behaves the same in all hosts.

### R3. Two build flavours: ESM for web, classic for file-based hosts

- **Decision**: `web` (GitHub Pages, served over https) keeps the current ESM build with a module worker.
  `host` flavour (WE, KDE, and Lively for uniformity) is a single classic IIFE script plus the worker
  embedded as a string and started from a `Blob` URL. The page's first classic `<script>` assigns the
  host listeners synchronously and queues events until the controller starts.
- **Rationale**: `file://` pages cannot load module scripts or `new Worker('x.js')` without
  `--allow-file-access-from-files`, which WE users would have to add by hand and Lively forbids. A Blob
  worker is same-origin by construction. Lively could use ESM, but one host build means one set of host
  checks and one size figure.
- **Alternatives**: decode on the main thread in hosts (`useWorker: false`) — violates Principle IV;
  a local HTTP server — needs a native helper, not possible in WE/Lively/KDE packages.
- **Cost**: the embedded worker is counted in the runtime budget (≤ 100 KB gz per package; today 46 KB
  total).

### R4. Reading user files

- **Decision**: `readUserFile(url)` uses `XMLHttpRequest` with `responseType = 'blob'` (measured faster than
  `arraybuffer`, see Measurements) for
  `file:` URLs and `fetch` otherwise; the result becomes a `Blob` given to the engine. Host paths are
  normalised: backslashes → `/`, each segment `encodeURIComponent`-encoded, drive letter kept
  (`file:///C:/…`), Lively values made relative to the page. Missing file (status 0 with empty body,
  404, network error) → `FILE_MISSING` message.
- **Warm-start note** (h3lwp, `context/heroes_iii_android`, studied only): it copies the LOD into app storage once
  at setup, decodes only the sprites the chosen maps need, keeps no decoded cache, and rebuilds its atlas
  when the wallpaper process starts; showing/hiding only pauses rendering. Start cost is paid rarely
  (process start, map change), not on every show. The same holds here: host pause and visibility never
  reload; the file re-read happens only on page start (login, host restart) and file setting changes.
- **Rationale**: the only reading path known to work in WE and QtWebEngine; handles spaces and Cyrillic
  (edge cases).
- **Alternatives**: streaming range reads — `file://` XHR has no ranges; whole reads of ~50 MB from a
  local disk are expected to take < 0.5 s (Windows question WE-1 measures, SC-002).

### R5. File identity and stale data

- **Decision**: keep engine identities (map: SHA-256 of the whole file; archives: size + LOD header +
  index). Files read by URL have no `lastModified`; that is acceptable because any changed LOD entry
  changes the index offsets/sizes. Hosts re-read files on every start and on every changed setting.
- **Rationale**: FR-007 "changed file never served stale" holds without host metadata.
- **Alternatives**: host modification times — not available in WE/Lively values.

### R6. File kind detection by content

- **Decision**: `classifyFile(blob)` in `src/runtime/file-kind.ts` (bounded work, allowed on the main thread:
  LOD header + index via `blob.slice`, at most the first 64 KB of a map inflated through a
  `DecompressionStream` reader that is cancelled early): `LOD\0` magic → open the index →
  data archive if it has `Objects.txt`, `artraits.txt`, `game.pal`; sprite archive if it has the terrain
  DEFs; else `unknown-archive`. gzip magic or a raw H3M version code → read the version (inflating only
  the first bytes) → `map` (RoE/AB/SoD), `unsupported-map` (HotA, WoG, Chronicles), else `unknown`.
- **Rationale**: FR-002; reuses `LodArchive` and `versionFromCode`; never inflates a whole map on the main
  thread (Principle IV).
- **Alternatives**: by extension/name — fails for dropped files with odd names and wrong settings.

### R7. Settings: one definition, generated host manifests

- **Decision**: `src/adapters/shared/settings.ts` defines keys, types, ranges, defaults and conditions
  ([contracts/settings.md](contracts/settings.md)). The packaging tool generates WE `project.json`,
  `LivelyProperties.json` + `.loc.json`, KDE `main.xml` + `config.qml` string table from it. Map source
  keys are fixed now (`mapfile`) and a later `mapsource`/`mapfolder` pair is reserved so FR-018a holds.
  The root `project.json` of the proof of concept is deleted.
- **Rationale**: FR-003 "same settings with the same meaning on every host", FR-003b completeness
  checkable in one place.
- **Layering**: `settings.ts` and `strings.ts` are DOM-free data modules; `yarn verify layers` allows `tools/`
  to import exactly these two files from `src/adapters/shared/` (FR-008) and enforces that they import
  nothing with DOM or host APIs.
- **Alternatives**: hand-written manifests per host — drift between hosts.

### R8. View placement

- **Decision**: modes `random` (default), `centre`, `coords`. `coords` maps slider fractions 0–100 to the
  camera between the extremes, which reach 8 tiles (the camera's border band) past each map edge. `random`
  draws both fractions from the seeded RNG at start, on map change, when switching to random, on the
  "new random place now" control and every `viewinterval` minutes (counted from the last draw); scale and
  viewport changes place the kept fractions again. Level setting `random` (default) draws the level with
  every random place; seed from `crypto.getRandomValues` unless a
  check fixes it. Level `underground` on a one-level map → surface. A map smaller than the view is
  centred by existing clamping.
- **Rationale**: FR-003a; same slider range on every map size.

### R9. Strings and language

- **Decision**: `src/adapters/shared/strings.ts` holds `en` and `ru` tables with identical keys (type-level
  check: `ru` is typed `Record<keyof typeof en, string>`), plus a `verify packages` check over generated
  manifests. Language: host value where one exists (Lively and WE localise their own panels; KDE passes
  `Qt.uiLanguage`), else `navigator.language`; `ru*` → Russian, anything else → English.
- **Rationale**: FR-003b, SC-008 without gettext or a runtime dependency.

### R10. Pause and visibility per host

- **Decision**: the controller is inactive when any of: host paused, host hidden, `document.hidden`.
  WE: `setPaused`. Lively: `livelyWallpaperPlaybackChanged` (`--pause-event true`). KDE: QML computes
  `hidden` from `TasksModel` (maximised or fullscreen window on this screen, not minimised) or
  `ScreenSaver.ActiveChanged`, calls the page bridge, then sets `WebEngineView.visible = false`.
  Browser: `visibilitychange`. WE `fps` limit: `setFrameLimit(fps)` makes the scheduler wait at least
  `1000/fps` between frames (the idle cadence is already ≤ 5.6 fps).
- **Rationale**: FR-004, FR-015, FR-018, SC-003; engine already reaches 0 pending callbacks when
  inactive.
- **Alternatives**: freezing the page (`lifecycleState: Frozen`) in KDE — optional follow-up once the
  bridge call is proven; not needed for the budget.

### R11. KDE plugin structure

- **Decision**: Id `io.github.alamion.h3dynam`. `main.qml`: `WallpaperItem` → `WebEngineView` loading
  `../web/index.html` from the package (`file://`), background black, persistent profile from a
  singleton `SharedProfile.qml` (`storageName: "h3dynam"`); settings and file URLs pushed with
  `runJavaScript("h3wallpaper.apply(…)")` after `loadingChanged` succeeded and on every config change;
  `config.qml` with three `FileDialog`s, combos, sliders (visible only in `coords` mode), checkbox.
  Lock screen → plain background, no web view.
- **Rationale**: FR-017, FR-018; runJavaScript is enough for small JSON (files are read by the page).
- **Alternatives**: WebChannel — async setup and an extra script for no gain; URL query — reloads the page
  (and decoded state) on every setting change.

### R12. Browser adapter: remembered files and UI

- **Decision**: files are stored as `Blob`s in a separate IndexedDB database `h3dynam-files` (store
  `userFiles`, key = slot) so a cache schema bump does not forget them; settings in `localStorage`
  (try/catch). "Forget files" deletes that database and clears the decode cache (`forgetCache`). Drop zone
  = whole page; picker accepts multiple files; each file is classified (R6) into its slot. Panel: files,
  level, view mode + sliders, scale, objects, language-aware, auto-hides after 4 s idle; keyboard and drag
  scrolling as in the harness. The dev harness stays for development and checks.
- **Rationale**: FR-011–FR-013, SC-001.

### R13. Cross-view decode sharing

- **Decision**: the worker wraps each decode in `navigator.locks.request('h3dynam:decode:' + identity)`
  and re-checks the cache inside the lock. Two KDE screens (or two browser tabs) sharing a profile decode
  once; the second reads the cache.
- **Rationale**: FR-018 "decoded data shared, not decoded twice"; Web Locks exist in all target
  Chromium versions and in workers; absent API → decode without lock.

### R14. Packaging and publishing

- **Decision**: `yarn package [--host web|wallpaper-engine|lively|kde|all]` builds into
  `dist/packages/<host>/` and archives: Lively `.zip`, KDE `.tar.gz`, WE folder (published from the WE
  editor), web folder. Archives are written by small deterministic writers in `tools/shared/archive.ts`
  (sorted entries, fixed timestamps, Node `zlib`), so repeated builds are byte-identical. Preview images
  are generated from committed SVG/code (no game art). A GitHub Actions workflow on push to `testing`
  runs type-check, tests, `yarn package --host web`, `yarn verify packages` and `yarn verify hosts --host
  web`, then deploys `dist/packages/web` with `actions/deploy-pages`. Pages use relative asset paths
  (`base: './'`) so the `/heroes_III_ts/` sub-path works. Every package sets a CSP
  (`default-src 'self'; worker-src 'self' blob:; connect-src 'self' file: blob:; img-src 'self' data: blob:`)
  and the check rejects absolute external URLs. The CSP has no `'unsafe-inline'`: every script, including the
  host listener that must run first, is a separate file (`listener.js` loaded as the first classic
  `<script src>`); styles come from files and CSSOM only.
- **Rationale**: FR-013a, FR-019, FR-020.
- **Alternatives**: system `zip`/`tar` — timestamps and ordering make output non-reproducible.

### R15. Checks without real hosts (Linux, headless)

- **Decision**: `yarn verify packages` (static): required files per host, no game files (extensions
  `.lod .snd .vid .def .pcx .h3m .h3c .gm1 .pal .msk .fnt`, LOD/H3M magics, any file > 2 MB), no external URLs,
  no affiliation wording/logos (word list), string tables complete, manifests match the settings
  definition, host flavour has no module scripts or URL workers, runtime JS size, reproducibility (two
  builds, same hashes). `yarn verify hosts` (headless Chromium, synthetic fixtures by default, real files
  when present): web served under a sub-path; WE opened as `file://` with a simulated listener (Chromium
  started with `--allow-file-access-from-files` to stand in for WE's XHR permission); Lively served on
  `http://<hash>.localhost` with backslash folderDropdown values; KDE page opened as `file://` with bridge
  calls as QML makes them. Each scenario checks: placeholder text for missing files, load, each setting's
  effect, paused/hidden → 0 frames and 0 pending callbacks, ×1 frame equals the engine render for the same
  inputs (coords mode, fixed seed and clock), language switch, malformed files → message. KDE package
  also installed into a temporary root with `kpackagetool6` (skip, exit 4, when absent).
- **Rationale**: FR-020, FR-021, SC-003–SC-008; runs in CI and on Linux (Principle III, V).

### R16. Real-host acceptance

- **Decision**: `quickstart.md` holds the per-host acceptance procedures (FR-022). Browser and KDE are
  accepted on Linux within this feature; `yarn accept kde` automates the local Plasma part (install with
  `kpackagetool6`, set the plugin through plasmashell DBus scripting only with `--apply`, restore the
  previous wallpaper after). Wallpaper Engine and Lively are verified in a follow-up session run on
  Windows itself, working from "Open questions for the Windows session" below. No remote-control tooling
  for Windows is built.
- **Rationale**: an agent on the Windows machine reaches the hosts, their DevTools and the desktop directly;
  remote driving over SSH cannot see the interactive session and would add Windows-side scripts to shared
  tooling (Principle V).
- **Constraint for that session**: nothing Windows-only is committed to shared tooling; findings go to
  "Measurements"; fixes are made in the host-neutral code or the host bridge and re-checked by
  `yarn verify hosts` on Linux.

## Spikes

- **S2 (KDE)**: `WebEngineView` in a wallpaper plugin: XHR of `file://` user files, Blob worker, WebGL in
  plasmashell, `runJavaScript` bridge timing, `TasksModel` maximised detection, lock-screen behaviour.
- **S3 (KDE)**: singleton persistent profile shared by two screens; IndexedDB survives
  `plasmashell --replace`.

## Open questions for the Windows session

Expected pattern (built and simulated on Linux in this feature): classic IIFE page, top-level host
listeners queuing events, Blob-URL worker, user files read by `XMLHttpRequest` (WE: `file:///` from host
paths; Lively: relative URLs into `userfiles/`), IndexedDB decode cache as best effort, pause from host
events plus `document.hidden`. To verify or correct there:

**Wallpaper Engine **
1. **WE-1** Does `XMLHttpRequest` with `responseType = 'blob'` read a ~50 MB `file:///` file? Time for
   `H3sprite.lod` (warm-start budget 2 s includes it).
2. **WE-2** Paths with spaces, Cyrillic, `#`, `%`: is the value a raw backslash path, and does the R4 encoding load it?
3. **WE-3** Classic script + Blob worker start? (Module script and URL worker expected blocked — confirm, to justify R3.)
4. **WE-4** Is `window.wallpaperPropertyListener` set early enough to get the first full `applyUserProperties`?
5. **WE-5** Does IndexedDB survive a WE restart and a PC reboot; is it wiped by other wallpapers or cache reset;
   separate per monitor?
6. **WE-6** Keys of `applyGeneralProperties` — is there a language value; does `navigator.language` follow WE's
   language or Windows'?
7. **WE-7** On pause (fullscreen app): is `setPaused(true)` delivered, does `visibilitychange` fire, is the process
   frozen; after resume does animation continue without a frame burst?
8. **WE-8** Is `fps` delivered, and does the scheduler limit hold?
9. **WE-9** Does `localization` under `general` give Russian property labels with WE set to Russian (`ru-ru` key)?
10. **WE-10** WebGL 1 context on the WE CEF; `devicePixelRatio` and surface size on scaled (125–150 %) Windows displays
    and multi-monitor setups.
**Lively**
1. **LV-1** `folderDropdown` Browse copies the three files into `userfiles/`; relative XHR/fetch of 50 MB works over
   the virtual host; time.
2. **LV-2** Value format `userfiles\name` (backslash) or `null`; files with Cyrillic names.
3. **LV-3** `livelyPropertyListener` calls arrive after the classic bundle has registered the listener (all controls,
   once) and on change; dropdown index mapping.
4. **LV-4** `--pause-event true` → `livelyWallpaperPlaybackChanged` on fullscreen/battery rules; JS keeps running
   while paused, the page reaches 0 pending callbacks.
5. **LV-5** IndexedDB persistence across Lively restart; per-screen / span / duplicate layouts.
6. **LV-6** `LivelyProperties.loc.json` with `ru` gives Russian labels; `navigator.language` in WebView2.
7. **LV-7** Import of the `.zip` package, thumbnail/preview display.

**Map folder (spec 007, [research R2](../007-map-folder/research.md#r2-chromiums-file-directory-listing-measured))**
- **WE-F1** (answered 2026-09-25: no, see 007 research "Windows session") Does WE's CEF answer an XHR/fetch of a folder inside the wallpaper folder (`game/maps/`) with
  Chromium's `addRow(…)` listing? (Measured in desktop Chromium and in the KDE/Linux simulation.)
- **WE-F2** Does a `directory` user property in `fetchall` mode report `.h3m` files at all (docs say images/videos)?
- **LV-F1** Does WebView2's virtual host list a folder? Expected no; the `.zip` path does not depend on it.

**Both**
- Real `yarn verify hosts` invariants reproduced on the real host through DevTools (`?h3test=1` is not
  available in hosts: set `window.__h3testHook = true` from the DevTools console and reload).
- Budgets (warm/cold start, memory) on a real mid-range Windows GPU.

## Measurements

### 2026-09-17 — Linux implementation

- **Engine changes keep renders identical** (T013): `yarn verify determinism --runs 3 --rebuild` pass
  (3 identical hashes, test_map 57,51–75,67, 205 object quads); `yarn verify fidelity --map test_map.h3m
  --all-regions` gives exactly the per-view differing pixel counts of the last spec 003 run (5 pass, 7 fail
  on the accepted deviations).
- **Package sizes** (shipped JS, gzip level 9, embedded worker included): web 57 422 B, Wallpaper Engine
  55 728 B, Lively 55 597 B, KDE 58 583 B — all within 102 400 B.
- **Classic build works from `file://`** in headless Chromium with `--allow-file-access-from-files` (stand-in
  for WE/QtWebEngine permissions): Blob worker starts, XHR reads the archives, no module scripts.
- **Host simulations, synthetic files**: all ten invariants pass for web (plus the remembered-files check),
  Wallpaper Engine, Lively and KDE (`yarn verify hosts`), including pixel equality of the ×1 frame with the
  engine render page.
- **Scale ×2 equals ×1 enlarged** by whole pixels (browser test, 0 mismatches on sampled pixels).
- **Web drop of real archives**: sending a 50 MB file through a DevTools message crashes the headless browser;
  the simulation now hands files to the page through a test-only file input (a check tooling detail, not a
  product issue).
- **KDE package validity**: `kpackagetool6 -t Plasma/Wallpaper -i` into a temporary root passes (Plasma 6.7.5,
  kf6-kpackage 6.30).

- **Host simulations, real files** (`H3sprite.lod`, `h3bitmap.lod`, `test_map.h3m`): all invariants pass on all
  four hosts after two fixes found by them — the host briefly showed "objects are hidden" while the data archive
  was still loading (now only when no data archive is on its way), and invariant 9 allows the slow-start
  explanation when a cacheless start really exceeds 2 s.
- **Budgets** (`yarn verify budget`, 1920×1080, 4× CPU throttling): package JS 55.6–58.6 KB gzip; package
  start-up with test_map.h3m — web cold 5.8–6.2 s / warm 0.6–1.1 s (files remembered as IndexedDB blobs),
  Wallpaper Engine cold 5.0–5.5 s / warm 5.0 s with `XMLHttpRequest` `arraybuffer` responses, **1.6–1.7 s with
  `blob` responses** (Chromium keeps the file data out of the JS heap; adopted). Memory 31–41 MB, surface =
  display, 0 hidden frames/timers, idle cadence within limits.
- **Warm start of the dev harness on large maps** measures 1.8–2.7 s (test_map.h3m, Pandora's Box,
  synthetic 252×252). The same measurement on the `testing` branch before this feature gives 1.9–2.8 s, and
  disabling the Web Locks gives 2.4–3.0 s: not a regression of this feature but the known risk in TODO.md
  Housekeeping ("warm start with objects … limit 2 s"), now over the limit on some runs. Left for a dedicated
  item (profile the object cache path); the user-facing packages stay under 2 s warm on test_map.h3m.

### 2026-09-17 — KDE real session and owner review

- **KDE Plasma 6.7 (Fedora 43), three screens with fractional scaling**: the owner set the plugin through
  "Configure Desktop and Wallpaper"; it shows the animated map with objects. Checked from inside the live page
  (plasmashell started with `QTWEBENGINE_REMOTE_DEBUGGING`, DevTools protocol, test hook): `file://` user files
  read by XHR, Blob worker, WebGL, `runJavaScript` bridge, pause while a maximised window covers the screen,
  settings applied live, the "new random place now" button and counter, the interval timer catching up after a
  covered period, and a desktop screenshot matching the camera (covers spike S2 except the lock screen, which
  shows a plain background by design; see TODO 2a). The persistent profile served every plasmashell restart;
  sharing one profile between two screens with the plugin was not exercised (only one screen used it) — moves
  to the multi-screen item (TODO 2a) together with spike S3's two-screen part.
- **Owner requests implemented in this spec**: level setting with `random` (default); interval as a number
  field with validation; "new random place now" on every host (invariant 4.1); random places and coordinate
  sliders reach 8 tiles past the map edge; scale and viewport changes re-place the view; ×2 labelled "as in the
  original game" (×1 stays the default).
- **Additional real map**: `paragon-ultimate-edition.h3m` (SoD 144×144, two levels, 29 643 objects; made for HD
  Mod + SoD_SP, so plugin objects show as missing sprites): parses without warnings, renders both levels, all
  host invariants pass with it (`yarn verify hosts --files real --map paragon-ultimate-edition.h3m`).
- **Package sizes after these changes**: web 58 114 B, Wallpaper Engine 56 331 B, Lively 56 179 B, KDE 59 338 B.

### 2026-09-17 — Lines between tiles at fractional display scales

- **Symptom** (owner, large monitor under KDE fractional scaling, device ratio 1.5): thin horizontal and
  vertical lines between terrain tiles, in the KDE plugin and the browser version.
- **Cause**: the camera moves in whole world pixels, so at a fractional scale a quad edge often lands on a
  device pixel centre; with `NEAREST` sampling the interpolated UV then fell just outside the cell and picked
  the neighbouring atlas cell. Scale 1 never puts an edge on a pixel centre, which is why earlier checks passed.
- **Fix**: both vertex shaders (`src/core/render/shaders.ts`, terrain and objects) snap positions to whole
  device pixels. Renders at scale 1 stay byte-identical (checked on `test_map.h3m` with objects).
- **Check**: `test/browser/fractional-scale.test.ts` renders the synthetic map at 1.5, 1.25 and 1.75 with tile
  edges on pixel centres and requires every pixel of a terrain-only tile to come from that tile's own cell
  (1945 foreign pixels at 1.5 before the fix, 0 after). `yarn h3 render --scale F` and the optional `scale` of
  `engine.setMapping` reproduce such views.
- Note for manual checks: `yarn preview:web` serves `dist/packages/web`, which `yarn build` does not refresh;
  run `yarn package --host web` first.

### 2026-09-22 — Pixel mapping at fractional display scales (objects jumping by a device pixel)

- **Symptom** (owner, 3840×2160 monitor at KDE scale 1.5, `test_map.h3m`, fixed view at 100 % / 0 %): some
  animated objects (taverns, leprechaun, fairy ring, volcano, peasant hut) jump up and down while animating;
  invisible in stills. Survives view and level changes.
- **Cause**: the T073 fix. Snapping quad corners to whole device pixels rounds a quad's top and bottom
  independently, so inside the quad the texel → device-row mapping depends on where the quad starts. Object
  quads are the cropped frame (`fullTop + cell.y`), and cropped frames of one animation start at different
  offsets, so from frame to frame the unchanged part of a sprite moved by one device row. A headless render of
  the owner's view at 1.5 showed 42 blocks where tick t+1 equals tick t shifted by one row.
- **Fix** (`src/core/render/shaders.ts`): every device pixel shows the world pixel under its centre,
  `floor((p + 0.5) / scale + offset)`, i.e. the nearest-neighbour upscale of the scale-1 image. Vertices carry
  the corner, its local coordinate in the cell, the cell's top-left texel and size (negative = mirrored)
  (`VERTEX_SIZE` 9, `OBJECT_VERTEX_SIZE` 11). The vertex shader widens each quad by half a world pixel so no
  pixel centre lies on an edge; the fragment shader takes `floor(local + 1/256)` (a centre exactly on a
  boundary belongs to the next pixel), discards pixels outside the cell and samples that texel. The mapping
  depends on world positions only: no neighbour-cell lines, no crop-dependent shifts. Fragment shaders use
  `highp` when available (local coordinates need more than fp16). Renders at scale 1 stay byte-identical
  (`test_map.h3m`, both levels, with objects); the software rasterizer reads the new layout.
- **Check**: `test/browser/fractional-scale.test.ts` now requires the render at 1.5 (two shifts), 1.25 and 1.75
  to equal, pixel for pixel, the nearest-neighbour upscale of the scale-1 render, with objects and shadows, at
  six animation ticks. Synthetic object frames now vary their crop from frame to frame
  (`test/fixtures/synthetic/object-defs.ts`). The T073 code fails it (16 862–109 791 wrong pixels per frame);
  the owner's view of `test_map.h3m` shows 0 jumping blocks instead of 42.
- **Lines between tiles, re-check on the host**: the owner saw lines again after T073, less often. On the
  plasmashell page (DevTools over `QTWEBENGINE_REMOTE_DEBUGGING`) the backend is ANGLE on OpenGL ES (Iris Xe),
  `mediump` is fp32, the canvas is 3840×2160 at device ratio 1.5, and canvas read-backs of 14 views showed no
  lines. The pixels around the lines in the owner's screenshot are blends of both sides, which a `NEAREST`
  render cannot produce, so that screenshot was probably taken while the page was not shown 1:1 (other device
  ratio or canvas size, or an older installed package). Not reproduced since; the new mapping removes the
  neighbour-cell case for any GPU precision the check covers.
- **Budget `idle-cadence` (T075, owner decision 2026-09-22: relax the limit, revisit with performance work)**:
  after T074 the dev harness counted 29 frames on `Arrogance.h3m` in a ~5 s idle window against a limit of
  28 (`floor(window / 180) + 1`), in 3 of 3 runs (27–28 before). Frame times inside the page are unchanged
  or lower (`renderNow` + `gl.finish`, 1920×1080: Pandora's Box 3.5 vs 3.7 ms at scale 1), but under the
  budget's 4× CPU throttling a frame costs 5–9 % more main-thread time (Pandora's Box 15.4–15.6 vs 14.3 ms,
  Arrogance 6.6–6.8 vs 6.3 ms): object vertices are 11 floats instead of 7 and are uploaded every object
  tick. Frame timestamps show no extra redraws — every frame belongs to an animation change — but some
  `requestAnimationFrame` callbacks run late, so a frame due just before the window opens is presented
  inside it. The limit now allows one such frame (`CHECK_THRESHOLDS.idleCadenceSlackFrames`); a static
  view still allows exactly one frame. To win the time back later: thinner vertices (per-quad data once
  per quad via indexed drawing or a separate buffer), or uploading only changed object quads.

### 2026-09-19 — Windows session, first results (WSL on Windows 10 IoT LTSC 19044, two 1920×1080 monitors)

- **Wallpaper Engine 2.8.42 — file properties take images and videos only.** The official docs
  ("User Properties" → File property) define the file type as image (`.jpeg/.jpg/.png/...`) or video
  (`.webm/.ogg/.ogv`); the owner could not pick `.lod`/`.h3m` in the UI. Answer to the old `fileType`
  note: not setting it still defaults the dialog to images. Fix shipped in this session: the three file
  settings are generated as `textinput` (the page normalises the text like any host file value, R4),
  README texts updated (WE-2 answered for the working layout below).
- **Wallpaper Engine sandboxes file reads to the wallpaper folder.** Measured with in-page probes
  (a throwaway `diag.js` in the installed copy): `file:` XHR works for paths resolving inside the
  wallpaper folder (relative, `../`, absolute `file:///C:/…`); anything resolving outside it — another
  drive (`D:\…`), `C:\Windows\win.ini`, a junction pointing to `D:\…` — never completes: XHR neither
  loads nor errors (the page hangs at "loading"), `fetch` rejects at once. The check follows the
  resolved path, so junctions do not help. Therefore WE settings hold paths relative to the wallpaper
  folder and the owner copies the archives and map into it (README explains); full paths elsewhere are
  supported by a **read timeout**: `readUserFile` bounds every read with `READ_TIMEOUT_MS` (30 s) so a
  host hang degrades to `FILE_UNREADABLE` "reading timed out" instead of an endless loading state.
  Owner decision: the archive settings default to the README convention (`game/H3sprite.lod`,
  `game/h3bitmap.lod`) so a standard install needs no typing, the map setting has no default (its name
  is the owner's), and the README states the copy-it-yourself rule prominently ("without this the
  wallpaper cannot work"). The same warning is a read-only `paragraph` property at the top of the
  properties panel (`notice`, excluded from the settings-keys check like Lively's labels): Workshop
  installs never see the README, and the paragraph type renders as plain text in the panel (probed in
  the real UI; `label` also renders, `textinput` draws an input box). Owner-requested spacing: two
  single-space paragraph spacers (`spacer1` after the notice, `spacer2` after the last file setting;
  probed in the real panel, fractional `order` works) separate the warning and the file fields from
  the rest of the settings; the strings check allows this one intentionally whitespace-only key.
- **WE-1 answered for the working layout**: same-folder `file:` XHR with `responseType: 'blob'` read
  64 MB in 0.12 s and 101 MB in 0.15 s (NVMe) — far inside the 2 s warm-start budget.
- **WE DevTools**: the settings button opens a built-in inspector that closes when the wallpaper page
  reloads; no TCP port appears in `netstat` while it is open (WE-12: external CDP attach to WE's
  wallpaper CEF was not achieved this session; the port config and `general.user.cefcommandline` are
  not forwarded to the wallpaper CEF either). The in-page probe overlay remains the practical
  diagnostic for WE.
- **WE-9 answered**: the panel labels and the notice paragraph come from the `ru-ru` localization table
  when Wallpaper Engine runs in Russian (owner's install); the `en-us` table serves an English UI.
- **WE CLI from WSL interop works**: `wallpaper64.exe -control openWallpaper -file <project.json>`,
  `-control closeWallpaper`, restart via `Stop-Process`/`Start-Process` (wallpaper64 + webwallpaper64).
  Pre-filled property values inside `project.json` of `myprojects/<name>` are delivered on wallpaper
  start (that is also where WE itself saves user choices). With the values relative to the wallpaper
  folder the map renders (Arrogance, owner confirmed).
- **Lively 2.2.1.0 (WebView2, Edge 153)**: `Lively.exe setwp --file` refuses zip and folder imports
  ("Unsupported command import file"), but a folder under `%LOCALAPPDATA%\Lively Wallpaper\Library\wallpapers\`
  (with `LivelyInfo.json`) is picked up by the library scan and `setwp --file <that folder>` applies it.
  Zip import works through the GUI (drag & drop) — done by the owner (LV-7).
- **Lively pre-filled `LivelyProperties.json` values** (`userfiles\name`, backslash) are delivered on page
  load like Browse choices; the owner confirmed the map displays correctly with real files (LV-1 value
  format, LV-2, LV-3 answered: listener receives all controls on load).
- **Lively DevTools**: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` works when
  present in Lively's process environment (setx User scope needs Lively restarted from a new shell).
  `/json/list` shows the page target (`https://<hash>.localhost/index.html`, virtual host confirmed) and
  a worker target — the Blob worker runs on the real host (R3 confirmed).
- **Lively suspends the WebView2 renderer while the wallpaper is paused**: browser-level CDP
  (`Target.getTargetInfo`) answers, page-level `Runtime.evaluate` never returns and the renderer burns no
  CPU; evaluate works right after a navigation and while the wallpaper is visible. Pause rules follow the
  desktop being covered by windows (LV-4 side note: suspension stops JS entirely, which reaches the same
  0-pending-callback goal).
- Verify tooling note: the temporary CDP bridge used from WSL lives in git-ignored
  `check-reports/windows-session/cdp-eval.mjs` and runs on Windows-side Node (`Runtime.evaluate` over
  `/devtools/page/<id>`); nothing Windows-only entered shared tooling.

### 2026-09-25 — Windows session, spec 007 follow-up (WSL)

First Windows check after HotA support (spec 005) and the map folder (spec 007); the host-neutral answers
are in [007 research "Windows session"](../007-map-folder/research.md#windows-session-2026-09-25-wsl-on-the-owners-machine).
Section C items re-measured here:

- **WE-3 answered**: the classic IIFE bundle and the embedded Blob worker run on the real Wallpaper Engine
  2.8.42 CEF (Chromium 146) — the wallpaper decodes archives and renders (spec 007 checks), so no module
  scripts or URL workers are needed. WE-4 answered: the host listener (wrapped from the page) received the
  first full `applyUserProperties` with all 29 keys, so `window.wallpaperPropertyListener` is set early
  enough.
- **WE-6 answered**: `applyGeneralProperties` carries `language: "ru-ru"` (the owner's WE UI language) and
  `fps: 25`; `navigator.language` in the page is `en-US`, so it does **not** follow WE's language — the
  `language` value is the one to use. WE-8: `fps` is delivered (25 here).
- **LV-4 answered**: while the owner's windows cover the Lively screen the page's `hostPaused` is `true`
  and `engine.paused` is `true` (playback pause), matching the 2026-09-19 suspension measurement.
- **LV-6 partial**: `navigator.language` in WebView2 is `en-US` (Windows language), and the overlay
  messages rendered in Russian from `LivelyProperties.loc.json`; the panel labels were not re-checked
  this session.
- **Still open** (not re-measured): WE-5 (IndexedDB across restart/reboot, per monitor), WE-7 (WE pause
  delivery/freeze), WE-10 (scaled displays; both monitors are dpr 1 here), WE-11 (`preview.png`), LV-5
  (Lively IndexedDB persistence). All need the owner present or a scaled display.

### 2026-09-24 — KDE: black wallpaper after a monitor was plugged in

The owner plugged in the large monitor (the primary screen), the wallpaper moved to it and stayed
black; a plasmashell restart fixed it, and a second unplug/replug did not reproduce it. A DevTools
watcher over the replug showed the page itself healthy (context never lost, frames drawn) but
toggling `hostPaused` and `document.visibilityState` together for up to 26 s per move: the QML shell
pauses the page and hides the `WebEngineView` (black background below) while `WindowWatcher` reports
the screen covered by a maximized window. `WindowWatcher` recomputed `covered` only on the tasks
model's `dataChanged` and `countChanged`; a move to another screen refilters the model, and when the
filtered count stays the same neither signal fires, so `covered` can keep the old screen's answer —
a black wallpaper until the shell restarts. Fixed by recomputing on screen-geometry, desktop and
activity changes and on the model's row, reset and layout signals (static test in
`test/tools/manifests-kde.test.ts`). The cause is inferred from the code and the observed pausing;
the original black state could not be inspected, so a repeat after the fix should be looked at
with the DevTools port open (AGENTS.md, KDE notes).

### Deviations from the plan

- Host builds are produced by `tools/package/build.ts` through the Vite API (IIFE library builds, worker built
  first and injected with `define`) instead of extra modes in `vite.config.ts`; `vite.config.ts` only stopped
  wiping `dist/packages` on harness builds.
- Overlay styles use a constructed stylesheet (`adoptedStyleSheets`) instead of `overlay.css`, so no inline
  `<style>` is needed under the CSP; page styles are `page.css` (hosts) and Vite-bundled CSS (web).
- Preview images are procedural PNGs written by `tools/package/previews.ts` (deterministic, no browser) instead
  of an SVG rasterized in Chromium. Wallpaper Engine's `preview` points at `preview.png` (WE-11 below).
- Browser help text lives in the panel (`<details>`) instead of a separate `help.ts`.
- The remembered-files test runs as host-simulation invariant 11 (real IndexedDB, reload, forget) instead of a
  separate browser unit test.
- Web Locks key decodes by kind + file size + name (identity is computed inside the decode step); the cache
  re-check inside the lock gives the same one-decode behaviour (browser test: two pages, one decode).
- KDE lock detection polls `org.freedesktop.ScreenSaver.GetActive` every 2 s from a `Loader`-isolated QML file,
  and window coverage uses `TasksModel` in another isolated file, so a missing QML module disables only that
  detection.

## Windows session handoff

Packages: `yarn package --host wallpaper-engine,lively` → `dist/packages/wallpaper-engine/` (copy the folder
into Wallpaper Engine's `projects/myprojects/`, or open `project.json` from the WE editor) and
`dist/packages/heroes3-living-map-lively-<version>.zip` (drag into Lively).

Install notes measured in the 2026-09-19 session (see Measurements):
- WE: WE's CEF reads files only inside the wallpaper folder; the three file settings are text inputs
  holding paths relative to it (e.g. `game/H3sprite.lod` after copying the archives and map into a
  `game/` subfolder next to `index.html`). Values may be pre-filled in the installed `project.json`.
- Lively CLI cannot import: put the package folder into `%LOCALAPPDATA%\Lively Wallpaper\Library\wallpapers\<name>`
  and run `Lively.exe setwp --file <that folder>`; the GUI drag & drop of the zip works too.
- Lively DevTools: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` in Lively's
  process environment (e.g. `setx` + restart Lively from a new shell), then use `http://127.0.0.1:9222`.

Debugging:
- Wallpaper Engine: Settings → General → "CEF devtools port" (e.g. 8080), open `http://localhost:8080` in a
  Chromium browser, pick the wallpaper page. In 2.8.42 the port input is commented out and the setting is
  not applied to the wallpaper CEF; use the "Open DevTools" button in the settings instead (WE-12).
- Lively: Settings → Wallpaper → debug / "Open DevTools" for web wallpapers (or the environment variable
  above — measured working; the renderer only answers while the wallpaper is not suspended by pause).
- In the DevTools console run `localStorage.setItem('h3dynam:test', '1')` and reload the wallpaper (host
  reload action); then `__h3wallpaper.controller.state()` shows phase, slots, messages, language and engine
  stats (`pendingCallbacks`, `scheduledFrames`, `surface`, `camera`). Remove the key afterwards.

Reproduce on the real host: the invariants of contracts/host-bridge.md (placeholder, load, pause → 0 pending
callbacks, settings live, Russian labels, bad files, surface, no CSP violations in the console) and quickstart §5.
Record answers to WE-1…WE-10, LV-1…LV-7 below and fix findings in shared code or the host bridge; re-run
`yarn verify hosts` on Linux afterwards. Extra question found while implementing:
- **WE-11** Does Wallpaper Engine accept `preview.png` (not `.jpg`/`.gif`) for the wallpaper preview?
- **WE-12** Does the settings "Open DevTools" button expose the wallpaper page on a TCP port (for external
  CDP attach), or only open a built-in inspector? Measured 2026-09-19: the inspector closes when the
  wallpaper page reloads and no TCP port appears in `netstat`; the port config and
  `general.user.cefcommandline` are not forwarded to the wallpaper CEF. In-page probes (see Measurements)
  remain the practical WE diagnostic.
